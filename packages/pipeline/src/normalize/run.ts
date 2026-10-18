// Прогон нормализации по набору: очистка → нормализация каждой иконки → сводка и стоп-правила.
// Файлы набора не меняются и в data/ ничего не пишется: это проверка, а сборка — шаг 5.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { percent } from "../report/html.js";
import { checkSafeSvg } from "../sanitize/check.js";
import { EXCLUDE_LIMIT, listIcons } from "../sanitize/run.js";
import { sanitizeSvg } from "../sanitize/sanitize.js";
import type { SourceConfig } from "../sources/config.js";
import { formatNumber } from "./canvas.js";
import {
  iconToSvg,
  type NormalizedIcon,
  type NormalizeStats,
  normalizeSvg,
} from "./normalize.js";

const BATCH = 64;

export interface NormalizedEntry {
  name: string;
  /** Путь к исходному SVG относительно папки набора. */
  file: string;
  /** Исходный файл как есть — для колонки «было» в галерее. */
  source: string;
  icon: NormalizedIcon;
  stats: NormalizeStats;
  warnings: string[];
  /** Почему иконку стоит посмотреть первой; пусто — не нужно. */
  attention: string[];
}

export interface NormalizeCounts {
  /** Иконок, у которых атрибуты корня перенесены во внешний <g>. */
  moved: number;
  /** Иконок с масштабом или сдвигом. */
  scaled: number;
  /** Иконок, получивших цвет по умолчанию. */
  defaults: number;
  /** Иконок, где цвета заменены на currentColor. */
  recolored: number;
  /** Иконок с переименованными ID; сколько ID переименовано и удалено всего. */
  withIds: number;
  idsRenamed: number;
  idsRemoved: number;
  /** Иконок, где залиты фигуры с обводкой. */
  strokedFilled: number;
  /** Монохромных иконок с несколькими цветами. */
  multiColor: number;
  /** Монохромных иконок с масками, градиентами, узорами или фильтрами. */
  complex: number;
}

