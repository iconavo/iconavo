// Прогон санитайзера по набору: список иконок → очистка → сводка для отчёта.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { folderMatcher, type SourceConfig } from "../sources/config.js";
import { listFiles } from "../sources/fetch.js";
import { iconNameFromFile } from "../sources/names.js";
import { serializeSvg } from "../svg/serialize.js";
import { checkSafeSvg } from "./check.js";
import {
  type Removal,
  type RemovalKind,
  type SanitizeResult,
  sanitizeSvg,
} from "./sanitize.js";

/** Набор не обновляется, если исключено больше 1% иконок (ADR-0013). */
export const EXCLUDE_LIMIT = 0.01;

const SAMPLES = 3;
const EXCLUDED_PREVIEWS = 20;
const BATCH = 64;

export interface IconFile {
  name: string;
  /** Путь относительно папки набора. */
  file: string;
}

export interface RemovalTotal {
  kind: RemovalKind;
  what: string;
  /** Сколько раз удалено всего. */
  count: number;
  /** В скольких иконках. */
  icons: number;
}

export interface IconPreview {
  name: string;
  /** Исходный файл как текст. */
  before: string;
  /** Очищенный SVG; нет — иконка исключена. */
  after?: string;
  removals: Removal[];
  reason?: string;
}

export interface SetSanitizeReport {
  id: string;
  name: string;
  source: string;
  total: number;
  unchanged: number;
  cleaned: number;
  excluded: { name: string; reason: string }[];
  removals: RemovalTotal[];
  warnings: { what: string; icons: number }[];
  /** Иконки, где после очистки фигур меньше, чем в исходнике. */
  lostShapes: string[];
  /** Иконки, где удалены атрибуты геометрии или цвета. */
  lostAttrs: { name: string; attrs: string[] }[];
  /** Иконки, чей результат не прошёл независимую проверку. */
  unsafe: { name: string; problems: string[] }[];
  /** Сколько раз найдено опасное (скрипты, обработчики, внешние ссылки…). */
  dangerous: number;
  /** Почему набор нельзя обновлять; пусто — можно. */
  stop: string[];
  samples: IconPreview[];
  excludedPreviews: IconPreview[];
}

