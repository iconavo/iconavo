// SVG иконки с настройками (ADR-0031): высота по умолчанию 1em, ширина по пропорции; повороты и
// отражения — внутри SVG, с поворотом холста, как iconToSVG у Iconify: сначала отражение, потом
// поворот, строки transform те же. Без настроек результат побайтно равен файлу статики (ADR-0022) —
// это проверяет тест конвейера на всех иконках data/.

import type { Rotation } from "./customise.js";
import type { IconData } from "./icon.js";
import { cleanNumber, formatNumber } from "./number.js";

export const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export interface SvgCustomisations {
  /**
   * Ширина и высота. Нет обеих — высота 1em, ширина по пропорции; есть одна — вторая по пропорции.
   * «auto» — размер холста, «unset» и «none» — без атрибута.
   */
  width?: string;
  height?: string;
  rotate?: Rotation;
  hFlip?: boolean;
  vFlip?: boolean;
}

export interface SvgBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SvgParts {
  /** Атрибуты корня; width и height — если не сняты через «unset» или «none». */
  attributes: { width?: string; height?: string; viewBox: string };
  /** Холст после поворота. */
  box: SvgBox;
  body: string;
}

const UNSET = new Set(["unset", "none"]);

/** Вторая сторона по пропорции: число вверх до сотых, единица та же, как calculateSize у Iconify. */
export function calculateSize(size: string, ratio: number): string {
  if (ratio === 1 || UNSET.has(size)) return size;
  const match = /^(\d+(?:\.\d+)?|\.\d+)(.*)$/.exec(size);
  if (!match) return size;
  const value = Math.ceil(cleanNumber(Number(match[1]) * ratio * 100)) / 100;
  return `${formatNumber(value)}${match[2]}`;
}

/** Холст, рисунок в обёртке поворота и отражения и размеры корня. */
export function iconToSvg(
  icon: IconData,
  customisations: SvgCustomisations = {},
): SvgParts {
  const box: SvgBox = {
    left: icon.left,
    top: icon.top,
    width: icon.width,
    height: icon.height,
  };
  const transforms: string[] = [];
  let rotation: number = customisations.rotate ?? 0;
  const hFlip = customisations.hFlip ?? false;
  const vFlip = customisations.vFlip ?? false;
  if (hFlip && vFlip) {
    rotation += 2;
  } else if (hFlip) {
    transforms.push(
      `translate(${formatNumber(box.width + box.left)} ${formatNumber(0 - box.top)})`,
      "scale(-1 1)",
    );
    box.left = 0;
    box.top = 0;
  } else if (vFlip) {
    transforms.push(
      `translate(${formatNumber(0 - box.left)} ${formatNumber(box.height + box.top)})`,
      "scale(1 -1)",
    );
    box.left = 0;
    box.top = 0;
  }
  rotation %= 4;
  if (rotation === 1) {
    const center = formatNumber(box.height / 2 + box.top);
    transforms.unshift(`rotate(90 ${center} ${center})`);
  } else if (rotation === 2) {
    transforms.unshift(
      `rotate(180 ${formatNumber(box.width / 2 + box.left)} ${formatNumber(box.height / 2 + box.top)})`,
    );
  } else if (rotation === 3) {
    const center = formatNumber(box.width / 2 + box.left);
    transforms.unshift(`rotate(-90 ${center} ${center})`);
  }
  if (rotation % 2 === 1) {
    [box.left, box.top] = [box.top, box.left];
    [box.width, box.height] = [box.height, box.width];
  }
  const body =
    transforms.length > 0
      ? `<g transform="${transforms.join(" ")}">${icon.body}</g>`
      : icon.body;

  const auto = (value: string, side: number) =>
    value === "auto" ? formatNumber(side) : value;
  let width: string;
  let height: string;
  if (customisations.width === undefined) {
    height =
      customisations.height === undefined
        ? "1em"
        : auto(customisations.height, box.height);
    width = calculateSize(height, box.width / box.height);
  } else {
    width = auto(customisations.width, box.width);
    height =
      customisations.height === undefined
        ? calculateSize(width, box.height / box.width)
        : auto(customisations.height, box.height);
  }
  const viewBox = [box.left, box.top, box.width, box.height]
    .map(formatNumber)
    .join(" ");
  return {
    attributes: {
      ...(UNSET.has(width) ? {} : { width }),
      ...(UNSET.has(height) ? {} : { height }),
      viewBox,
    },
    box,
    body,
  };
}

/** Текст SVG: без пролога и без перевода строки в конце, как файл статики. */
export function svgToString(parts: SvgParts): string {
  const { width, height, viewBox } = parts.attributes;
  const xlink = parts.body.includes("xlink:")
    ? ` xmlns:xlink="${XLINK_NS}"`
    : "";
  const size = `${width === undefined ? "" : ` width="${width}"`}${height === undefined ? "" : ` height="${height}"`}`;
  return `<svg xmlns="${SVG_NS}"${xlink}${size} viewBox="${viewBox}">${parts.body}</svg>`;
}
