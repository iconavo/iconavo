import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng } from "../qc/png.js";
import { pngFacts } from "./code.js";
import { readmeImport, readmeScript } from "./crawl.js";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const readme = readFileSync(
  join(root, "packages", "icon", "README.md"),
  "utf8",
);

describe("ожидания строки «Код» из README тега", () => {
  it("скрипт с хэшем и стиль — как в README, по строке", () => {
    const [script, style] = readmeScript(readme).split("\n");
    expect(script).toMatch(
      /^<script type="module" src=".+" integrity="sha384-.+"><\/script>$/,
    );
    expect(style).toMatch(
      /^<style>iconavo-icon:not\(:defined\) \{.+\}<\/style>$/,
    );
  });

  it("строка подключения тега", () => {
    expect(readmeImport(readme)).toBe(
      'import "@iconavo-ui/icon"; // registers <iconavo-icon>',
    );
  });
});

describe("PNG строки «Скачивание»", () => {
  it("размер, закрашенные точки и средний цвет закрашенного", () => {
    // 2×2: две точки цвета e11d48, одна прозрачная, одна полупрозрачная — не в счёт.
    const rgba = new Uint8Array([
      225, 29, 72, 255, 225, 29, 72, 255, 0, 0, 0, 0, 0, 0, 0, 100,
    ]);
    expect(pngFacts(encodePng(rgba, 2, 2))).toEqual({
      width: 2,
      height: 2,
      painted: 2,
      rgb: [225, 29, 72],
    });
  });

  it("пустая картинка — ни одной закрашенной точки", () => {
    expect(pngFacts(encodePng(new Uint8Array(16), 2, 2)).painted).toBe(0);
  });
});
