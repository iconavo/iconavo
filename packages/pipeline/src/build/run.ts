// Сборка набора (шаг 5, ADR-0015): очистка и нормализация (шаг 4) → SVGO → алиасы одинаковых
// вариантов (ADR-0002) → контроль качества (шаг 6, ADR-0016) → icons.json в формате IconifyJSON
// (ADR-0003). Одинаковые источники дают побайтно одинаковый файл, а набор со «СТОП» свой файл
// не перезаписывает.

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validate } from "@iconavo-ui/schema";
import type { NormalizedIcon } from "../normalize/normalize.js";
import {
  type NormalizedEntry,
  normalizeSet,
  type SetNormalizeReport,
} from "../normalize/run.js";
import { SUPPORTED_GRIDS } from "../optimize/config.js";
import { optimizeIcon } from "../optimize/optimize.js";
import type { Baseline } from "../qc/baseline.js";
import { checkSet, type SetQcReport } from "../qc/run.js";
import type { SourceConfig } from "../sources/config.js";
import { variantAliases } from "./aliases.js";
import { canonicalJson, type Json } from "./json.js";

export interface BuiltIcon {
  entry: NormalizedEntry;
  /** Иконка после SVGO — она и попадает в icons.json. */
  icon: NormalizedIcon;
  transformsLeft: number;
  /** Младшие варианты, ставшие алиасами этой иконки, по алфавиту. */
  aliases: string[];
}

export interface BuildSizes {
  /** Исходные SVG с переводами строк LF — одинаково на Windows и Linux. */
  source: number;
  /** Тела после нормализации. */
  normalized: number;
  /** Тела тех же иконок после SVGO, включая ставшие алиасами. */
  optimized: number;
  /** Файл icons.json; нет — набор остановлен. */
  json?: number;
}

export interface SetBuildReport {
  normalize: SetNormalizeReport;
  /** Иконки набора по алфавиту, без алиасов. */
  icons: BuiltIcon[];
  /** [алиас, родитель] по алфавиту. */
  aliases: [string, string][];
  /** Иконки, у которых SVGO или проверка после него не прошли. */
  broken: { name: string; problem: string }[];
  /** Имена, которые получили несколько файлов (ADR-0001). */
  conflicts: { name: string; files: string[] }[];
  sizes: BuildSizes;
  /** Элементов с transform до SVGO и после. */
  transforms: { before: number; left: number };
  /** Контроль качества (ADR-0016). */
  qc: SetQcReport;
  /** Содержимое icons.json; нет — набор остановлен. */
  json?: string;
  /** Почему набор нельзя обновлять; пусто — можно. */
  stop: string[];
}

export interface BuildOptions {
  /** Прошлая версия набора для сравнения (ADR-0016). */
  baseline?: Baseline;
  /** Почему сравнивать не с чем — для отчёта. */
  baselineNote?: string;
  /** Изменения проверены в отчёте: правило 2% набор не останавливает (pnpm data --accept-changes). */
  acceptChanges?: boolean;
}

