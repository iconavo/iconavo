// Картинка-сетка search_icons (ADR-0044, шаг 10 фазы 4): одна SVG-картинка с пронумерованными
// клетками, которую resvg превращает в PNG. Модель со зрением видит результат целиком, а номер
// клетки — номер иконки в текстовом списке ответа.
// - Клетка 96 px, иконка 48 px по центру, неквадратная — вписывается по большей стороне.
// - ID каждой клетки свои (replaceIds ядра): градиенты и маски Fluent Emoji не путаются между собой.
// - currentColor монохромных наборов — тёмный цвет на белом фоне.

import { type IconData, replaceIds } from "@iconavo-ui/core/internal";
import { GRID } from "./config.js";
import { numberSvg } from "./digits.js";

export interface GridOptions {
  /** Колонок; по умолчанию — от числа иконок (GRID.columns). */
  columns?: number;
}

export interface GridSvg {
  svg: string;
  width: number;
  height: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Сетка из иконок по порядку; клетка без рисунка (null) — пустая, но с номером. */
export function gridSvg(
  icons: readonly (IconData | null)[],
  options: GridOptions = {},
): GridSvg {
  if (icons.length === 0) throw new Error("сетка без иконок");
  const columns = options.columns ?? GRID.columns(icons.length);
  const rows = Math.ceil(icons.length / columns);
  const width = columns * GRID.cell;
  const height = rows * GRID.cell;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" color="${GRID.ink}">`,
    `<rect width="${width}" height="${height}" fill="${GRID.background}"/>`,
  ];
  const lines: string[] = [];
  for (let c = 1; c < columns; c++) lines.push(`M${c * GRID.cell} 0v${height}`);
  for (let r = 1; r < rows; r++) lines.push(`M0 ${r * GRID.cell}h${width}`);
  if (lines.length > 0) {
    parts.push(
      `<path d="${lines.join("")}" stroke="${GRID.line}" stroke-width="1" fill="none"/>`,
    );
  }
  icons.forEach((icon, i) => {
    const x0 = (i % columns) * GRID.cell;
    const y0 = Math.floor(i / columns) * GRID.cell;
    parts.push(
      numberSvg(
        i + 1,
        x0 + GRID.digitInset,
        y0 + GRID.digitInset,
        GRID.digit,
        GRID.number,
      ),
    );
    if (icon === null) return;
    const ratio = icon.width / icon.height;
    const w = ratio >= 1 ? GRID.icon : GRID.icon * ratio;
    const h = ratio >= 1 ? GRID.icon / ratio : GRID.icon;
    const body = replaceIds(icon.body, () => `c${i}_`);
    parts.push(
      `<svg x="${round(x0 + (GRID.cell - w) / 2)}" y="${round(y0 + (GRID.cell - h) / 2)}" width="${round(w)}" height="${round(h)}" viewBox="${icon.left} ${icon.top} ${icon.width} ${icon.height}">${body}</svg>`,
    );
  });
  parts.push("</svg>");
  return { svg: parts.join(""), width, height };
}
