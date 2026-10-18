// Холст иконки (ADR-0014): откуда берётся viewBox и как иконка переводится на сетку набора.
// Масштаб и сдвиг пишутся точно — атрибутом transform; «впечатает» их в координаты SVGO на шаге 5.

export interface Canvas {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CanvasResult =
  | { ok: true; canvas: Canvas; warnings: string[] }
  | { ok: false; reason: string };

export interface Placement {
  /** Ширина и высота иконки на сетке набора. */
  width: number;
  height: number;
  /** Масштаб и сдвиг для внешнего <g>; нет — иконка уже на сетке и в начале координат. */
  transform?: string;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Число без «шума» плавающей точки (0.1 + 0.2 → 0.3) и без минус нуля. */
export function cleanNumber(n: number): number {
  const clean = Number(n.toPrecision(12));
  return Object.is(clean, -0) ? 0 : clean;
}

/** Число для атрибута: без шума и без экспоненты (1e-7 → 0.0000001). */
export function formatNumber(n: number): string {
  const clean = cleanNumber(n);
  const text = String(clean);
  return /e/i.test(text) ? clean.toFixed(20).replace(/\.?0+$/, "") : text;
}

/** Длина без единиц или в px; проценты, em и прочее — undefined. */
function length(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const text = value.trim().replace(/px$/, "");
  return NUMBER.test(text) ? Number(text) : undefined;
}

/** Холст по атрибутам корня: viewBox, а без него — width и height без единиц или в px. */
export function readCanvas(
  attrs: Readonly<Record<string, string>>,
): CanvasResult {
  const width = length(attrs.width);
  const height = length(attrs.height);
  let canvas: Canvas;
  if (attrs.viewBox !== undefined) {
    const parts = attrs.viewBox.trim().split(/[\s,]+/);
    if (parts.length !== 4 || !parts.every((p) => NUMBER.test(p))) {
      return {
        ok: false,
        reason: `viewBox «${attrs.viewBox}» не читается: нужно четыре числа`,
      };
    }
    const [left, top, w, h] = parts.map(Number) as [
      number,
      number,
      number,
      number,
    ];
    canvas = { left, top, width: w, height: h };
  } else {
    if (width === undefined || height === undefined) {
      return {
        ok: false,
        reason: "нет viewBox, а width и height не заданы числами",
      };
    }
    canvas = { left: 0, top: 0, width, height };
  }
  const sizes = [canvas.left, canvas.top, canvas.width, canvas.height];
  if (
    !sizes.every(Number.isFinite) ||
    canvas.width <= 0 ||
    canvas.height <= 0
  ) {
    return {
      ok: false,
      reason: `у холста нулевой или неверный размер (${canvas.width}×${canvas.height})`,
    };
  }
  const warnings: string[] = [];
  if (
    attrs.viewBox !== undefined &&
    width !== undefined &&
    height !== undefined &&
    width > 0 &&
    height > 0 &&
    Math.abs(width / height - canvas.width / canvas.height) > 1e-6
  ) {
    warnings.push("пропорции width и height не совпадают с viewBox");
  }
  return { ok: true, canvas, warnings };
}

/**
 * Перевод на сетку набора: масштаб grid / sourceGrid и сдвиг начала холста в 0,0.
 * Сдвиг записан в единицах источника — так он остаётся точным при любом масштабе.
 */
export function placeOnGrid(
  canvas: Canvas,
  grid: number,
  sourceGrid: number,
): Placement {
  const parts: string[] = [];
  if (grid !== sourceGrid)
    parts.push(`scale(${formatNumber(grid / sourceGrid)})`);
  if (canvas.left !== 0 || canvas.top !== 0) {
    parts.push(
      `translate(${formatNumber(-canvas.left)} ${formatNumber(-canvas.top)})`,
    );
  }
  return {
    width: cleanNumber((canvas.width * grid) / sourceGrid),
    height: cleanNumber((canvas.height * grid) / sourceGrid),
    transform: parts.length > 0 ? parts.join(" ") : undefined,
  };
}
