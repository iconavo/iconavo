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

  it("панели со своей темой объявляют заново все токены с light-dark — значениями из @theme", () => {
    // Lightning CSS вычисляет light-dark() у :root, и без этого превью «на тёмном фоне» осталось бы светлым.
    const css = readFileSync(join(site, "app", "globals.css"), "utf8");
    // Длинные строки Biome переносит: пробелы внутри --theme(…) не в счёт.
    const rule = (/\.preview-light,[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? "")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const tokens = [
      ...[...tokenColors().keys()].map((name) => `--color-${name}`),
      "--shadow-md",
    ];
    for (const token of tokens) {
      expect(rule).toContain(`${token}: --theme(${token} inline);`);
    }
  });
});

/** Пары цветов токена: светлая и тёмная тема; цвет — #rrggbb или полупрозрачный #rrggbbaa, как в Figma. */
function tokenColors(): Map<string, [string, string]> {
  const css = readFileSync(join(site, "app", "globals.css"), "utf8");
  const theme = css.match(/@theme \{[^}]*\}/)?.[0] ?? "";
  return new Map(
    [
      ...theme.matchAll(
        /--color-([a-z0-9-]+): light-dark\((#[0-9a-f]{6}(?:[0-9a-f]{2})?), (#[0-9a-f]{6}(?:[0-9a-f]{2})?)\);/g,
      ),
    ].map((m) => [m[1] as string, [m[2] as string, m[3] as string]]),
  );
}

type Rgb = [number, number, number];

/** Цвет поверх фона: полупрозрачный смешивается с ним, как его покажет браузер. */
function over(hex: string, under: Rgb): Rgb {
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  const a = hex.length === 9 ? n(7) / 255 : 1;
  return [1, 3, 5].map(
    (i, k) => n(i) * a + (under[k] as number) * (1 - a),
  ) as Rgb;
}

/** Контраст по WCAG 2.2: относительная яркость двух цветов. */
function contrast(a: Rgb, b: Rgb): number {
  const luminance = (rgb: Rgb) => {
    const [r, g, bl] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Имена переменных [Color] Semantic макета (Figma «Iconavo — Макеты»): bg/surfaceMuted → bg-surface-muted. */
const FIGMA_TOKENS = [
  "accent-cyan",
  "accent-highlight",
  "accent-highlight-subtle",
  "accent-lemon",
  "accent-mint",
  "bg-card-hover",
  "bg-hover",
  "bg-icon-card",
  "bg-inverse",
  "bg-inverse-hover",
  "bg-overlay",
  "bg-page",
  "bg-surface",
  "bg-surface-muted",
  "bg-surface-strong",
  "border-primary",
  "border-secondary",
  "border-secondary-20",
  "link-unicode",
  "selection-bg",
  "selection-text",
  "status-badge",
  "status-danger",
  "status-success",
  "text-danger",
  "text-hover-muted",
  "text-inverse",
  "text-muted",
  "text-on-accent",
  "text-on-danger",
  "text-primary",
  "text-primary-hover",
  "text-secondary",
  "text-success",
];

describe("контраст токенов (WCAG 2.2 AA)", () => {
  const colors = tokenColors();
  // Текст — 4,5:1 (1.4.3); рамки полей и фокус — 3:1 (1.4.11, 2.4.7). Рамка фокуса — selection/bg, как
  // у поля поиска в макете. border/secondary — разделители, без порога.
  const pairs: [string, string, number][] = [
    ["text-primary", "bg-page", 4.5],
    ["text-primary", "bg-surface", 4.5],
    ["text-secondary", "bg-page", 4.5],
    ["text-secondary", "bg-surface", 4.5],
    // Выбранный набор в сайдбаре и подписи блоков кода в панели (решение владельца 13 ноября 2026).
    ["text-secondary", "bg-surface-strong", 4.5],
    ["link-unicode", "bg-page", 4.5],
    ["link-unicode", "bg-surface", 4.5],
    ["text-on-accent", "accent-highlight", 4.5],
    ["text-inverse", "bg-inverse", 4.5],
    ["selection-text", "selection-bg", 4.5],
    ["text-danger", "bg-page", 4.5],
    ["selection-bg", "bg-page", 3],
    ["selection-bg", "bg-surface", 3],
  ];
  // Цвета перенесены из макета как есть, решение владельца 12 ноября 2026: он поправит их в токенах сам.
  // Эти пары пока ниже порога — тест ждёт провала. Поправили цвет — тест упадёт: уберите пару отсюда и
  // перенесите её в pairs выше.
  const knownLow: [string, string, number][] = [
    ["text-muted", "bg-page", 4.5],
    ["text-muted", "bg-surface", 4.5],
    ["text-hover-muted", "bg-page", 4.5],
    ["border-primary", "bg-page", 3],
    ["border-primary", "bg-surface", 3],
  ];

  it("у каждого токена цвета — пара light-dark, имена — переменные макета", () => {
    expect([...colors.keys()].sort()).toEqual(FIGMA_TOKENS);
  });

  /** Контраст пары в обеих темах: фон — поверх bg/page, цвет — поверх фона. */
  const both = (fg: string, bg: string): [number, number] => {
    const [fgLight, fgDark] = colors.get(fg) as [string, string];
    const [bgLight, bgDark] = colors.get(bg) as [string, string];
    const [pageLight, pageDark] = colors.get("bg-page") as [string, string];
    const light = over(bgLight, over(pageLight, [255, 255, 255]));
    const dark = over(bgDark, over(pageDark, [0, 0, 0]));
    return [
      contrast(over(fgLight, light), light),
      contrast(over(fgDark, dark), dark),
    ];
  };

  for (const [fg, bg, min] of pairs) {
    it(`${fg} на ${bg} — не ниже ${min}:1 в обеих темах`, () => {
      const [light, dark] = both(fg, bg);
      expect(light).toBeGreaterThanOrEqual(min);
      expect(dark).toBeGreaterThanOrEqual(min);
    });
  }

  for (const [fg, bg, min] of knownLow) {
    it.fails(`${fg} на ${bg} — пока ниже ${min}:1 (ждёт правки цвета владельцем)`, () => {
      const [light, dark] = both(fg, bg);
      expect(Math.min(light, dark)).toBeGreaterThanOrEqual(min);
    });
  }
});
