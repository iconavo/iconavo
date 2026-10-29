import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Прототип сайта — только на токенах (ADR-0038): цвета вписываются в app/globals.css, в блоки @theme и
// тёмной темы, а страницы и компоненты берут их классами. Так редизайн фазы 6 — замена токенов, а не
// правка страниц.

const site = join(import.meta.dirname, "..");

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/;

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(site, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && ext.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

describe("токены вместо значений", () => {
  it("в страницах и компонентах нет цветов, своих значений Tailwind и атрибутов style", () => {
    const problems = [
      ...files("app", /\.tsx$/),
      ...files("components", /\.tsx$/),
    ].flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [
        COLOR.test(text) ? `${file}: цвет` : "",
        /className="[^"]*-\[/.test(text)
          ? `${file}: своё значение Tailwind`
          : "",
        /\bstyle=\{/.test(text) ? `${file}: атрибут style` : "",
      ].filter(Boolean);
    });
    expect(problems).toEqual([]);
  });

  it("в globals.css цвета — только в блоках токенов", () => {
    const css = readFileSync(join(site, "app", "globals.css"), "utf8")
      .replace(/@theme \{[^}]*\}/, "")
      .replace(
        /@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*\}\s*\}/,
        "",
      );
    expect(css).not.toMatch(COLOR);
  });
});
