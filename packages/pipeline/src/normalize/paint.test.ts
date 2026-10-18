import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "../sanitize/sanitize.js";
import { SVG_NS } from "../svg/xml.js";
import {
  type NormalizeOptions,
  type NormalizeResult,
  normalizeSvg,
} from "./normalize.js";
import { FOREGROUND, parseColor } from "./paint.js";

const svg = (body: string, attrs = "") =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24"${attrs}>${body}</svg>`;

type Kept = Extract<NormalizeResult, { status: "kept" }>;

function normalized(
  source: string,
  options: Partial<NormalizeOptions> = {},
): Kept {
  const clean = sanitizeSvg(source);
  if (clean.status !== "kept") throw new Error(clean.reason);
  const r = normalizeSvg(clean.svg, {
    prefix: "demo",
    name: "icon",
    palette: "monochrome",
    grid: 24,
    sourceGrid: 24,
    ...options,
  });
  if (r.status !== "kept") throw new Error(r.reason);
  return r;
}

const body = (source: string) => normalized(source).icon.body;
const paint = (source: string) => {
  const p = normalized(source).stats.paint;
  if (!p) throw new Error("нет сведений о цвете");
  return p;
};

describe("разбор цвета", () => {
  it.each([
    ["#000", "#000000", 1],
    ["#FFAA00", "#ffaa00", 1],
    ["#0008", "#000000", 0x88 / 255],
    ["#ffaa0080", "#ffaa00", 0x80 / 255],
    ["black", "#000000", 1],
    ["WHITE", "#ffffff", 1],
    ["rgb(255, 0, 0)", "#ff0000", 1],
    ["rgb(100%, 0%, 0%)", "#ff0000", 1],
    ["rgba(0,0,0,.5)", "#000000", 0.5],
    ["rgb(0 0 0 / 50%)", "#000000", 0.5],
    ["hsl(120, 100%, 50%)", "#00ff00", 1],
    ["hsla(0 100% 50% / 0.25)", "#ff0000", 0.25],
  ])("%s → %s", (value, rgb, alpha) => {
    const c = parseColor(value);
    expect(c?.rgb).toBe(rgb);
    expect(c?.alpha).toBeCloseTo(alpha, 6);
  });

  it.each(["red", "#12", "rgb(1, 2)", "rgb(1 2 3 / 4 / 5)", "hsl(x, 1%, 1%)"])(
    "%s — не разбирается (считается по написанию)",
    (value) => {
      expect(parseColor(value)).toBeUndefined();
    },
  );
});

describe("замена цветов на currentColor", () => {
  it.each([
    [`fill="none"`, `fill="none"`],
    [`fill="currentColor"`, `fill="currentColor"`],
    [`fill="#000"`, `fill="currentColor"`],
    [`fill="red"`, `fill="currentColor"`],
    [
      `stroke="hsl(0, 0%, 0%)" fill="none"`,
      `stroke="currentColor" fill="none"`,
    ],
    [`fill="rgba(0,0,0,0.5)"`, `fill="currentColor" fill-opacity="0.5"`],
    [
      `fill="rgba(0,0,0,0.5)" fill-opacity="0.5"`,
      `fill="currentColor" fill-opacity="0.25"`,
    ],
    [`fill="transparent"`, `fill="none"`],
  ])("%s → %s", (from, to) => {
    expect(body(svg(`<path d="M4 4h16v16H4z" ${from}/>`))).toBe(
      `<path d="M4 4h16v16H4z" ${to}/>`,
    );
  });

  it("цвет-запаска после url() тоже становится currentColor, точки градиента — тоже", () => {
    expect(
      body(
        svg(
          `<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="transparent"/></linearGradient></defs><path d="M4 4h16v16H4z" fill="url(#g) red"/>`,
        ),
      ),
    ).toBe(
      `<defs><linearGradient id="demo--icon-0"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path d="M4 4h16v16H4z" fill="url(#demo--icon-0) currentColor"/>`,
    );
  });

  it("атрибут color удаляется: иначе currentColor не возьмёт цвет текста", () => {
    const r = normalized(
      svg(`<g color="#f00"><path d="M4 4h16v16H4z" fill="currentColor"/></g>`),
    );
    expect(r.icon.body).toBe(
      `<g><path d="M4 4h16v16H4z" fill="currentColor"/></g>`,
    );
    expect(r.stats.paint?.colors).toEqual(["#ff0000"]);
  });

  it("полупрозрачный цвет на группе не переносится: дети со своими цветами пострадали бы", () => {
    const r = normalized(
      svg(
        `<g fill="rgba(0,0,0,0.5)"><path d="M4 4h16v16H4z" fill="#000"/></g>`,
      ),
    );
    expect(r.icon.body).toBe(
      `<g fill="rgba(0,0,0,0.5)"><path d="M4 4h16v16H4z" fill="currentColor"/></g>`,
    );
    expect(r.warnings).toEqual([
      "полупрозрачный цвет на группе — цвет оставлен как есть",
    ]);
  });

  it("цветной набор не перекрашивается и не получает цвет по умолчанию", () => {
    const source = svg(
      `<path d="M4 4h16v16H4z" fill="#F92F60"/><path d="M1 1h2v2H1z"/>`,
    );
    expect(normalized(source, { palette: "color" }).icon.body).toBe(
      `<path d="M4 4h16v16H4z" fill="#F92F60"/><path d="M1 1h2v2H1z"/>`,
    );
    expect(
      normalized(source, { palette: "color" }).stats.paint,
    ).toBeUndefined();
  });
});

