// Готовый SVG для статики (ADR-0004, ADR-0006): как у SVG-адреса Iconify без параметров — высота
// 1em, ширина по пропорции, viewBox из размеров иконки (ADR-0031). Повороты и отражения здесь не
// поддерживаются: загрузка набора останавливает сборку, если они есть в данных.

import { cleanNumber, formatNumber } from "../normalize/canvas.js";
import { SVG_NS } from "../svg/xml.js";

/** Иконка с учётом размеров набора и цепочки алиасов. */
export interface CdnIcon {
  body: string;
  width: number;
  height: number;
  left: number;
  top: number;
}

/** Ширина в em при высоте 1em: пропорция, округлённая вверх до сотых, как calculateSize у Iconify. */
export function widthEm(width: number, height: number): string {
  const ratio = width / height;
  if (ratio === 1) return "1em";
  return `${formatNumber(Math.ceil(cleanNumber(ratio * 100)) / 100)}em`;
}

/** Файл .svg: без пролога и без перевода строки в конце. */
export function svgOf(icon: CdnIcon): string {
  const viewBox = [icon.left, icon.top, icon.width, icon.height]
    .map(formatNumber)
    .join(" ");
  return `<svg xmlns="${SVG_NS}" width="${widthEm(icon.width, icon.height)}" height="1em" viewBox="${viewBox}">${icon.body}</svg>`;
}
