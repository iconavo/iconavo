// Рендер иконки для адаптеров (ADR-0031, ADR-0029): атрибуты <svg> и рисунок — то, что нарисуют тег
// (шаг 5) и React (шаг 7). Только строки, без DOM: годится и для серверного рендера.
// - Цвет — атрибутом color, а не стилем: currentColor монохромных иконок берёт его, цветные не
//   меняются, а атрибутов style нет в серверном HTML (строгая CSP, ADR-0033).
// - Толщина линии — только у монохромных иконок, где она задана: так Iconify отличает монохромные
//   иконки от цветных — по currentColor в рисунке.
// - ID внутри — свои у каждой отрисовки: счётчик в общем хранилище, чтобы две копии ядра на странице
//   не совпали; на сервере вместо счётчика — idPrefix (React: useId), иначе разметка сервера и
//   браузера разойдётся.

import type { IconData } from "./icon.js";
import { replaceIds } from "./ids.js";
import { formatNumber } from "./number.js";
import { store } from "./store.js";
import { iconToSvg, type SvgCustomisations, type SvgParts } from "./svg.js";

export interface RenderOptions extends SvgCustomisations {
  /** Цвет рисунка, любой цвет CSS. */
  color?: string;
  /** Толщина линии в единицах сетки набора. */
  strokeWidth?: number;
  /** Подпись для скринридеров; нет или из одних пробелов — иконка декоративная. */
  label?: string;
  /** Основа ID вместо счётчика страницы — для серверного рендера. */
  idPrefix?: string;
}

const STROKE_WIDTH = /(\sstroke-width=")[^"]*"/g;

/** Новая толщина линии рисунка — только у монохромного (currentColor); неверное число не меняет ничего. */
export function setStrokeWidth(body: string, width: number): string {
  return width > 0 && Number.isFinite(width) && body.includes("currentColor")
    ? body.replace(STROKE_WIDTH, `$1${formatNumber(width)}"`)
    : body;
}

/** Номер отрисовки для ID: общий для всех копий ядра на странице. */
function next(): number {
  const n = store.ids ?? 0;
  store.ids = n + 1;
  return n;
}

/**
 * Атрибуты и рисунок <svg> с настройками: размеры и повороты (iconToSvg), цвет, толщина линии,
 * свои ID и доступность — без подписи aria-hidden, с подписью role="img" и aria-label.
 */
export function renderIcon(
  icon: IconData,
  options: RenderOptions = {},
): SvgParts {
  const parts = iconToSvg(icon, options);
  const { color, strokeWidth, idPrefix } = options;
  const label = options.label?.trim();
  if (strokeWidth !== undefined) {
    parts.body = setStrokeWidth(parts.body, strokeWidth);
  }
  parts.body = replaceIds(
    parts.body,
    () =>
      `iconavo${idPrefix === undefined ? next() : idPrefix.replace(/\W/g, "_")}_`,
  );
  if (color) parts.attributes.color = color;
  if (label) {
    parts.attributes.role = "img";
    parts.attributes["aria-label"] = label;
  } else {
    parts.attributes["aria-hidden"] = "true";
  }
  return parts;
}