describe("маски и обрезка", () => {
  it("цвета в маске не меняются; унаследованный цвет закрепляется на самой маске", () => {
    const r = normalized(
      svg(
        `<mask id="m"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="12" r="4"/></mask><path d="M0 0h24v24H0z" mask="url(#m)"/>`,
        ` fill="#000"`,
      ),
    );
    expect(r.icon.body).toBe(
      `<g fill="currentColor"><mask id="demo--icon-0" fill="#000"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="12" r="4"/></mask><path d="M0 0h24v24H0z" mask="url(#demo--icon-0)"/></g>`,
    );
    expect(r.stats.paint?.complex).toEqual(["mask"]);
  });

  it("градиент, нужный только маске, не перекрашивается", () => {
    expect(
      body(
        svg(
          `<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1"/></linearGradient><mask id="m"><rect width="24" height="24" fill="url(#g)"/></mask></defs><path d="M0 0h24v24H0z" fill="#000" mask="url(#m)"/>`,
        ),
      ),
    ).toBe(
      `<defs><linearGradient id="demo--icon-0"><stop offset="0" stop-color="#fff"/><stop offset="1"/></linearGradient><mask id="demo--icon-1"><rect width="24" height="24" fill="url(#demo--icon-0)"/></mask></defs><path d="M0 0h24v24H0z" fill="currentColor" mask="url(#demo--icon-1)"/>`,
    );
  });

  it("элемент и в маске, и в рисунке — цвет оставлен, предупреждение", () => {
    const r = normalized(
      svg(
        `<defs><path id="p" d="M4 4h16v16H4z" fill="#000"/></defs><mask id="m"><use href="#p"/></mask><use href="#p"/><rect width="24" height="24" mask="url(#m)"/>`,
      ),
    );
    expect(r.icon.body).toContain(
      `<path id="demo--icon-0" d="M4 4h16v16H4z" fill="#000"/>`,
    );
    expect(r.warnings).toContain(
      "элемент рисуется и в маске, и в иконке — его цвет не менялся",
    );
  });

  it("в clipPath цвета не меняются и по умолчанию не задаются", () => {
    expect(
      body(
        svg(
          `<clipPath id="c"><rect width="10" height="10" fill="#000"/><circle cx="5" cy="5" r="2"/></clipPath><path d="M0 0h24v24H0z" clip-path="url(#c)" fill="#000"/>`,
        ),
      ),
    ).toBe(
      `<clipPath id="demo--icon-0"><rect width="10" height="10" fill="#000"/><circle cx="5" cy="5" r="2"/></clipPath><path d="M0 0h24v24H0z" clip-path="url(#demo--icon-0)" fill="currentColor"/>`,
    );
  });
});

