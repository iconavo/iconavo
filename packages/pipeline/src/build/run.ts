// Сборка набора (шаг 5, ADR-0015): очистка и нормализация (шаг 4) → SVGO → алиасы одинаковых
// вариантов (ADR-0002) → контроль качества (шаг 6, ADR-0016) → метаданные и лицензия (шаг 7,
// ADR-0017) → файлы набора (ADR-0003): icons.json в формате IconifyJSON, info.json, metadata.json,
// search.json, LICENSE и NOTICE. Одинаковые источники дают побайтно одинаковые файлы, а набор со
// «СТОП» свои файлы не перезаписывает.

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validate } from "@iconavo-ui/schema";
import { type SetMetadata, setMetadata } from "../metadata/run.js";
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
import { sourceLabel } from "../sources/fetch.js";
import type { LockEntry } from "../sources/lock.js";
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
  /** Лицензия, теги и категории, витрина, отпечатки и тексты остальных файлов набора (ADR-0017). */
  metadata: SetMetadata;
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

/**
 * Собирает набор из скачанного источника (entry — его запись в sources.lock.json): результат — отчёт
 * и, если набор не остановлен, тексты файлов набора.
 */
export async function buildSet(
  config: SourceConfig,
  dir: string,
  entry: LockEntry,
  options: BuildOptions = {},
): Promise<SetBuildReport> {
  const normalize = await normalizeSet(config, dir, sourceLabel(config, entry));
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

  // Метаданные тоже собираются у остановленного набора: отчёт показывает лицензию для подтверждения.
  const metadata = await setMetadata(
    config,
    dir,
    entry,
    icons.map((b) => ({
      name: b.entry.name,
      file: b.entry.file,
      icon: b.icon,
    })),
    new Set(built.map((b) => b.entry.name)),
  );
  stop.push(...metadata.stop);

  const report: SetBuildReport = {
    normalize,
    icons,
    aliases,
    broken,
    conflicts,
    sizes,
    transforms,
    qc,
    metadata,
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
 * Записывает файлы набора в `data/{набор}/`, каждый через временный файл: оборванная запись не
 * оставит половину файла. NOTICE, которого больше нет в источнике, удаляется. Набор со «СТОП» не
 * трогает; возвращает пути записанных файлов.
 */
export async function writeSetData(
  dataDir: string,
  r: SetBuildReport,
): Promise<string[] | undefined> {
  const files = r.metadata.files;
  if (r.json === undefined || files === undefined) return undefined;
  const dir = join(dataDir, r.normalize.id);
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const file of [{ name: "icons.json", text: r.json }, ...files]) {
    const path = join(dir, file.name);
    const tmp = join(
      dir,
      `.${file.name}-${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await writeFile(tmp, file.text, "utf8");
      await rename(tmp, path);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    written.push(path);
  }
  if (!files.some((f) => f.name === "NOTICE")) {
    await rm(join(dir, "NOTICE"), { force: true });
  }
  return written;
}
