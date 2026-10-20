// Контроль качества набора (ADR-0016). Каждая иконка рисуется через resvg, и машина находит
// пустые, почти пустые и обрезанные иконки. Затем сравнивает их с прошлой версией и с исходным
// файлом автора. Человек смотрит только подозрительные — в отчёте qc.html.
//
// Порядок работы:
// 1. Каждая иконка рисуется один раз. Картинки сразу выбрасываются, остаются числа.
// 2. Прошлая версия рисуется только там, где тело изменилось.
// 3. Картинки для отчёта рисуются заново — только у первых REPORT_LIMIT находок каждого вида.

import type { NormalizedIcon } from "../normalize/normalize.js";
import type { Baseline } from "./baseline.js";
import {
  CHANGED_NAMES_LIMIT,
  CHANGED_PIXELS,
  CROP_LIMIT,
  EMPTY_LIMIT,
  MARGIN,
  RENDER_SIZE,
  REPORT_LIMIT,
  SPARSE_LIMIT,
} from "./config.js";
import {
  coverage,
  crop,
  difference,
  type Image,
  inkOnly,
  overflow,
  overlay,
  type Rect,
} from "./pixels.js";
import { pngDataUri } from "./png.js";
import { initRenderer, renderIcon, renderSource } from "./render.js";

/** Виды находок — в том порядке, в каком их показывает отчёт. */
export const QC_KINDS = [
  "failed",
  "empty",
  "sparse",
  "cropped",
  "changed",
  "original",
] as const;
export type QcKind = (typeof QC_KINDS)[number];

/** Картинка для отчёта: PNG в data:, размер в пикселях; frame — где холст внутри картинки. */
export interface QcImage {
  label: string;
  src: string;
  width: number;
  height: number;
  frame?: Rect;
}

export interface QcFinding {
  kind: QcKind;
  name: string;
  /** Число для порядка: доля закрашенного, вылета за холст или отличающихся пикселей. */
  value: number;
  /** Пояснение с числами: «закрашено 0,03%». */
  text: string;
  /** Картинки для отчёта; есть только у первых REPORT_LIMIT находок своего вида. */
  images: QcImage[];
}

export interface SetQcReport {
  /** Сколько иконок нарисовано (без алиасов: они рисуются как родитель). */
  checked: number;
  /** С чем сравнивали; нет — см. baselineNote. */
  baseline?: { label: string; sourceChanged: boolean; names: number };
  /** Почему сравнивать не с чем. */
  baselineNote?: string;
  /** Находки по видам, внутри вида — сначала самые сильные. */
  findings: QcFinding[];
  /** Сколько имён прошлой версии изменилось (с алиасами); в находках — без повторов. */
  changed: number;
  /** Имена, которых не было в прошлой версии, — по алфавиту. */
  added: string[];
  /**
   * Видимые иконки прошлой версии, которых нет в источнике, — по алфавиту. Журнал их скрывает или
   * делает алиасами (ADR-0018); скрытые раньше иконки и алиасы прошлой версии сюда не входят.
   */
  missing: string[];
  /** Доля изменившихся и пропавших среди имён прошлой версии без скрытых. */
  changedShare: number;
  /** Правило 2% сработало, но изменения приняты флагом --accept-changes. */
  accepted: boolean;
  /** Почему набор нельзя записывать; пусто — можно. */
  stop: string[];
}

export interface QcInput {
  palette: "monochrome" | "color";
  grid: number;
  /** Иконки набора без алиасов — с исходным файлом автора. */
  icons: readonly { name: string; icon: NormalizedIcon; source: string }[];
  /** [алиас, родитель]. */
  aliases: readonly (readonly [string, string])[];
  /** Сравнивать с оригиналом; не сравниваем, если санитайзер нашёл в наборе опасное. */
  compareOriginals: boolean;
  baseline?: Baseline;
  baselineNote?: string;
  /** Изменения проверены в отчёте: правило 2% набор не останавливает. */
  acceptChanges?: boolean;
}