/** Иконки набора в скачанной папке: путь к SVG и имя по правилам конфига, по алфавиту. */
export async function listIcons(
  config: SourceConfig,
  dir: string,
): Promise<IconFile[]> {
  const folderOf = folderMatcher(config);
  const icons: IconFile[] = [];
  for (const file of await listFiles(dir)) {
    if (!file.endsWith(".svg")) continue;
    const folder = folderOf(file);
    if (folder)
      icons.push({ name: iconNameFromFile(file, folder.naming), file });
  }
  return icons.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

async function preview(dir: string, icon: IconFile): Promise<IconPreview> {
  const bytes = await readFile(join(dir, icon.file));
  const result = sanitizeSvg(bytes);
  return {
    name: icon.name,
    before: bytes.toString("utf8"),
    after:
      result.status === "kept"
        ? serializeSvg(result.svg, { xmlns: true })
        : undefined,
    removals: result.removals,
    reason: result.status === "excluded" ? result.reason : undefined,
  };
}

/** Очищает все иконки набора и собирает сводку. Файлы не меняются: это проверка, а не сборка. */
export async function sanitizeSet(
  config: SourceConfig,
  dir: string,
  source: string,
): Promise<SetSanitizeReport> {
  const icons = await listIcons(config, dir);
  const report: SetSanitizeReport = {
    id: config.id,
    name: config.name,
    source,
    total: icons.length,
    unchanged: 0,
    cleaned: 0,
    excluded: [],
    removals: [],
    warnings: [],
    lostShapes: [],
    lostAttrs: [],
    unsafe: [],
    dangerous: 0,
    stop: [],
    samples: [],
    excludedPreviews: [],
  };
  const totals = new Map<string, RemovalTotal>();
  const warnings = new Map<string, number>();
  const changed: IconFile[] = [];

  for (let i = 0; i < icons.length; i += BATCH) {
    const batch = icons.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (icon) =>
        sanitizeSvg(await readFile(join(dir, icon.file))),
      ),
    );
    results.forEach((result, j) => {
      const icon = batch[j] as IconFile;
      for (const r of result.removals) {
        const key = `${r.kind} ${r.what}`;
        const t = totals.get(key) ?? { ...r, count: 0, icons: 0 };
        t.count += r.count;
        t.icons++;
        totals.set(key, t);
        if (r.kind === "dangerous") report.dangerous += r.count;
      }
      collect(report, icon, result, warnings, changed);
    });
  }

  report.removals = [...totals.values()].sort(
    (a, b) =>
      b.count - a.count || order(a.kind, b.kind) || order(a.what, b.what),
  );
  report.warnings = [...warnings]
    .map(([what, n]) => ({ what, icons: n }))
    .sort((a, b) => b.icons - a.icons || order(a.what, b.what));

  if (report.total === 0)
    report.stop.push("в наборе не найдено ни одной иконки");
  if (
    report.total > 0 &&
    report.excluded.length / report.total > EXCLUDE_LIMIT
  ) {
    const pct = ((report.excluded.length / report.total) * 100).toFixed(1);
    report.stop.push(`исключено ${pct.replace(".", ",")}% иконок — больше 1%`);
  }
  if (report.dangerous > 0) {
    report.stop.push(
      "найдено опасное содержимое — в нормальном наборе его не бывает, проверьте источник",
    );
  }
  if (report.lostShapes.length > 0 || report.lostAttrs.length > 0) {
    report.stop.push(
      "ПРОВЕРИТЬ: у части иконок удалены фигуры или атрибуты рисунка",
    );
  }
  if (report.unsafe.length > 0) {
    report.stop.push("результат не прошёл независимую проверку безопасности");
  }

  // Образцы «до/после»: сначала изменённые; выбор по хэшу имени — разнообразный, но постоянный.
  const pool = changed.length > 0 ? changed : icons;
  const picked = [...pool]
    .sort((a, b) => order(sha1(a.name), sha1(b.name)))
    .slice(0, SAMPLES)
    .sort((a, b) => order(a.name, b.name));
  report.samples = await Promise.all(picked.map((icon) => preview(dir, icon)));
  const excludedNames = new Set(
    report.excluded.slice(0, EXCLUDED_PREVIEWS).map((e) => e.name),
  );
  report.excludedPreviews = await Promise.all(
    icons
      .filter((icon) => excludedNames.has(icon.name))
      .map((icon) => preview(dir, icon)),
  );
  return report;
}

function collect(
  report: SetSanitizeReport,
  icon: IconFile,
  result: SanitizeResult,
  warnings: Map<string, number>,
  changed: IconFile[],
): void {
  if (result.status === "excluded") {
    report.excluded.push({ name: icon.name, reason: result.reason });
    return;
  }
  if (result.changed) {
    report.cleaned++;
    changed.push(icon);
  } else {
    report.unchanged++;
  }
  for (const w of result.warnings) warnings.set(w, (warnings.get(w) ?? 0) + 1);
  if (result.shapes.after < result.shapes.before)
    report.lostShapes.push(icon.name);
  if (result.lost.length > 0) {
    report.lostAttrs.push({ name: icon.name, attrs: result.lost });
  }
  const problems = checkSafeSvg(serializeSvg(result.svg, { xmlns: true }));
  if (problems.length > 0) report.unsafe.push({ name: icon.name, problems });
}

export interface FixtureOutcome {
  file: string;
  /** Что проверяет файл — из первого комментария в нём. */
  title: string;
  source: string;
  result: SanitizeResult;
  /** Очищенный SVG, если файл не исключён. */
  after?: string;
}

/** Прогоняет «вредные» SVG из папки — их итог показывается в отчёте рядом с наборами. */
export async function sanitizeFixtures(dir: string): Promise<FixtureOutcome[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".svg")).sort();
  return Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(join(dir, file));
      const source = bytes.toString("utf8");
      const result = sanitizeSvg(bytes);
      return {
        file,
        title: /<!--\s*([\s\S]*?)\s*-->/.exec(source)?.[1] ?? file,
        source,
        result,
        after:
          result.status === "kept"
            ? serializeSvg(result.svg, { xmlns: true })
            : undefined,
      };
    }),
  );
}
