import { iconSchema } from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import { checkSafeSvg } from "../sanitize/check.js";
import { sanitizeSvg } from "../sanitize/sanitize.js";
import type { SvgElement } from "../svg/serialize.js";
import { SVG_NS } from "../svg/xml.js";
import { formatNumber, placeOnGrid, readCanvas } from "./canvas.js";
import {
  iconToSvg,
  type NormalizeOptions,
  type NormalizeResult,
  normalizeSvg,
} from "./normalize.js";

const NS = `xmlns="${SVG_NS}"`;
const svg = (body: string, attrs = `viewBox="0 0 24 24"`) =>
  `<svg ${NS} ${attrs}>${body}</svg>`;

const MONO: NormalizeOptions = {
  prefix: "demo",
  name: "icon",
  palette: "monochrome",
  grid: 24,
  sourceGrid: 24,
};

function tree(source: string): SvgElement {
  const r = sanitizeSvg(source);
  if (r.status !== "kept")
    throw new Error(`исключена при очистке: ${r.reason}`);
  return r.svg;
}

type Kept = Extract<NormalizeResult, { status: "kept" }>;

function normalized(
  source: string,
  options: Partial<NormalizeOptions> = {},
): Kept {
  const r = normalizeSvg(tree(source), { ...MONO, ...options });
  if (r.status !== "kept") throw new Error(`иконка исключена: ${r.reason}`);
  return r;
}

function excludedReason(
  source: string,
  options: Partial<NormalizeOptions> = {},
): string {
  const r = normalizeSvg(tree(source), { ...MONO, ...options });
  if (r.status !== "excluded") throw new Error(`не исключена: ${r.icon.body}`);
  return r.reason;
}

/** Результат безопасен, проходит схему иконки, а повторные очистка и нормализация ничего не меняют. */
function expectStable(r: Kept, options: Partial<NormalizeOptions> = {}) {
  const file = iconToSvg(r.icon);
  expect(checkSafeSvg(file)).toEqual([]);
  expect(iconSchema.safeParse(r.icon).success).toBe(true);
  expect(sanitizeSvg(file).removals).toEqual([]);
  const grid = options.grid ?? MONO.grid;
  expect(normalized(file, { ...options, sourceGrid: grid }).icon).toEqual(
    r.icon,
  );
}

