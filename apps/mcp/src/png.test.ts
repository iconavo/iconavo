// Настоящий рисовальщик: resvg из node_modules (в Workers модуль приходит импортом, здесь — байтами),
// иконки — из data/: картинка-сетка нужного размера, иконки видны.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { iconData } from "@iconavo-ui/core/internal";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { gridSvg } from "./grid.js";
import { renderPng, toBase64 } from "./png.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  await initWasm(
    readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
  );
});

function icon(set: string, name: string) {
  const data = JSON.parse(
    readFileSync(join(ROOT, "data", set, "icons.json"), "utf8"),
  );
  const found = iconData(data, name);
  if (found === null) throw new Error(`нет ${set}:${name}`);
  return found;
}

describe("renderPng", () => {
  it("сетка из монохромных и цветных иконок: PNG 384 × 96, в клетках не только фон", () => {
    const grid = gridSvg([
      icon("lucide", "house"),
      icon("tabler", "heart"),
      icon("fluent-emoji-flat", "swan"),
      icon("material-symbols", "search"),
    ]);
    const png = renderPng(grid.svg);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(384);
    expect(view.getUint32(20)).toBe(96);

    // Середина каждой клетки — не белая: иконки нарисованы.
    const resvg = new Resvg(grid.svg, { font: { loadSystemFonts: false } });
    const image = resvg.render();
    const pixels = image.pixels;
    const width = image.width;
    for (let cell = 0; cell < 4; cell++) {
      let ink = 0;
      for (let y = 24; y < 72; y++) {
        for (let x = cell * 96 + 24; x < cell * 96 + 72; x++) {
          const i = (y * width + x) * 4;
          if ((pixels[i] ?? 255) < 200) ink++;
        }
      }
      expect(ink, `клетка ${cell + 1}`).toBeGreaterThan(50);
    }
    image.free();
    resvg.free();
  });

  it("toBase64 — как у Buffer, и для больших картинок", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