describe("цвет по умолчанию", () => {
  it("фигура без заливки получает currentColor на себя, <line> — нет", () => {
    expect(
      body(
        svg(
          `<path d="M4 4h16v16H4z"/><line x1="0" y1="0" x2="24" y2="24" stroke="currentColor"/>`,
        ),
      ),
    ).toBe(
      `<path d="M4 4h16v16H4z" fill="currentColor"/><line x1="0" y1="0" x2="24" y2="24" stroke="currentColor"/>`,
    );
  });

  it("<use> получает цвет, его цель в defs и в symbol — нет", () => {
    expect(
      body(
        svg(
          `<defs><path id="p" d="M4 4h16v16H4z"/></defs><symbol id="s" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></symbol><use href="#p"/><use href="#s"/>`,
        ),
      ),
    ).toBe(
      `<defs><path id="demo--icon-0" d="M4 4h16v16H4z"/></defs><symbol id="demo--icon-1" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></symbol><use href="#demo--icon-0" fill="currentColor"/><use href="#demo--icon-1" fill="currentColor"/>`,
    );
  });

  it("фигуры внутри узора и маркера красятся по месту объявления", () => {
    expect(
      body(
        svg(
          `<defs><pattern id="pt" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2"/></pattern><marker id="mk" markerWidth="4" markerHeight="4"><circle cx="2" cy="2" r="2"/></marker></defs><rect width="24" height="24" fill="url(#pt)"/><path d="M2 2L22 22" stroke="currentColor" fill="none" marker-end="url(#mk)"/>`,
        ),
      ),
    ).toBe(
      `<defs><pattern id="demo--icon-0" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="currentColor"/></pattern><marker id="demo--icon-1" markerWidth="4" markerHeight="4"><circle cx="2" cy="2" r="2" fill="currentColor"/></marker></defs><rect width="24" height="24" fill="url(#demo--icon-0)"/><path d="M2 2L22 22" stroke="currentColor" fill="none" marker-end="url(#demo--icon-1)"/>`,
    );
  });

  it("точка градиента и заливка фильтра без цвета получают currentColor", () => {
    const source = svg(
      `<defs><linearGradient id="g"><stop offset="0"/></linearGradient><filter id="f"><feFlood flood-opacity="0.5"/></filter></defs><path d="M4 4h16v16H4z" fill="url(#g)" filter="url(#f)"/>`,
    );
    expect(body(source)).toContain(
      `<stop offset="0" stop-color="currentColor"/>`,
    );
    expect(body(source)).toContain(
      `<feFlood flood-opacity="0.5" flood-color="currentColor"/>`,
    );
    expect(paint(source).complex).toEqual(["filter", "linearGradient"]);
  });

  it("фигура с обводкой без заливки была залита чёрным — заливка сохраняется и отмечается", () => {
    const p = paint(svg(`<path d="M4 4h16v16H4z" stroke="currentColor"/>`));
    expect(p).toMatchObject({ defaults: 1, strokedFilled: 1 });
  });
});

describe("подсчёт цветов", () => {
  it.each([
    [
      "currentColor и #000 — один основной цвет",
      `<path d="M1 1h2v2H1z" fill="currentColor"/><path d="M3 3h2v2H3z" fill="#000"/>`,
      [FOREGROUND],
    ],
    [
      "чёрный по умолчанию — тоже основной",
      `<path d="M1 1h2v2H1z"/><path d="M3 3h2v2H3z" fill="black"/>`,
      [FOREGROUND],
    ],
    [
      "чёрная фигура с белой вырезкой — два цвета",
      `<path d="M1 1h2v2H1z" fill="#000"/><path d="M3 3h2v2H3z" fill="#fff"/>`,
      ["#ffffff", FOREGROUND],
    ],
    [
      "none и ссылки не считаются",
      `<path d="M1 1h2v2H1z" fill="none" stroke="currentColor"/>`,
      [FOREGROUND],
    ],
  ])("%s", (_name, content, colors) => {
    expect(paint(svg(content)).colors).toEqual(colors);
  });

  it("несколько цветов попадают в «Сначала посмотрите», но набор не останавливают", () => {
    const r = normalized(
      svg(
        `<path d="M1 1h2v2H1z" fill="#000"/><path d="M3 3h2v2H3z" fill="#fff"/>`,
      ),
    );
    expect(r.icon.body).toBe(
      `<path d="M1 1h2v2H1z" fill="currentColor"/><path d="M3 3h2v2H3z" fill="currentColor"/>`,
    );
    expect(r.stats.paint?.colors).toHaveLength(2);
  });
});