describe("иконки в стиле пяти наборов", () => {
  it("lucide: атрибуты линий с корня уходят во внешний <g>", () => {
    const r = normalized(
      `<svg ${NS} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><circle cx="17" cy="7" r="3"/><line x1="2" y1="2" x2="4" y2="4"/></svg>`,
    );
    expect(r.icon).toEqual({
      body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><circle cx="17" cy="7" r="3"/><line x1="2" y1="2" x2="4" y2="4"/></g>`,
      width: 24,
      height: 24,
    });
    expect(r.stats.moved).toEqual([
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
    ]);
    expect(r.stats.transform).toBeUndefined();
    expect(r.stats.paint).toMatchObject({ defaults: 0, replaced: 0 });
    expect(r.warnings).toEqual([]);
    expectStable(r);
  });

  it("tabler: залитая иконка, невидимая рамка не трогается", () => {
    const r = normalized(
      `<svg ${NS} width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6.979 3.074a6 6 0 0 1 4.988 1.425z"/></svg>`,
    );
    expect(r.icon.body).toBe(
      `<g fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6.979 3.074a6 6 0 0 1 4.988 1.425z"/></g>`,
    );
    expectStable(r);
  });

  it("material-symbols: холст 960 со сдвигом → сетка 24, цвет задаётся явно", () => {
    const r = normalized(
      `<svg ${NS} width="48" height="48" viewBox="0 -960 960 960"><path d="M160-120v-480l320-240 320 240v480H560v-280H400v280H160Z"/></svg>`,
      { sourceGrid: 960 },
    );
    expect(r.icon).toEqual({
      body: `<g transform="scale(0.025) translate(0 960)"><path d="M160-120v-480l320-240 320 240v480H560v-280H400v280H160Z" fill="currentColor"/></g>`,
      width: 24,
      height: 24,
    });
    expect(r.stats.moved).toEqual([]);
    expect(r.stats.offGrid).toBe(false);
    expect(r.stats.paint).toMatchObject({ defaults: 1, colors: ["основной"] });
    expectStable(r);
  });

  it("ph: холст 256 → сетка 24, прозрачность двухтоновой части сохраняется", () => {
    const r = normalized(
      `<svg ${NS} viewBox="0 0 256 256" fill="currentColor"><path d="M216 120v96H40V120l88-88Z" opacity="0.2"/><path d="M219.31 108.68l-80-80Z"/></svg>`,
      { sourceGrid: 256 },
    );
    expect(r.icon).toEqual({
      body: `<g fill="currentColor" transform="scale(0.09375)"><path d="M216 120v96H40V120l88-88Z" opacity="0.2"/><path d="M219.31 108.68l-80-80Z"/></g>`,
      width: 24,
      height: 24,
    });
    expectStable(r);
  });

  it("fluent-emoji-flat: цвета не меняются, ID переименованы, имена результатов фильтра не тронуты", () => {
    const source = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" ${NS}>
<g clip-path="url(#clip0_4002_1670)"><path d="M3 7h20v10H3z" fill="#FFCE7C"/><g filter="url(#filter0_d_4002_1670)"><path d="M8 24h16v4H8z" fill="#00A6ED"/></g></g>
<defs>
<filter id="filter0_d_4002_1670" x="5" y="23" width="21" height="11" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feOffset dy="4"/><feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_4002_1670"/></filter>
<clipPath id="clip0_4002_1670"><rect width="32" height="32" fill="white"/></clipPath>
</defs></svg>`;
    const options = {
      prefix: "fluent-emoji-flat",
      name: "teacher",
      palette: "color",
      grid: 32,
      sourceGrid: 32,
    } as const;
    const r = normalized(source, options);
    expect(r.icon.body).toBe(
      `<g fill="none"><g clip-path="url(#fluent-emoji-flat--teacher-1)"><path d="M3 7h20v10H3z" fill="#FFCE7C"/><g filter="url(#fluent-emoji-flat--teacher-0)"><path d="M8 24h16v4H8z" fill="#00A6ED"/></g></g><defs><filter id="fluent-emoji-flat--teacher-0" x="5" y="23" width="21" height="11" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feOffset dy="4"/><feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_4002_1670"/></filter><clipPath id="fluent-emoji-flat--teacher-1"><rect width="32" height="32" fill="white"/></clipPath></defs></g>`,
    );
    expect(r.icon).toMatchObject({ width: 32, height: 32 });
    expect(r.stats.ids).toEqual({ renamed: 2, removed: 0 });
    expect(r.stats.paint).toBeUndefined();
    expectStable(r, options);
  });

  it("fluent-emoji-flat: холст 32×33 остаётся как есть и помечается", () => {
    const options = { palette: "color", grid: 32, sourceGrid: 32 } as const;
    const r = normalized(
      `<svg width="32" height="33" viewBox="0 0 32 33" fill="none" ${NS}><path d="M2 6h28v24H2z" fill="#00A6ED"/></svg>`,
      options,
    );
    expect(r.icon).toMatchObject({ width: 32, height: 33 });
    expect(r.stats).toMatchObject({
      offGrid: true,
      transform: undefined,
      canvas: { width: 32, height: 33 },
    });
    expectStable(r, options);
  });
});

