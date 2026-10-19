// Рисунок иконок через resvg (ADR-0016). Сборка resvg в WebAssembly: память освобождается явно
// (free), а картинка не зависит от системных библиотек — у CI и у вас одни и те же пиксели.
// Шрифты не загружаются: санитайзер не пропускает <text>.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { initWasm, Resvg, type ResvgRenderOptions } from "@resvg/resvg-wasm";
import { formatNumber } from "../normalize/canvas.js";
import type { NormalizedIcon } from "../normalize/normalize.js";
import { SVG_NS } from "../svg/xml.js";
import { MARGIN, RENDER_SIZE } from "./config.js";
import { type Image, type Rect, unpremultiply } from "./pixels.js";

let ready: Promise<void> | undefined;

/** Загружает resvg; повторные вызовы ждут ту же загрузку. */
export function initRenderer(): Promise<void> {
  ready ??= (async () => {
    const wasm = createRequire(import.meta.url).resolve(
      "@resvg/resvg-wasm/index_bg.wasm",
    );
    try {
      await initWasm(await readFile(wasm));
    } catch (e) {
      // resvg загружается один раз на процесс. В тестах этот файл может выполниться заново,
      // а resvg уже загружен — это не ошибка.
      if (!(e as Error).message.includes("Already initialized")) throw e;
    }
  })();
  return ready;
}

const OPTIONS: ResvgRenderOptions = { font: { loadSystemFonts: false } };

/** Рисует SVG. resvg отдаёт цвет, умноженный на прозрачность, — переводим в обычный. */
function draw(svg: string, fitTo?: ResvgRenderOptions["fitTo"]): Image {
  const resvg = new Resvg(svg, fitTo ? { ...OPTIONS, fitTo } : OPTIONS);
  try {
    const rendered = resvg.render();
    try {
      return unpremultiply({
        width: rendered.width,
        height: rendered.height,
        data: rendered.pixels,
      });
    } finally {
      rendered.free();
    }
  } finally {
    resvg.free();
  }
}

/** Пикселей на единицу сетки: сетка набора рисуется в RENDER_SIZE пикселей. */
const scaleOf = (grid: number) => RENDER_SIZE / grid;

/** Холст иконки в пикселях внутри рисунка с запасом. */
export function canvasRect(icon: NormalizedIcon, grid: number): Rect {
  const scale = scaleOf(grid);
  return {
    x: MARGIN,
    y: MARGIN,
    width: Math.round(icon.width * scale),
    height: Math.round(icon.height * scale),
  };
}

/**
 * Иконка с запасом MARGIN пикселей вокруг холста — для resvg и для картинки браузера в отчёте.
 * Запас — целое число пикселей, поэтому пиксели холста те же, что без запаса. color нужен для
 * currentColor.
 */
export function paddedSvg(icon: NormalizedIcon, grid: number): string {
  const rect = canvasRect(icon, grid);
  const pad = MARGIN / scaleOf(grid);
  const box = [-pad, -pad, icon.width + 2 * pad, icon.height + 2 * pad]
    .map(formatNumber)
    .join(" ");
  return `<svg xmlns="${SVG_NS}" viewBox="${box}" width="${rect.width + 2 * MARGIN}" height="${rect.height + 2 * MARGIN}" preserveAspectRatio="none" color="#000">${icon.body}</svg>`;
}

export interface IconRender {
  /** Рисунок с запасом MARGIN пикселей с каждой стороны. */
  image: Image;
  /** Холст иконки внутри рисунка. */
  canvas: Rect;
}

/** Рисует иконку с запасом вокруг холста. Если resvg не справился — исключение. */
export function renderIcon(icon: NormalizedIcon, grid: number): IconRender {
  return {
    image: draw(paddedSvg(icon, grid)),
    canvas: canvasRect(icon, grid),
  };
}

/**
 * Рисует исходный файл автора со своим холстом (у Material Symbols это 0 -960 960 960) в ширину
 * холста иконки — так его пиксели совпадают с пикселями результата.
 */
export function renderSource(source: string, width: number): Image {
  return draw(source.replace(/^﻿/, ""), { mode: "width", value: width });
}
