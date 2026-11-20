import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPicker,
  bundleBrowser,
  PICKER_CSS,
  PICKER_ENTRY,
  PICKER_GZIP_BUDGET,
  pickerHtml,
  pickerVersion,
  SITE_TOKENS,
  themeTokens,
} from "./picker-build.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Имена переменных CSS, объявленных в тексте. */
const declared = (css: string) =>
  new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string));

describe("токены сайта для сетки", () => {
  it("все цвета @theme — парами light-dark, радиусы, размеры текста и тень; без шаблонов Tailwind и шрифта сайта", async () => {
    const site = await readFile(join(ROOT, SITE_TOKENS), "utf8");
    const tokens = themeTokens(site);
    const colors = [
      ...site.matchAll(/^\s*(--color-[\w-]+):\s*light-dark/gm),
    ].map((m) => m[1]);
    expect(colors.length).toBeGreaterThanOrEqual(34);
    for (const name of colors) expect(tokens).toContain(`${name}: light-dark(`);
    expect(tokens).toContain("--radius-md: 0.5rem;");
    expect(tokens).toContain("--text-body-sm--line-height: 1.0625rem;");
    expect(tokens).toMatch(/--shadow-md: 0 4px 12px light-dark\(/);
    expect(tokens).not.toMatch(/\*\s*:|--font-sans|\/\*/);
    expect(tokens.startsWith(":root {\n")).toBe(true);
  });
});

describe("стили сетки", () => {
  it("только токены: каждая переменная без запасного значения объявлена, своих цветов нет", async () => {
    const [site, own] = await Promise.all([
      readFile(join(ROOT, SITE_TOKENS), "utf8"),
      readFile(join(ROOT, PICKER_CSS), "utf8"),
    ]);
    const known = new Set([...declared(themeTokens(site)), ...declared(own)]);
    const used = [...own.matchAll(/var\((--[\w-]+)\s*\)/g)].map(
      (m) => m[1] as string,
    );
    expect(used.length).toBeGreaterThan(20);
    for (const name of used) expect(known.has(name), name).toBe(true);
    const code = own.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(code).not.toMatch(
      /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i,
    );
    expect(code).not.toMatch(/!important/);
  });
});

describe("страница сетки", () => {
  it("один встроенный стиль и один встроенный скрипт; лишний тег или метка сборки — «СТОП»", () => {
    const html = pickerHtml("console.log(1)", ":root{}");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(
      '<main id="picker" class="picker" aria-busy="true"></main>',
    );
    expect(() => pickerHtml('const a = "<script>";', "")).toThrow(/лишние/);
    expect(() => pickerHtml('const a = "</style>";', "")).toThrow(/лишние/);
    expect(() => pickerHtml('const a = "__ICONAVO_BUILD__";', "")).toThrow(
      /заглушка метки/,
    );
  });

  it("собранная страница: самодостаточна, в бюджете, версия — 8 знаков отпечатка, повтор сборки — те же байты", async () => {
    const build = await buildPicker(ROOT);
    expect(build.version).toBe(pickerVersion(build.html));
    expect(build.version).toMatch(/^[0-9a-f]{8}$/);
    expect(build.gzipBytes).toBeLessThanOrEqual(PICKER_GZIP_BUDGET);
    // Ни одного внешнего адреса у тегов: рамка клиента без сети.
    expect(build.html).not.toMatch(/<(link|img|iframe)\b/i);
    expect(build.html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(build.html).toContain('<script type="module">');
    // Вид в странице — не функция: в нём нет кода сервера SDK и метки сборки.
    expect(build.html).not.toContain("createMcpHandler");
    const again = await bundleBrowser(ROOT, PICKER_ENTRY);
    expect(build.html).toContain(again);
  });
});