describe("холст", () => {
  it.each([
    ["числа через пробел", { viewBox: "0 -960 960 960" }, [0, -960, 960, 960]],
    ["через запятую", { viewBox: "0,0,24,24" }, [0, 0, 24, 24]],
    ["запятые с пробелами", { viewBox: " 0, 0, 24, 24 " }, [0, 0, 24, 24]],
    [
      "без viewBox — из width и height",
      { width: "24", height: "24px" },
      [0, 0, 24, 24],
    ],
  ])("%s", (_name, attrs, [left, top, width, height]) => {
    expect(readCanvas(attrs)).toEqual({
      ok: true,
      canvas: { left, top, width, height },
      warnings: [],
    });
  });

  it.each([
    ["три числа", { viewBox: "0 0 24" }],
    ["не числа", { viewBox: "a b c d" }],
    ["нулевая ширина", { viewBox: "0 0 0 24" }],
    ["отрицательная высота", { viewBox: "0 0 24 -24" }],
    ["без viewBox, размер в em", { width: "1em", height: "1em" }],
    ["без viewBox, размер в процентах", { width: "100%", height: "100%" }],
    ["нет ничего", {}],
  ])("иконка исключается: %s", (_name, attrs) => {
    expect(readCanvas(attrs).ok).toBe(false);
  });

  it("пропорции width и height не как у viewBox — предупреждение", () => {
    const r = normalized(
      svg(
        `<path d="M4 4h16v16H4z"/>`,
        `width="48" height="24" viewBox="0 0 24 24"`,
      ),
    );
    expect(r.warnings).toEqual([
      "пропорции width и height не совпадают с viewBox",
    ]);
    expect(
      readCanvas({ width: "1em", height: "1em", viewBox: "0 0 24 24" }),
    ).toMatchObject({ warnings: [] });
  });

  it("сдвиг начала холста — в единицах источника, масштаб — первым", () => {
    expect(
      placeOnGrid({ left: -2, top: -2, width: 28, height: 28 }, 24, 24),
    ).toEqual({
      width: 28,
      height: 28,
      transform: "translate(2 2)",
    });
    expect(
      placeOnGrid({ left: 0, top: -960, width: 960, height: 960 }, 24, 960),
    ).toEqual({
      width: 24,
      height: 24,
      transform: "scale(0.025) translate(0 960)",
    });
    expect(
      placeOnGrid({ left: 0, top: 0, width: 24, height: 24 }, 24, 24),
    ).toEqual({
      width: 24,
      height: 24,
      transform: undefined,
    });
  });

  it("числа без шума плавающей точки и без экспоненты", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(1e-7)).toBe("0.0000001");
    expect(formatNumber(24 / 256)).toBe("0.09375");
    expect(formatNumber(32 / 33)).toBe("0.969696969697");
  });

  it.each([
    ["transform", `transform="rotate(90 12 12)"`],
    ["clip-path", `clip-path="url(#c)"`],
    ["mask", `mask="url(#c)"`],
    ["filter", `filter="url(#c)"`],
  ])("%s на корне исключает иконку", (name, attr) => {
    const reason = excludedReason(
      svg(
        `<clipPath id="c"><rect width="24" height="24"/></clipPath><path d="M4 4h16v16H4z"/>`,
        `viewBox="0 0 24 24" ${attr}`,
      ),
    );
    expect(reason).toBe(
      `${name} на корневом <svg> не переносится без искажений`,
    );
  });

  it("viewBox, который не читается, исключает иконку с причиной", () => {
    expect(
      excludedReason(svg(`<path d="M4 4h16v16H4z"/>`, `viewBox="0 0 24"`)),
    ).toBe("viewBox «0 0 24» не читается: нужно четыре числа");
  });
});