export interface SetNormalizeReport {
  id: string;
  name: string;
  source: string;
  palette: "monochrome" | "color";
  grid: number;
  sourceGrid: number;
  total: number;
  /** Нормализованные иконки по алфавиту. */
  icons: NormalizedEntry[];
  /** Исключённые при очистке и при нормализации. */
  excluded: { name: string; reason: string }[];
  /** Сколько раз санитайзер нашёл опасное. */
  dangerous: number;
  /** Иконок, у которых санитайзер удалил фигуры или атрибуты рисунка. */
  sanitizeLosses: number;
  /** Иконки, чей холст не на сетке источника. */
  offGrid: string[];
  /** Иконки, чей результат не прошёл независимую проверку. */
  unsafe: { name: string; problems: string[] }[];
  counts: NormalizeCounts;
  warnings: { what: string; icons: number }[];
  /** Почему набор нельзя обновлять; пусто — можно. */
  stop: string[];
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Причины посмотреть иконку первой: всё необычное, что нормализация заметила. */
function attentionOf(
  stats: NormalizeStats,
  warnings: readonly string[],
  sourceGrid: number,
): string[] {
  const out: string[] = [];
  if (stats.offGrid) {
    out.push(
      `холст ${formatNumber(stats.canvas.width)}×${formatNumber(stats.canvas.height)} — не на сетке ${formatNumber(sourceGrid)}`,
    );
  }
  if (stats.ids.renamed > 0) out.push(`ID переименованы: ${stats.ids.renamed}`);
  const paint = stats.paint;
  if (paint && paint.colors.length > 1) {
    out.push(`несколько цветов: ${paint.colors.join(", ")}`);
  }
  if (paint && paint.complex.length > 0) {
    out.push(`сложная монохромная: ${paint.complex.join(", ")}`);
  }
  if (paint && paint.strokedFilled > 0) {
    out.push("залита фигура с обводкой (как в оригинале)");
  }
  return [...out, ...warnings];
}

/** Нормализует все иконки набора и собирает сводку. */
export async function normalizeSet(
  config: SourceConfig,
  dir: string,
  source: string,
): Promise<SetNormalizeReport> {
  const sourceGrid = config.sourceGrid ?? config.grid;
  const icons = await listIcons(config, dir);
  const report: SetNormalizeReport = {
    id: config.id,
    name: config.name,
    source,
    palette: config.palette,
    grid: config.grid,
    sourceGrid,
    total: icons.length,
    icons: [],
    excluded: [],
    dangerous: 0,
    sanitizeLosses: 0,
    offGrid: [],
    unsafe: [],
    counts: {
      moved: 0,
      scaled: 0,
      defaults: 0,
      recolored: 0,
      withIds: 0,
      idsRenamed: 0,
      idsRemoved: 0,
      strokedFilled: 0,
      multiColor: 0,
      complex: 0,
    },
    warnings: [],
    stop: [],
  };
  const warnings = new Map<string, number>();
  const counts = report.counts;

  for (let i = 0; i < icons.length; i += BATCH) {
    const batch = icons.slice(i, i + BATCH);
    const files = await Promise.all(
      batch.map((icon) => readFile(join(dir, icon.file))),
    );
    batch.forEach((icon, j) => {
      const bytes = files[j] as Buffer;
      const clean = sanitizeSvg(bytes);
      for (const r of clean.removals) {
        if (r.kind === "dangerous") report.dangerous += r.count;
      }
      if (clean.status === "excluded") {
        report.excluded.push({
          name: icon.name,
          reason: `очистка: ${clean.reason}`,
        });
        return;
      }
      if (clean.lost.length > 0 || clean.shapes.after < clean.shapes.before) {
        report.sanitizeLosses++;
      }
      const result = normalizeSvg(clean.svg, {
        prefix: config.id,
        name: icon.name,
        palette: config.palette,
        grid: config.grid,
        sourceGrid,
      });
      if (result.status === "excluded") {
        report.excluded.push({ name: icon.name, reason: result.reason });
        return;
      }
      const { stats } = result;
      if (stats.moved.length > 0) counts.moved++;
      if (stats.transform !== undefined) counts.scaled++;
      if (stats.offGrid) report.offGrid.push(icon.name);
      if (stats.ids.renamed > 0) counts.withIds++;
      counts.idsRenamed += stats.ids.renamed;
      counts.idsRemoved += stats.ids.removed;
      const paint = stats.paint;
      if (paint) {
        if (paint.defaults > 0) counts.defaults++;
        if (paint.replaced > 0) counts.recolored++;
        if (paint.strokedFilled > 0) counts.strokedFilled++;
        if (paint.colors.length > 1) counts.multiColor++;
        if (paint.complex.length > 0) counts.complex++;
      }
      for (const w of result.warnings) {
        warnings.set(w, (warnings.get(w) ?? 0) + 1);
      }
      const problems = checkSafeSvg(iconToSvg(result.icon));
      if (problems.length > 0)
        report.unsafe.push({ name: icon.name, problems });
      report.icons.push({
        name: icon.name,
        file: icon.file,
        source: bytes.toString("utf8"),
        icon: result.icon,
        stats,
        warnings: result.warnings,
        attention: attentionOf(stats, result.warnings, sourceGrid),
      });
    });
  }

  report.warnings = [...warnings]
    .map(([what, n]) => ({ what, icons: n }))
    .sort((a, b) => b.icons - a.icons || order(a.what, b.what));

  const { total, stop } = report;
  if (total === 0) stop.push("в наборе не найдено ни одной иконки");
  if (total > 0 && report.excluded.length / total > EXCLUDE_LIMIT) {
    stop.push(
      `исключено ${percent(report.excluded.length, total)} иконок — больше 1%`,
    );
  }
  if (report.dangerous > 0) {
    stop.push(
      "найдено опасное содержимое — в нормальном наборе его не бывает, проверьте источник",
    );
  }
  if (report.sanitizeLosses > 0) {
    stop.push(
      "ПРОВЕРИТЬ: санитайзер удалил у части иконок фигуры или атрибуты рисунка (pnpm sanitize)",
    );
  }
  if (total > 0 && report.offGrid.length / total > EXCLUDE_LIMIT) {
    stop.push(
      `вне сетки ${percent(report.offGrid.length, total)} иконок — больше 1%: похоже, автор сменил холст, проверьте sourceGrid в конфиге`,
    );
  }
  if (report.unsafe.length > 0) {
    stop.push("результат не прошёл независимую проверку безопасности");
  }
  return report;
}
