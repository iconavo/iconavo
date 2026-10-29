// Страница визуального сравнения (фаза 3, шаг 9; ADR-0035): кусок имён набора тремя одинаковыми
// сетками — эталон, тег и React. Эталон — SVG-файл статики (svgOf, тот же код и те же байты, что у
// cdn.iconavo.dev) в <img>: браузер читает его как отдельный документ, без кода пакета. Тег ставит
// скрипт страницы, данные — через addIcons, без сети. React — серверный HTML IconavoProvider и Icon,
// как его отдаёт Next.js. Клетки и сетки стоят в целых пикселях: снимок режется на клетки по расчёту,
// а не по разметке. Здесь только чистые функции: страница — строка.

import type { IconavoIconSet } from "@iconavo-ui/core";
import type { IconsFile } from "@iconavo-ui/schema";
import { effectiveIcon, resolveChain } from "../cdn/files.js";
import { svgOf } from "../cdn/svg.js";
import type { Rect } from "../qc/pixels.js";
import { esc, svgDataUri } from "../report/html.js";
import { cspHash, jsonInScript } from "../sandbox/page.js";
import {
  COLUMNS,
  CONTROL,
  GAP,
  GRID_GAP,
  ICON_SCRIPT,
  SCALE,
} from "./config.js";

/** Клетка: полное имя, размер в пикселях и эталон — текст SVG. */
export interface VisualCell {
  icon: string;
  width: number;
  height: number;
  ref: string;
}

/** Данные для скрипта страницы: client.ts читает их из блока #visual-data. */
export interface VisualData {
  sets: IconavoIconSet[];
  cells: { icon: string; width: number; height: number }[];
}

/** Раскладка страницы: клетка, сетка и где стоят три сетки, всё в целых пикселях. */
export interface Layout {
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  gridWidth: number;
  gridHeight: number;
  /** Верх сеток эталона, тега и React. */
  tops: [number, number, number];
  viewport: { width: number; height: number };
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Все имена набора — иконки и алиасы, по кодам символов, как у файлов статики. */
export const allNames = (file: IconsFile) =>
  [...Object.keys(file.icons), ...Object.keys(file.aliases ?? {})].sort(order);

/** Клетка имени: размер — сетка иконки × SCALE, эталон — SVG статики. */
export function cellOf(file: IconsFile, name: string): VisualCell {
  const icon = effectiveIcon(file, name);
  return {
    icon: `${file.prefix}:${name}`,
    width: icon.width * SCALE,
    height: icon.height * SCALE,
    ref: svgOf(icon),
  };
}

/** Контрольная клетка: эталон — круг, пакет рисует круг меньше. */
export const controlCell = (): VisualCell => ({
  icon: `${CONTROL.prefix}:${CONTROL.name}`,
  width: CONTROL.width * SCALE,
  height: CONTROL.height * SCALE,
  ref: svgOf({
    body: CONTROL.ref,
    width: CONTROL.width,
    height: CONTROL.height,
    left: 0,
    top: 0,
  }),
});

/** Набор контрольной клетки — для addIcons и обёртки React. */
export const CONTROL_SET: IconavoIconSet = {
  prefix: CONTROL.prefix,
  width: CONTROL.width,
  height: CONTROL.height,
  icons: { [CONTROL.name]: { body: CONTROL.body } },
};

/**
 * Данные куска для addIcons и обёртки: записи имён как в icons.json, у алиасов — вся цепочка и
 * иконка в её конце, даже если она в другом куске.
 */
export function chunkSet(file: IconsFile, names: string[]): IconavoIconSet {
  const out: IconavoIconSet = { prefix: file.prefix, icons: {} };
  for (const key of ["width", "height", "left", "top"] as const) {
    if (file[key] !== undefined) out[key] = file[key];
  }
  for (const name of names) {
    const { parent, icon, chain } = resolveChain(file, name);
    out.icons[parent] = icon as IconavoIconSet["icons"][string];
    if (Object.keys(chain).length > 0) {
      out.aliases = {
        ...out.aliases,
        ...(chain as NonNullable<IconavoIconSet["aliases"]>),
      };
    }
  }
  return out;
}

/**
 * Раскладка куска: клетка — по самой большой иконке, сетки — одна под другой с шагом, кратным 512 px.
 * Браузер рисует страницу плитками, и сглаживание края зависит от места иконки внутри плитки: при
 * одинаковом месте у тега и React расходится меньше пикселей края (замер Chrome 28 октября 2026).
 */
export function layout(cells: VisualCell[]): Layout {
  const cellWidth = Math.max(...cells.map((c) => c.width));
  const cellHeight = Math.max(...cells.map((c) => c.height));
  const columns = Math.min(COLUMNS, cells.length);
  const rows = Math.ceil(cells.length / columns);
  const gridWidth = columns * cellWidth + (columns - 1) * GAP;
  const gridHeight = rows * cellHeight + (rows - 1) * GAP;
  const step = Math.ceil((gridHeight + GRID_GAP) / 512) * 512;
  return {
    cellWidth,
    cellHeight,
    columns,
    rows,
    gridWidth,
    gridHeight,
    tops: [0, step, 2 * step],
    viewport: { width: gridWidth, height: 2 * step + gridHeight },
  };
}

/** Иконка клетки внутри сетки: левый верхний угол клетки и размер самой иконки. */
export function cellRect(l: Layout, cell: VisualCell, index: number): Rect {
  return {
    x: (index % l.columns) * (l.cellWidth + GAP),
    y: Math.floor(index / l.columns) * (l.cellHeight + GAP),
    width: cell.width,
    height: cell.height,
  };
}

/** Пакет — скрипт для страниц без сборщика: addIcons и configure скрипт страницы берёт из него. */
export const VISUAL_IMPORT_MAP = JSON.stringify({
  imports: { "@iconavo-ui/icon": ICON_SCRIPT },
});

export function renderVisualPage(
  cells: VisualCell[],
  sets: IconavoIconSet[],
  react: string,
  l: Layout,
): string {
  const data: VisualData = {
    sets,
    cells: cells.map(({ icon, width, height }) => ({ icon, width, height })),
  };
  const refs = cells
    .map(
      (c) =>
        `<img src="${svgDataUri(c.ref)}" width="${c.width}" height="${c.height}" alt="">`,
    )
    .join("");
  const csp = `default-src 'none'; script-src 'self' '${cspHash(VISUAL_IMPORT_MAP)}'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<link rel="icon" href="data:,">
<title>Visual check</title>
<style>
:root { color-scheme: light; }
html, body { margin: 0; background: #fff; color: #000; }
.grid { position: absolute; left: 0; width: ${l.gridWidth}px; display: grid; grid-template-columns: repeat(${l.columns}, ${l.cellWidth}px); grid-auto-rows: ${l.cellHeight}px; gap: ${GAP}px; }
.grid > * { place-self: start; }
#ref { top: ${l.tops[0]}px; } #tag { top: ${l.tops[1]}px; } #react { top: ${l.tops[2]}px; }
</style>
<script type="importmap">${VISUAL_IMPORT_MAP}</script>
<script type="application/json" id="visual-data">${jsonInScript(data)}</script>
<script type="module" src="/visual.js"></script>
</head>
<body>
<div class="grid" id="ref">${refs}</div>
<div class="grid" id="tag"></div>
<div class="grid" id="react">${react}</div>
</body>
</html>
`;
}
