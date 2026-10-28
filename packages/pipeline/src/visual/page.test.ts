import type { IconsFile } from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import { effectiveIcon } from "../cdn/files.js";
import { svgOf } from "../cdn/svg.js";
import { cspHash } from "../sandbox/page.js";
import { CONTROL, GAP, SCALE } from "./config.js";
import {
  allNames,
  CONTROL_SET,
  cellOf,
  cellRect,
  chunkSet,
  controlCell,
  layout,
  renderVisualPage,
  VISUAL_IMPORT_MAP,
} from "./page.js";
import { allowed, type VisualResult, visualFailed } from "./run.js";

const FILE = {
  prefix: "demo",
  width: 24,
  height: 24,
  icons: {
    house: { body: '<path d="M3 10l9-7 9 7"/>' },
    tall: { body: '<path d="M0 0h32v33z"/>', width: 32, height: 33 },
  },
  aliases: { home: { parent: "house" }, hut: { parent: "home" } },
} as unknown as IconsFile;

describe("страница визуального сравнения", () => {
  it("имена — иконки и алиасы по кодам символов; клетка — сетка × SCALE, эталон — SVG статики", () => {
    expect(allNames(FILE)).toEqual(["home", "house", "hut", "tall"]);
    const tall = cellOf(FILE, "tall");
    expect(tall).toEqual({
      icon: "demo:tall",
      width: 32 * SCALE,
      height: 33 * SCALE,
      ref: svgOf(effectiveIcon(FILE, "tall")),
    });
    expect(cellOf(FILE, "hut").ref).toBe(cellOf(FILE, "house").ref);
  });

  it("данные куска: у алиаса — вся цепочка и иконка в конце, размеры набора", () => {
    expect(chunkSet(FILE, ["hut"])).toEqual({
      prefix: "demo",
      width: 24,
      height: 24,
      icons: { house: { body: '<path d="M3 10l9-7 9 7"/>' } },
      aliases: { hut: { parent: "home" }, home: { parent: "house" } },
    });
    expect(chunkSet(FILE, ["tall"]).aliases).toBeUndefined();
  });

  it("раскладка — целые пиксели: клетка по самой большой иконке, сетки с шагом, кратным 512", () => {
    const cells = [cellOf(FILE, "house"), cellOf(FILE, "tall"), controlCell()];
    const l = layout(cells);
    expect(l.cellWidth).toBe(64);
    expect(l.cellHeight).toBe(66);
    expect(l.columns).toBe(3);
    expect(l.gridWidth).toBe(3 * 64 + 2 * GAP);
    expect(l.tops).toEqual([0, 512, 1024]);
    expect(l.viewport).toEqual({ width: l.gridWidth, height: 1024 + 66 });
    expect(cellRect(l, cells[1] as never, 1)).toEqual({
      x: 64 + GAP,
      y: 0,
      width: 64,
      height: 66,
    });
    const many = layout(
      Array.from({ length: 30 }, () => cellOf(FILE, "house")),
    );
    expect(many.columns).toBe(25);
    expect(many.rows).toBe(2);
    expect(cellRect(many, cellOf(FILE, "house"), 26)).toEqual({
      x: 48 + GAP,
      y: 48 + GAP,
      width: 48,
      height: 48,
    });
  });

  it("контрольная клетка: эталон и рисунок пакета нарочно разные", () => {
    const cell = controlCell();
    expect(cell.icon).toBe(`${CONTROL.prefix}:${CONTROL.name}`);
    expect(cell.ref).toContain(CONTROL.ref);
    expect(CONTROL_SET.icons[CONTROL.name]?.body).toBe(CONTROL.body);
    expect(CONTROL.body).not.toBe(CONTROL.ref);
  });

  it("страница: три сетки на своих местах, эталон картинками, данные блоком JSON, CSP с хэшем import map", () => {
    const cells = [cellOf(FILE, "house"), controlCell()];
    const l = layout(cells);
    const html = renderVisualPage(
      cells,
      [chunkSet(FILE, ["house"]), CONTROL_SET],
      '<svg data-react="1"></svg>',
      l,
    );
    expect(html).toContain(
      `script-src &#39;self&#39; &#39;${cspHash(VISUAL_IMPORT_MAP)}&#39;`,
    );
    expect(html.match(/<img src="data:image\/svg\+xml;base64,/g)).toHaveLength(
      2,
    );
    expect(html).toContain('width="48" height="48" alt=""');
    expect(html).toContain(`#tag { top: ${l.tops[1]}px; }`);
    expect(html).toContain(
      '<div class="grid" id="react"><svg data-react="1"></svg></div>',
    );
    expect(html).toContain(
      '"cells":[{"icon":"demo:house","width":48,"height":48}',
    );
    expect(html).toContain('<script type="module" src="/visual.js"></script>');
  });
});

describe("допуск и итог", () => {
  it("допуск — 0,5% площади клетки вверх: 12 при 48 px, 21 при 64 px", () => {
    expect(allowed({ width: 48, height: 48 })).toBe(12);
    expect(allowed({ width: 64, height: 64 })).toBe(21);
    expect(allowed({ width: 64, height: 66 })).toBe(22);
  });

  it("провал — расхождение больше допуска, проблема или сбой; отличия в допуске — нет", () => {
    const set = {
      set: "demo",
      names: 4,
      ms: 10,
      counts: { tag: 0, react: 0 },
      shown: { tag: [], react: [] },
      noise: {
        tag: { count: 3, max: 2, shown: [] },
        react: { count: 0, max: 0, shown: [] },
      },
    };
    const ok: VisualResult = { browser: "chrome", sets: [set], problems: [] };
    expect(visualFailed([ok])).toBe(false);
    expect(
      visualFailed([
        { ...ok, sets: [{ ...set, counts: { tag: 0, react: 1 } }] },
      ]),
    ).toBe(true);
    expect(visualFailed([{ ...ok, problems: ["эталон пустой: demo:x"] }])).toBe(
      true,
    );
    expect(visualFailed([{ ...ok, failure: "не запустился" }])).toBe(true);
  });
});