describe("атрибуты корня", () => {
  it("корню нечего отдать — внешнего <g> нет", () => {
    const r = normalized(svg(`<path d="M4 4h16v16H4z" fill="currentColor"/>`));
    expect(r.icon.body).toBe(`<path d="M4 4h16v16H4z" fill="currentColor"/>`);
    expect(r.stats.moved).toEqual([]);
  });

  it("width, height, viewBox и preserveAspectRatio не переносятся; opacity и display — да", () => {
    const r = normalized(
      svg(
        `<path d="M4 4h16v16H4z"/>`,
        `width="24" height="24" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" opacity="0.5" display="inline" fill="currentColor"`,
      ),
    );
    expect(r.icon.body).toBe(
      `<g opacity="0.5" display="inline" fill="currentColor"><path d="M4 4h16v16H4z"/></g>`,
    );
  });

  it("<g> оборачивает и <defs>: содержимое масок наследует то же, что раньше", () => {
    const r = normalized(
      svg(
        `<defs><linearGradient id="g"><stop offset="0" stop-color="currentColor"/></linearGradient></defs><path d="M4 4h16v16H4z" fill="url(#g)"/>`,
        `viewBox="0 0 24 24" stroke="currentColor"`,
      ),
    );
    expect(r.icon.body).toMatch(/^<g stroke="currentColor"><defs>/);
  });

  it("вход не меняется", () => {
    const input = tree(
      svg(`<path d="M4 4h16v16H4z"/>`, `viewBox="0 -960 960 960" fill="#000"`),
    );
    const copy = structuredClone(input);
    normalizeSvg(input, { ...MONO, sourceGrid: 960 });
    expect(input).toEqual(copy);
  });

  it("одинаковый вход — одинаковый результат", () => {
    const source = svg(
      `<path d="M4 4h16v16H4z"/><circle cx="12" cy="12" r="2" fill="#000"/>`,
    );
    expect(normalized(source)).toEqual(normalized(source));
  });
});

describe("ID", () => {
  const COLOR = { palette: "color" } as const;

  it("используемые — по порядку в файле, ссылки обновляются, лишние удаляются", () => {
    const r = normalized(
      svg(
        `<defs><linearGradient id="b"><stop offset="0" stop-color="#f00"/></linearGradient><linearGradient id="a" href="#b"/><radialGradient id="unused"/></defs><path d="M0 0h24v24H0z" fill="url(#a)"/><rect id="b" width="1" height="1"/>`,
      ),
      COLOR,
    );
    expect(r.icon.body).toBe(
      `<defs><linearGradient id="demo--icon-0"><stop offset="0" stop-color="#f00"/></linearGradient><linearGradient id="demo--icon-1" href="#demo--icon-0"/><radialGradient/></defs><path d="M0 0h24v24H0z" fill="url(#demo--icon-1)"/><rect width="1" height="1"/>`,
    );
    expect(r.stats.ids).toEqual({ renamed: 2, removed: 2 });
    expect(r.warnings).toEqual(["id повторяется — оставлен первый"]);
  });

  it("ID с точкой и двоеточием тоже переименовываются", () => {
    const r = normalized(
      svg(
        `<clipPath id="a.b:c"><rect width="10" height="10"/></clipPath><path d="M0 0h24v24H0z" clip-path="url(#a.b:c)"/>`,
      ),
      COLOR,
    );
    expect(r.icon.body).toBe(
      `<clipPath id="demo--icon-0"><rect width="10" height="10"/></clipPath><path d="M0 0h24v24H0z" clip-path="url(#demo--icon-0)"/>`,
    );
  });

  it("двойной дефис отделяет набор от иконки: ID разных наборов не совпадают", () => {
    const body = (prefix: string, name: string) =>
      normalized(
        svg(
          `<clipPath id="c"><rect width="10" height="10"/></clipPath><path d="M0 0h24v24H0z" clip-path="url(#c)"/>`,
        ),
        { ...COLOR, prefix, name },
      ).icon.body;
    expect(body("fluent-emoji", "flat-shoe")).toContain(
      `id="fluent-emoji--flat-shoe-0"`,
    );
    expect(body("fluent-emoji-flat", "shoe")).toContain(
      `id="fluent-emoji-flat--shoe-0"`,
    );
  });

  it("без ID тело не меняется", () => {
    const r = normalized(svg(`<path d="M4 4h16v16H4z" fill="#f00"/>`), COLOR);
    expect(r.icon.body).toBe(`<path d="M4 4h16v16H4z" fill="#f00"/>`);
    expect(r.stats.ids).toEqual({ renamed: 0, removed: 0 });
  });
});
