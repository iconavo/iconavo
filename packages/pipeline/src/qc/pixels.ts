// Пиксели для контроля качества (ADR-0016): сколько закрашено, на сколько рисунок вышел за холст,
// отличаются ли две картинки. Картинки — RGBA, цвет не умножен на прозрачность.

import pixelmatch from "pixelmatch";
import { CROP_ALPHA, PIXELMATCH_THRESHOLD } from "./config.js";

/** Картинка RGBA: по 4 байта на пиксель, построчно. */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Прямоугольник в пикселях — например, холст иконки внутри рисунка с запасом. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const alphaAt = (image: Image, x: number, y: number) =>
  image.data[(y * image.width + x) * 4 + 3] as number;

/**
 * resvg отдаёт цвет, уже умноженный на прозрачность, а pixelmatch и PNG ждут обычный.
 * Меняет картинку на месте.
 */
export function unpremultiply(image: Image): Image {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] as number;
    if (a === 0 || a === 255) continue;
    for (let c = i; c < i + 3; c++) {
      d[c] = Math.min(255, Math.round(((d[c] as number) * 255) / a));
    }
  }
  return image;
}

/** Доля закрашенного внутри прямоугольника, 0…1: полупрозрачный пиксель считается частично. */
export function coverage(image: Image, rect: Rect): number {
  let sum = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      sum += alphaAt(image, x, y);
    }
  }
  const area = rect.width * rect.height;
  return area === 0 ? 0 : sum / (255 * area);
}

/**
 * На сколько пикселей рисунок выходит за прямоугольник: расстояние до самого дальнего заметно
 * закрашенного пикселя снаружи. 1 — закрашен соседний с краем пиксель, 0 — ничего не вышло.
 */
export function overflow(
  image: Image,
  rect: Rect,
  minAlpha = CROP_ALPHA,
): number {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let max = 0;
  for (let y = 0; y < image.height; y++) {
    const dy = y < rect.y ? rect.y - y : y >= bottom ? y - bottom + 1 : 0;
    for (let x = 0; x < image.width; x++) {
      const dx = x < rect.x ? rect.x - x : x >= right ? x - right + 1 : 0;
      const d = Math.max(dx, dy);
      if (d > max && alphaAt(image, x, y) >= minAlpha) max = d;
    }
  }
  return max;
}

/** Часть картинки — например, холст без запаса. */
export function crop(image: Image, rect: Rect): Image {
  const row = rect.width * 4;
  const data = new Uint8Array(row * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * image.width + rect.x) * 4;
    data.set(image.data.subarray(from, from + row), y * row);
  }
  return { width: rect.width, height: rect.height, data };
}

/**
 * Только тёмная краска: тёмные пиксели становятся чёрными с прежней прозрачностью, светлые —
 * прозрачными. Так сравниваются монохромные наборы: цвет там заменяется на currentColor
 * намеренно, поэтому тёмно-серый оригинал совпадает с чёрным результатом. А белая деталь,
 * ставшая цветом текста, остаётся отличием.
 */
export function inkOnly(image: Image): Image {
  const d = image.data;
  const data = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const luma =
      0.299 * (d[i] as number) +
      0.587 * (d[i + 1] as number) +
      0.114 * (d[i + 2] as number);
    if (luma < 128) data[i + 3] = d[i + 3] as number;
  }
  return { width: image.width, height: image.height, data };
}

const sameSize = (a: Image, b: Image) =>
  a.width === b.width && a.height === b.height;

/**
 * Доля отличающихся пикселей, 0…1. Разницу в сглаживании краёв pixelmatch отличием не считает.
 * Разный размер — 1: сравнивать попиксельно нечего.
 */
export function difference(a: Image, b: Image): number {
  if (!sameSize(a, b)) return 1;
  const count = pixelmatch(a.data, b.data, undefined, a.width, a.height, {
    threshold: PIXELMATCH_THRESHOLD,
  });
  return count / (a.width * a.height);
}

/**
 * Наложение «было/стало» — картинка pixelmatch по тем же пикселям, что посчитал difference:
 * совпадающее бледно-серым, красное пропало или посветлело, синее появилось или потемнело.
 */
export function overlay(was: Image, now: Image): Image {
  if (!sameSize(was, now)) {
    throw new Error("наложение: у картинок разный размер");
  }
  const data = new Uint8Array(was.data.length);
  pixelmatch(was.data, now.data, data, was.width, was.height, {
    threshold: PIXELMATCH_THRESHOLD,
    alpha: 0.35,
    aaColor: [205, 205, 210],
    diffColor: [229, 72, 77],
    diffColorAlt: [62, 99, 221],
  });
  return { width: was.width, height: was.height, data };
}