const TRANSFORM = /\stransform="/g;
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Собирает набор: результат — отчёт и, если набор не остановлен, содержимое icons.json. */
export async function buildSet(
  config: SourceConfig,
  dir: string,
  source: string,
  options: BuildOptions = {},
): Promise<SetBuildReport> {
  const normalize = await normalizeSet(config, dir, source);
  const stop = [...normalize.stop];
  if (!SUPPORTED_GRIDS.has(config.grid)) {
    stop.push(
      `сетка ${config.grid} не поддерживается: точность SVGO подобрана для сеток ${[...SUPPORTED_GRIDS].join(" и ")} (ADR-0015)`,
    );
  }

  const files = new Map<string, string[]>();
  for (const e of normalize.icons) {
    files.set(e.name, [...(files.get(e.name) ?? []), e.file]);
  }
  const conflicts = [...files]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, files: list }));
  if (conflicts.length > 0) {
    stop.push(
      `одно имя у нескольких файлов: ${conflicts.length} — нужно правило переименования в конфиге набора (ADR-0001)`,
    );
  }

  const sizes: BuildSizes = { source: 0, normalized: 0, optimized: 0 };
  const transforms = { before: 0, left: 0 };
  const built: BuiltIcon[] = [];
  const broken: SetBuildReport["broken"] = [];
  for (const entry of normalize.icons) {
    sizes.source += bytes(entry.source.replace(/\r\n?/g, "\n"));
    sizes.normalized += bytes(entry.icon.body);
    transforms.before += entry.icon.body.match(TRANSFORM)?.length ?? 0;
    const r = optimizeIcon(entry.icon, `${config.id}--${entry.name}`);
    if (!r.ok) {
      broken.push({ name: entry.name, problem: r.problem });
      continue;
    }
    sizes.optimized += bytes(r.icon.body);
    transforms.left += r.transformsLeft;
    built.push({
      entry,
      icon: r.icon,
      transformsLeft: r.transformsLeft,
      aliases: [],
    });
  }
  if (broken.length > 0) {
    stop.push(
      `SVGO или проверка после него не прошли у ${broken.length} иконок`,
    );
  }

  const aliasOf = config.variantAliases
    ? variantAliases(
        new Map(built.map((b) => [b.entry.name, b.icon])),
        config.variantAliases,
      )
    : new Map<string, string>();
  const icons = built.filter((b) => !aliasOf.has(b.entry.name));
  const byName = new Map(icons.map((b) => [b.entry.name, b]));
  const aliases = [...aliasOf].sort(([a], [b]) => order(a, b));
  for (const [alias, parent] of aliases)
    byName.get(parent)?.aliases.push(alias);

  // Контроль качества идёт и у остановленного набора: отчёт должен быть полным.
  const qc = await checkSet({
    palette: config.palette,
    grid: config.grid,
    icons: icons.map((b) => ({
      name: b.entry.name,
      icon: b.icon,
      source: b.entry.source,
    })),
    aliases,
    // Если санитайзер нашёл опасное, исходники не рисуем: набор и так остановлен.
    compareOriginals: normalize.dangerous === 0,
    ...options,
  });
  stop.push(...qc.stop);

  const report: SetBuildReport = {
    normalize,
    icons,
    aliases,
    broken,
    conflicts,
    sizes,
    transforms,
    qc,
    stop,
  };
  if (stop.length > 0) return report;

  const data = iconsFile(config, icons, aliases);
  const issues = validate("icons", data);
  if (issues.length > 0) {
    stop.push(
      `icons.json не прошёл проверку схемы: ${issues
        .slice(0, 3)
        .map((i) => `${i.path} — ${i.message}`)
        .join("; ")}`,
    );
    return report;
  }
  report.json = canonicalJson(data);
  sizes.json = bytes(report.json);
  return report;
}

/** IconifyJSON: размер набора общий, у иконки — только если он другой; времени сборки нет. */
function iconsFile(
  config: SourceConfig,
  icons: readonly BuiltIcon[],
  aliases: readonly [string, string][],
): { [key: string]: Json } {
  const list: { [key: string]: Json } = {};
  for (const b of icons) {
    const item: { [key: string]: Json } = { body: b.icon.body };
    if (b.icon.width !== config.grid) item.width = b.icon.width;
    if (b.icon.height !== config.grid) item.height = b.icon.height;
    list[b.entry.name] = item;
  }
  const data: { [key: string]: Json } = {
    prefix: config.id,
    icons: list,
    width: config.grid,
    height: config.grid,
  };
  if (aliases.length > 0) {
    data.aliases = Object.fromEntries(
      aliases.map(([alias, parent]) => [alias, { parent }]),
    );
  }
  return data;
}

/**
 * Записывает `data/{набор}/icons.json` через временный файл: оборванная запись не оставит половину
 * файла. Набор со «СТОП» не трогает; возвращает путь к записанному файлу.
 */
export async function writeSetData(
  dataDir: string,
  r: SetBuildReport,
): Promise<string | undefined> {
  if (r.json === undefined) return undefined;
  const dir = join(dataDir, r.normalize.id);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "icons.json");
  const tmp = join(dir, `.icons-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, r.json, "utf8");
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return path;
}
