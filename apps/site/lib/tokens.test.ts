import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Прототип сайта — только на токенах (ADR-0038): цвета вписываются в app/globals.css, в единственный
// блок @theme, а страницы и компоненты берут их классами. Так редизайн фазы 6 — замена токенов, а не
// правка страниц.

const site = join(import.meta.dirname, "..");

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/;

/** Классы стандартной палитры Tailwind: она сброшена в @theme, такие классы ничего не красят. */
const PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|divide|decoration|accent|caret|placeholder|from|via|to|shadow)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b/;

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(site, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && ext.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

/** Строки исходника — в кавычках и обратных кавычках, без комментариев. */
function stringLiterals(source: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) break;
    } else if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2);
      if (i < 0) break;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") j++;
        j++;
      }
      found.push(source.slice(i + 1, j));
      i = j + 1;
    } else {
      i++;
    }
  }
  return found;
}

/** Свои значения Tailwind в строке классов: [8rem], data-[state=open]:, [&_svg]:, origin-(--x). */
const ARBITRARY = /(^|\s)\S*(\[|\(--)\S*/;

const tsx = () => [...files("app", /\.tsx$/), ...files("components", /\.tsx$/)];

describe("токены вместо значений", () => {
  it("в страницах, компонентах и историях нет цветов, своих значений Tailwind и атрибутов style", () => {
    const problems = tsx().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const strings = stringLiterals(text);
      return [
        COLOR.test(text) ? `${file}: цвет` : "",
        strings.some((s) => ARBITRARY.test(s))
          ? `${file}: своё значение Tailwind — ${strings.find((s) => ARBITRARY.test(s))}`
          : "",
        strings.some((s) => PALETTE.test(s))
          ? `${file}: класс стандартной палитры`
          : "",
        /\bstyle=\{/.test(text) ? `${file}: атрибут style` : "",
      ].filter(Boolean);
    });
    expect(problems).toEqual([]);
  });

  it("цвета — только в единственном блоке @theme, палитра и тени Tailwind сброшены", () => {
    const css = readFileSync(join(site, "app", "globals.css"), "utf8");
    const blocks = css.match(/@theme \{[^}]*\}/g) ?? [];
    expect(blocks).toHaveLength(1);
    const theme = blocks[0] as string;
    for (const reset of ["--color-*: initial;", "--shadow-*: initial;"]) {
      expect(theme).toContain(reset);
    }
    expect(css.replace(theme, "")).not.toMatch(COLOR);
    // Другие файлы стилей сайта — без цветов: токены живут в одном месте.
    for (const file of files("app", /\.css$/)) {
      if (!file.endsWith("globals.css")) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(COLOR);
      }
    }
  });
});

/** Пары цветов токена: светлая и тёмная тема. */
function tokenColors(): Map<string, [string, string]> {
  const css = readFileSync(join(site, "app", "globals.css"), "utf8");
  const theme = css.match(/@theme \{[^}]*\}/)?.[0] ?? "";
  return new Map(
    [
      ...theme.matchAll(
        /--color-([a-z-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\);/g,
      ),
    ].map((m) => [m[1] as string, [m[2] as string, m[3] as string]]),
  );
}

/** Контраст по WCAG 2.2: относительная яркость двух цветов #rrggbb. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

describe("контраст токенов (WCAG 2.2 AA)", () => {
  const colors = tokenColors();
  // Текст — 4,5:1 (1.4.3); рамки полей и фокус — 3:1 (1.4.11, 2.4.7). line — разделители, без порога.
  const pairs: [string, string, number][] = [
    ["fg", "bg", 4.5],
    ["muted", "bg", 4.5],
    ["accent", "bg", 4.5],
    ["fg", "surface", 4.5],
    ["muted", "surface", 4.5],
    ["bg", "accent", 4.5],
    ["control", "bg", 3],
    ["control", "surface", 3],
    ["focus", "bg", 3],
  ];

  it("у каждого токена цвета — пара light-dark", () => {
    expect([...colors.keys()].sort()).toEqual([
      "accent",
      "bg",
      "control",
      "fg",
      "focus",
      "line",
      "muted",
      "surface",
    ]);
  });

  for (const [fg, bg, min] of pairs) {
    it(`${fg} на ${bg} — не ниже ${min}:1 в обеих темах`, () => {
      const [fgLight, fgDark] = colors.get(fg) as [string, string];
      const [bgLight, bgDark] = colors.get(bg) as [string, string];
      expect(contrast(fgLight, bgLight)).toBeGreaterThanOrEqual(min);
      expect(contrast(fgDark, bgDark)).toBeGreaterThanOrEqual(min);
    });
  }
});
