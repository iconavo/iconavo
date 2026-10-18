// Нормализация иконки (ADR-0014): холст набора, атрибуты корня во внешнем <g>, цвет «как у текста»
// в монохромных наборах, ID без конфликтов. На входе — дерево после санитайзера, на выходе — иконка
// в формате IconifyJSON: тело без корневого <svg>, ширина и высота; начало холста всегда 0,0.

import { countShapes } from "../sanitize/sanitize.js";
import { escapeAttr, type SvgElement, serializeSvg } from "../svg/serialize.js";
import { SVG_NS } from "../svg/xml.js";
import { formatNumber, placeOnGrid, readCanvas } from "./canvas.js";
import { renameIds } from "./ids.js";
import { normalizePaint, type PaintStats } from "./paint.js";

export interface NormalizeOptions {
  /** Префикс набора (ADR-0001). */
  prefix: string;
  /** Имя иконки. */
  name: string;
  palette: "monochrome" | "color";
  /** Сетка набора: 24 или 32. */
  grid: number;
  /** Высота холста в источнике (у Material Symbols — 960). */
  sourceGrid: number;
}

/** Иконка в формате IconifyJSON. */
export interface NormalizedIcon {
  body: string;
  width: number;
  height: number;
}

export interface NormalizeStats {
  /** Атрибуты корня, перенесённые во внешний <g>. */
  moved: string[];
  /** Масштаб и сдвиг на внешнем <g>; нет — иконка уже на сетке. */
  transform?: string;
  /** Холст источника: ширина и высота viewBox. */
  canvas: { width: number; height: number };
  /** Высота холста не равна сетке источника (как у keycap-5 и swan во Fluent). */
  offGrid: boolean;
  /** Только у монохромных наборов. */
  paint?: PaintStats;
  ids: { renamed: number; removed: number };
}

export type NormalizeResult =
  | {
      status: "kept";
      icon: NormalizedIcon;
      stats: NormalizeStats;
      warnings: string[];
    }
  | { status: "excluded"; reason: string };

/**
 * На корне <svg> эти атрибуты работают в пикселях окна, а не в единицах холста: перенос на <g>
 * исказил бы рисунок. Иконка исключается — в первых пяти наборах таких нет.
 */
const ROOT_ONLY: readonly string[] = [
  "transform",
  "clip-path",
  "mask",
  "filter",
];

/** Атрибуты холста: они превращаются в ширину и высоту иконки. */
const CANVAS_ATTRS: ReadonlySet<string> = new Set([
  "width",
  "height",
  "viewBox",
  "preserveAspectRatio",
]);

/** Нормализует одну иконку. Вход не меняется. */
export function normalizeSvg(
  input: SvgElement,
  options: NormalizeOptions,
): NormalizeResult {
  const svg = structuredClone(input);
  const canvas = readCanvas(svg.attrs);
  if (!canvas.ok) return { status: "excluded", reason: canvas.reason };
  for (const name of ROOT_ONLY) {
    if (svg.attrs[name] !== undefined) {
      return {
        status: "excluded",
        reason: `${name} на корневом <svg> не переносится без искажений`,
      };
    }
  }

  const placement = placeOnGrid(
    canvas.canvas,
    options.grid,
    options.sourceGrid,
  );
  const moved = Object.keys(svg.attrs).filter(
    (name) => !CANVAS_ATTRS.has(name),
  );
  const group: Record<string, string> = {};
  for (const name of moved) group[name] = svg.attrs[name] as string;
  if (placement.transform !== undefined) group.transform = placement.transform;
  // Корень без атрибутов — только контейнер для обхода; в тело идут его дети.
  const root: SvgElement = {
    tag: "svg",
    attrs: {},
    children:
      Object.keys(group).length > 0
        ? [{ tag: "g", attrs: group, children: svg.children }]
        : svg.children,
  };

  const warnings = [...canvas.warnings];
  let paint: PaintStats | undefined;
  if (options.palette === "monochrome") {
    paint = normalizePaint(root);
    warnings.push(...paint.warnings);
  }
  const ids = renameIds(root, `${options.prefix}--${options.name}`);
  warnings.push(...ids.warnings);

  if (countShapes(root) !== countShapes(input)) {
    return {
      status: "excluded",
      reason: "ошибка нормализации: изменилось число фигур",
    };
  }
  return {
    status: "kept",
    icon: {
      body: root.children.map((child) => serializeSvg(child)).join(""),
      width: placement.width,
      height: placement.height,
    },
    stats: {
      moved,
      transform: placement.transform,
      canvas: { width: canvas.canvas.width, height: canvas.canvas.height },
      offGrid: canvas.canvas.height !== options.sourceGrid,
      paint,
      ids: { renamed: ids.renamed, removed: ids.removed },
    },
    warnings: [...new Set(warnings)],
  };
}

/** Иконка как самостоятельный SVG — так её нарисует пакет; extra — дополнительные атрибуты корня. */
export function iconToSvg(
  icon: NormalizedIcon,
  extra: Readonly<Record<string, string>> = {},
): string {
  let out = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${formatNumber(icon.width)} ${formatNumber(icon.height)}"`;
  for (const [name, value] of Object.entries(extra)) {
    out += ` ${name}="${escapeAttr(value)}"`;
  }
  return `${out}>${icon.body}</svg>`;
}