/** Доля в процентах без лишних нулей: мелкая — до двух знаков («0,03%»), остальные — до одного («2%»). */
export function share(value: number): string {
  const fixed = (value * 100).toFixed(value < 0.01 ? 2 : 1);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return `${trimmed === "" ? "0" : trimmed.replace(".", ",")}%`;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sizeOf = (icon: NormalizedIcon) => `${icon.width}×${icon.height}`;
const sameIcon = (a: NormalizedIcon, b: NormalizedIcon) =>
  a.body === b.body && a.width === b.width && a.height === b.height;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Пустые и почти пустые — сначала самые бледные; остальные — сначала самые сильные отличия. */
const byStrength = (a: QcFinding, b: QcFinding) =>
  (a.kind === "empty" || a.kind === "sparse"
    ? a.value - b.value
    : b.value - a.value) || order(a.name, b.name);

/** Проверяет набор: нарисованные иконки, находки, сравнение с прошлой версией и «СТОП». */
export async function checkSet(input: QcInput): Promise<SetQcReport> {
  await initRenderer();
  const { grid, baseline } = input;
  // Монохромные наборы сравниваются по тёмной краске: их цвет заменяется намеренно.
  const look = (image: Image) =>
    input.palette === "monochrome" ? inkOnly(image) : image;
  const canvasOf = (icon: NormalizedIcon) => {
    const r = renderIcon(icon, grid);
    return crop(r.image, r.canvas);
  };
  const findings: QcFinding[] = [];
  const add = (kind: QcKind, name: string, value: number, text: string) =>
    findings.push({ kind, name, value, text, images: [] });

  // 1. Каждая иконка: закрашенность, вылет за холст, сравнение с оригиналом.
  let checked = 0;
  for (const { name, icon, source } of input.icons) {
    let render: ReturnType<typeof renderIcon>;
    try {
      render = renderIcon(icon, grid);
    } catch (e) {
      add("failed", name, 0, `resvg не нарисовал иконку: ${message(e)}`);
      continue;
    }
    checked++;
    const filled = coverage(render.image, render.canvas);
    if (filled < EMPTY_LIMIT) {
      add("empty", name, filled, `закрашено ${share(filled)} холста`);
    } else if (filled < SPARSE_LIMIT) {
      add("sparse", name, filled, `закрашено ${share(filled)} холста`);
    }
    const out = overflow(render.image, render.canvas);
    if (out / RENDER_SIZE > CROP_LIMIT) {
      // Дальше запаса рисунок не виден: там вылет может быть и больше.
      const more = out >= MARGIN ? " и больше" : "";
      add(
        "cropped",
        name,
        out / RENDER_SIZE,
        `выходит за холст на ${share(out / RENDER_SIZE)}${more} (${out} px из ${RENDER_SIZE})`,
      );
    }
    if (!input.compareOriginals) continue;
    const result = crop(render.image, render.canvas);
    try {
      const original = renderSource(source, result.width);
      if (original.height !== result.height) {
        add(
          "original",
          name,
          1,
          `размер не совпал: оригинал ${original.width}×${original.height} px, иконка ${result.width}×${result.height} px`,
        );
        continue;
      }
      const diff = difference(look(original), look(result));
      if (diff > CHANGED_PIXELS) {
        add("original", name, diff, `отличается ${share(diff)} пикселей`);
      }
    } catch (e) {
      add("original", name, 1, `оригинал не нарисовался: ${message(e)}`);
    }
  }

  // 2. Прошлая версия: все имена, алиасы — как их родитель.
  const current = new Map<string, NormalizedIcon>();
  for (const { name, icon } of input.icons) current.set(name, icon);
  for (const [alias, parent] of input.aliases) {
    const icon = current.get(parent);
    if (icon) current.set(alias, icon);
  }
  let changed = 0;
  const added: string[] = [];
  const missing: string[] = [];
  if (baseline) {
    // Пара «было → стало» показывается один раз: алиас меняется вместе с родителем.
    const shown = new Set<string>();
    for (const [name, now] of current) {
      const was = baseline.icons.get(name);
      if (!was) {
        added.push(name);
        continue;
      }
      if (sameIcon(was, now)) continue;
      let diff: number;
      let text: string;
      try {
        const [a, b] = [canvasOf(was), canvasOf(now)];
        diff = difference(look(a), look(b));
        text =
          a.width === b.width && a.height === b.height
            ? `отличается ${share(diff)} пикселей`
            : `размер был ${sizeOf(was)}, стал ${sizeOf(now)}`;
      } catch (e) {
        diff = 1;
        text = `не нарисовалась одна из версий: ${message(e)}`;
      }
      if (diff <= CHANGED_PIXELS) continue;
      changed++;
      const key = `${was.width} ${was.height} ${was.body}\n${now.width} ${now.height} ${now.body}`;
      if (shown.has(key)) continue;
      shown.add(key);
      add("changed", name, diff, text);
    }
    // Скрытые иконки и алиасы прошлой версии журнал переносит сам: правило 2% их не касается.
    const visible = baseline.state
      ? [...baseline.state.icons]
          .filter(([, i]) => !i.hidden)
          .map(([name]) => name)
      : [...baseline.icons.keys()];
    for (const name of visible) {
      if (!current.has(name)) missing.push(name);
    }
    added.sort(order);
    missing.sort(order);
  }

  // 3. Картинки для отчёта — только у первых REPORT_LIMIT каждого вида.
  const byName = new Map(input.icons.map((i) => [i.name, i]));
  const png = (label: string, image: Image, frame?: Rect): QcImage => ({
    label,
    src: pngDataUri(image.data, image.width, image.height),
    width: image.width,
    height: image.height,
    ...(frame ? { frame } : {}),
  });
  const pair = (wasLabel: string, was: Image, now: Image) => {
    const images = [png(wasLabel, was), png("стало", now)];
    if (was.width === now.width && was.height === now.height) {
      images.push(png("наложение", overlay(look(was), look(now))));
    }
    return images;
  };
  const illustrate = (f: QcFinding): QcImage[] => {
    if (f.kind === "failed") return [];
    if (f.kind === "changed") {
      const was = baseline?.icons.get(f.name);
      const now = current.get(f.name);
      return was && now ? pair("было", canvasOf(was), canvasOf(now)) : [];
    }
    const item = byName.get(f.name);
    if (!item) return [];
    const render = renderIcon(item.icon, grid);
    if (f.kind === "original") {
      const result = crop(render.image, render.canvas);
      return pair("оригинал", renderSource(item.source, result.width), result);
    }
    // Пустые, почти пустые и обрезанные: рисунок с запасом и рамкой холста.
    return [png("resvg", render.image, render.canvas)];
  };
  findings.sort(
    (a, b) =>
      QC_KINDS.indexOf(a.kind) - QC_KINDS.indexOf(b.kind) || byStrength(a, b),
  );
  const shownOfKind = new Map<QcKind, number>();
  for (const f of findings) {
    const n = (shownOfKind.get(f.kind) ?? 0) + 1;
    shownOfKind.set(f.kind, n);
    if (n > REPORT_LIMIT) continue;
    try {
      f.images = illustrate(f);
    } catch {
      // Не нарисовалось — карточка останется с текстом причины.
    }
  }

  // «СТОП»: иконку нельзя проверить, иконка пустая, сборка изменила слишком много.
  const stop: string[] = [];
  const count = (kind: QcKind) =>
    findings.filter((f) => f.kind === kind).length;
  if (count("failed") > 0) {
    stop.push(
      `resvg не нарисовал иконок: ${count("failed")} — проверить их нельзя`,
    );
  }
  if (count("empty") > 0) {
    stop.push(
      `пустые иконки: ${count("empty")} — закрашено меньше ${share(EMPTY_LIMIT)} холста`,
    );
  }
  let hidden = 0;
  for (const i of baseline?.state?.icons.values() ?? []) if (i.hidden) hidden++;
  const names = (baseline?.icons.size ?? 0) - hidden;
  const changedShare = names === 0 ? 0 : (changed + missing.length) / names;
  let accepted = false;
  if (
    baseline &&
    !baseline.sourceChanged &&
    changedShare > CHANGED_NAMES_LIMIT
  ) {
    if (input.acceptChanges) {
      accepted = true;
    } else {
      stop.push(
        `источник тот же, а изменилось или пропало ${share(changedShare)} имён (изменились ${changed}, нет в источнике ${missing.length}) — больше ${share(CHANGED_NAMES_LIMIT)}: похоже, сломалась сборка. Посмотрите qc.html; если изменения задуманы — pnpm data --accept-changes. Сравнение идёт с версией в main, поэтому флаг нужен при каждой сборке, пока изменения не попадут в main`,
      );
    }
  }

  return {
    checked,
    ...(baseline
      ? {
          baseline: {
            label: baseline.label,
            sourceChanged: baseline.sourceChanged,
            names,
          },
        }
      : {}),
    ...(input.baselineNote === undefined
      ? {}
      : { baselineNote: input.baselineNote }),
    findings,
    changed,
    added,
    missing,
    changedShare,
    accepted,
    stop,
  };
}
