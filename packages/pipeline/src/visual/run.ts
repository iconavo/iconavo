// Визуальное сравнение (фаза 3, шаг 9; ADR-0035): каждое имя набора — иконка и алиас — через пакет
// выглядит так же, как SVG статики. В каждом браузере страницы по CHUNK имён: снимок экрана целиком,
// затем по клетке на имя — эталон против тега и против React, pixelmatch с порогом контроля качества
// (сглаживание краёв не в счёт). Расхождение — отличающихся пикселей больше допуска TOLERANCE; меньше
// — «в допуске», это сглаживание, оно идёт в отчёт сведениями. Контрольная клетка на каждой странице
// обязана разойтись больше допуска — иначе снимок или сравнение слепые; пустой эталон — тоже проблема.

import { createRequire } from "node:module";
import { join } from "node:path";
import type { IconavoIconSet } from "@iconavo-ui/core";
import pixelmatch from "pixelmatch";
import type { Browser } from "playwright";
import type { CdnSet } from "../cdn/load.js";
import { PIXELMATCH_THRESHOLD } from "../qc/config.js";
import { crop, type Image, overlay } from "../qc/pixels.js";
import { decodePng, pngDataUri } from "../qc/png.js";
import { type BrowserName, launchBrowser } from "../sandbox/browser.js";
import { watch } from "../sandbox/verdict.js";
import { CHUNK, CONTROL, MAX_SHOWN, TOLERANCE } from "./config.js";
import {
  allNames,
  CONTROL_SET,
  cellOf,
  cellRect,
  chunkSet,
  controlCell,
  layout,
  renderVisualPage,
  type VisualCell,
} from "./page.js";
import type { VisualServer } from "./server.js";

/** Чем рисует пакет: тег или компонент React. */
export type Renderer = "tag" | "react";

/** Расхождение с эталоном: имя, сколько пикселей и картинки для отчёта — адреса data:. */
export interface Mismatch {
  icon: string;
  pixels: number;
  images: { ref: string; own: string; diff: string };
}

export interface SetResult {
  set: string;
  names: number;
  ms: number;
  /** Сколько имён разошлось с эталоном больше допуска у тега и у React. */
  counts: Record<Renderer, number>;
  /** Первые MAX_SHOWN расхождений — картинками. */
  shown: Record<Renderer, Mismatch[]>;
  /** Отличия в допуске — сглаживание: сколько имён, больше всего пикселей, первые — картинками. */
  noise: Record<Renderer, { count: number; max: number; shown: Mismatch[] }>;
}

/** Допуск клетки — пикселей, которые могут отличаться: TOLERANCE её площади, вверх. */
export const allowed = (cell: { width: number; height: number }) =>
  Math.ceil(cell.width * cell.height * TOLERANCE);

export interface VisualResult {
  browser: BrowserName;
  /** Браузер не запустился или страница не открылась — почему. */
  failure?: string;
  sets: SetResult[];
  /** Слепая контрольная клетка, пустой эталон, ошибки страницы. */
  problems: string[];
}

/** React для серверного HTML — тот же, что у пакета React: одна копия, иначе хуки не работают. */
export interface ReactKit {
  html(sets: IconavoIconSet[], cells: VisualCell[]): string;
}

/** React и react-dom/server из packages/react, компоненты — из его сборки. */
export async function loadReact(root: string): Promise<ReactKit> {
  const require = createRequire(
    join(root, "packages", "react", "package.json"),
  );
  const { createElement } = require("react") as {
    createElement: (
      type: unknown,
      props: unknown,
      ...children: unknown[]
    ) => unknown;
  };
  const { renderToString } = require("react-dom/server") as {
    renderToString: (node: unknown) => string;
  };
  const { Icon, IconavoProvider } = await import("@iconavo-ui/react");
  return {
    html: (sets, cells) =>
      renderToString(
        createElement(
          IconavoProvider,
          { icons: sets },
          ...cells.map((c) =>
            createElement(Icon, {
              key: c.icon,
              icon: c.icon,
              width: c.width,
              height: c.height,
            }),
          ),
        ),
      ),
  };
}

export interface VisualOptions {
  sets: CdnSet[];
  browsers: readonly BrowserName[];
  server: VisualServer;
  react: ReactKit;
  log?: (line: string) => void;
}

/** Пикселей, которые разошлись: pixelmatch с порогом контроля качества (ADR-0016). */
const differing = (a: Image, b: Image) =>
  pixelmatch(a.data, b.data, undefined, a.width, a.height, {
    threshold: PIXELMATCH_THRESHOLD,
  });

/** Ничего не нарисовано: все пиксели белые, как фон страницы. */
function blank(image: Image): boolean {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) return false;
  }
  return true;
}

const uri = (image: Image) => pngDataUri(image.data, image.width, image.height);

/** Отличия в допуске с картинками — не больше на набор и вид отрисовки: только примеры. */
const NOISE_SHOWN = 8;

/** Один набор в одном браузере: страницы по CHUNK имён, снимок и сравнение по клеткам. */
async function checkSet(
  browser: Browser,
  set: CdnSet,
  o: VisualOptions,
  problems: string[],
): Promise<SetResult> {
  const start = Date.now();
  const names = allNames(set.file);
  const result: SetResult = {
    set: set.id,
    names: names.length,
    ms: 0,
    counts: { tag: 0, react: 0 },
    shown: { tag: [], react: [] },
    noise: {
      tag: { count: 0, max: 0, shown: [] },
      react: { count: 0, max: 0, shown: [] },
    },
  };
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    for (let from = 0; from < names.length; from += CHUNK) {
      const chunk = names.slice(from, from + CHUNK);
      const cells = [...chunk.map((n) => cellOf(set.file, n)), controlCell()];
      const sets = [chunkSet(set.file, chunk), CONTROL_SET];
      const l = layout(cells);
      const path = o.server.put(
        renderVisualPage(cells, sets, o.react.html(sets, cells), l),
      );
      try {
        await page.setViewportSize(l.viewport);
        await page.goto(`${o.server.base}${path}`, {
          waitUntil: "load",
          timeout: 120_000,
        });
        await page.waitForFunction(() => document.body.dataset.ready, null, {
          timeout: 120_000,
        });
        const ready = await page.evaluate(() => document.body.dataset.ready);
        if (ready !== "1")
          problems.push(`${set.id}, имена с ${from}: ${ready}`);
        const shot = decodePng(
          await page.screenshot({ caret: "initial", animations: "disabled" }),
        );
        for (const [i, cell] of cells.entries()) {
          const rect = cellRect(l, cell, i);
          const [ref, tag, react] = l.tops.map((top) =>
            crop(shot, { ...rect, y: rect.y + top }),
          ) as [Image, Image, Image];
          const own: Record<Renderer, Image> = { tag, react };
          const pixels: Record<Renderer, number> = {
            tag: differing(ref, tag),
            react: differing(ref, react),
          };
          const limit = allowed(cell);
          if (cell.icon === `${CONTROL.prefix}:${CONTROL.name}`) {
            for (const r of ["tag", "react"] as const) {
              if (pixels[r] <= limit) {
                problems.push(
                  `${set.id}, имена с ${from}: контрольная клетка у ${r === "tag" ? "тега" : "React"} не разошлась с эталоном больше допуска (${pixels[r]} пикс.) — проверка слепая`,
                );
              }
            }
            continue;
          }
          if (blank(ref)) problems.push(`эталон пустой: ${cell.icon}`);
          for (const r of ["tag", "react"] as const) {
            if (pixels[r] === 0) continue;
            const mismatch = (): Mismatch => ({
              icon: cell.icon,
              pixels: pixels[r],
              images: {
                ref: uri(ref),
                own: uri(own[r]),
                diff: uri(overlay(ref, own[r])),
              },
            });
            if (pixels[r] <= limit) {
              const noise = result.noise[r];
              noise.count++;
              noise.max = Math.max(noise.max, pixels[r]);
              if (noise.shown.length < NOISE_SHOWN)
                noise.shown.push(mismatch());
              continue;
            }
            result.counts[r]++;
            if (result.shown[r].length < MAX_SHOWN) {
              result.shown[r].push(mismatch());
            }
          }
        }
      } finally {
        o.server.drop(path);
      }
      o.log?.(
        `${set.id}: ${Math.min(from + CHUNK, names.length)} из ${names.length}`,
      );
    }
    for (const error of new Set(seen.errors)) {
      problems.push(`${set.id}: ошибка страницы — ${error}`);
    }
    for (const warning of new Set(seen.warnings)) {
      if (warning.startsWith("Iconavo:")) {
        problems.push(`${set.id}: предупреждение — ${warning}`);
      }
    }
  } finally {
    await context.close();
  }
  result.ms = Date.now() - start;
  return result;
}

async function checkBrowser(
  name: BrowserName,
  o: VisualOptions,
): Promise<VisualResult> {
  const result: VisualResult = { browser: name, sets: [], problems: [] };
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser(name, true);
    for (const set of o.sets) {
      result.sets.push(await checkSet(browser, set, o, result.problems));
    }
  } catch (e) {
    result.failure = (e as Error).message.split("\n")[0];
  } finally {
    await browser?.close();
  }
  return result;
}

/** Все браузеры по очереди: так не съесть память. */
export async function checkVisual(o: VisualOptions): Promise<VisualResult[]> {
  const results: VisualResult[] = [];
  for (const name of o.browsers) {
    o.log?.(`${name}…`);
    results.push(await checkBrowser(name, o));
  }
  return results;
}

/** Провал: браузер не прошёл до конца, есть проблема или хоть одно расхождение. */
export const visualFailed = (results: VisualResult[]) =>
  results.some(
    (r) =>
      r.failure !== undefined ||
      r.problems.length > 0 ||
      r.sets.some((s) => s.counts.tag + s.counts.react > 0),
  );
