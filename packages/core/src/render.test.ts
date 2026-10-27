import { afterEach, describe, expect, it, vi } from "vitest";
import { freshCore } from "./fake.testing.js";
import type { IconData } from "./icon.js";
import { setStrokeWidth } from "./render.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for("iconavo.core.1")
  ];
});

/** Линейная иконка, как у Lucide: толщина — на верхнем элементе рисунка. */
const LINE: IconData = {
  body: '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></g>',
  left: 0,
  top: 0,
  width: 24,
  height: 24,
};

/** Цветная иконка с градиентом, как у Fluent Emoji Flat: ID — по ADR-0014. */
const GRADIENT: IconData = {
  body: '<defs><linearGradient id="fluent-emoji-flat--x-0"/></defs><path fill="url(#fluent-emoji-flat--x-0)"/>',
  left: 0,
  top: 0,
  width: 32,
  height: 32,
};

describe("renderIcon", () => {
  it("без подписи — декоративная: aria-hidden", async () => {
    const { renderIcon, svgToString } = await freshCore();
    expect(svgToString(renderIcon(LINE))).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></g></svg>',
    );
  });

  it("с подписью — role=img и aria-label, без <title>; из одних пробелов — декоративная", async () => {
    const { renderIcon } = await freshCore();
    const labelled = renderIcon(LINE, { label: " Удалить " });
    expect(labelled.attributes).toEqual({
      width: "1em",
      height: "1em",
      viewBox: "0 0 24 24",
      role: "img",
      "aria-label": "Удалить",
    });
    expect(labelled.body).not.toContain("<title");
    expect(renderIcon(LINE, { label: "  " }).attributes).toEqual({
      width: "1em",
      height: "1em",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
    });
  });

  it("цвет — атрибутом color, рисунок не меняется", async () => {
    const { renderIcon } = await freshCore();
    const parts = renderIcon(LINE, { color: "crimson" });
    expect(parts.attributes.color).toBe("crimson");
    expect(parts.body).toBe(LINE.body);
  });

  it("размеры и повороты — как iconToSvg", async () => {
    const { iconToSvg, renderIcon } = await freshCore();
    const options = { height: "48", rotate: 1 as const, hFlip: true };
    const parts = renderIcon(LINE, options);
    const plain = iconToSvg(LINE, options);
    expect(parts.body).toBe(plain.body);
    expect(parts.box).toEqual(plain.box);
    expect(parts.attributes).toMatchObject(plain.attributes);
  });

  it("толщина линии — в рисунке, до уникальных ID", async () => {
    const { renderIcon } = await freshCore();
    expect(renderIcon(LINE, { strokeWidth: 1.5 }).body).toBe(
      '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1"/></g>',
    );
    expect(renderIcon(GRADIENT, { strokeWidth: 3 }).body).not.toContain(
      "stroke-width",
    );
  });

  it("ID — свои у каждой отрисовки; иконка без ID счётчик не тратит", async () => {
    const { renderIcon, store } = await freshCore();
    expect(renderIcon(GRADIENT).body).toBe(
      '<defs><linearGradient id="iconavo0_0"/></defs><path fill="url(#iconavo0_0)"/>',
    );
    renderIcon(LINE);
    expect(renderIcon(GRADIENT).body).toBe(
      '<defs><linearGradient id="iconavo1_0"/></defs><path fill="url(#iconavo1_0)"/>',
    );
    expect(store.ids).toBe(2);
  });

  it("в браузере счётчик общий для двух копий ядра", async () => {
    vi.stubGlobal("document", {});
    const one = await freshCore();
    const two = await freshCore();
    expect(one.renderIcon(GRADIENT).body).toContain('id="iconavo0_0"');
    expect(two.renderIcon(GRADIENT).body).toContain('id="iconavo1_0"');
    expect(one.renderIcon(GRADIENT).body).toContain('id="iconavo2_0"');
  });

  it("idPrefix — одни и те же ID при каждой отрисовке, лишние символы — «_»", async () => {
    const { renderIcon, store } = await freshCore();
    const body =
      '<defs><linearGradient id="iconavo_r1__0"/></defs><path fill="url(#iconavo_r1__0)"/>';
    expect(renderIcon(GRADIENT, { idPrefix: ":r1:" }).body).toBe(body);
    expect(renderIcon(GRADIENT, { idPrefix: ":r1:" }).body).toBe(body);
    expect(renderIcon(GRADIENT, { idPrefix: "«r1»" }).body).toBe(body);
    expect(store.ids).toBeUndefined();
  });
});

describe("setStrokeWidth", () => {
  it("все stroke-width монохромного рисунка", () => {
    expect(
      setStrokeWidth(
        '<g stroke="currentColor" stroke-width="2"><path stroke-width="1"/></g>',
        3,
      ),
    ).toBe(
      '<g stroke="currentColor" stroke-width="3"><path stroke-width="3"/></g>',
    );
  });

  it("цветной рисунок и рисунок без stroke-width — без изменений", () => {
    const colored = '<path fill="#f00" stroke="#000" stroke-width="3"/>';
    expect(setStrokeWidth(colored, 1)).toBe(colored);
    const filled = '<path fill="currentColor" d="M0 0"/>';
    expect(setStrokeWidth(filled, 1)).toBe(filled);
  });

  it("неверное число — без изменений", () => {
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(setStrokeWidth(LINE.body, width)).toBe(LINE.body);
    }
  });

  it("число без шума плавающей точки", () => {
    expect(setStrokeWidth(LINE.body, 0.1 + 0.2)).toContain(
      'stroke-width="0.3"',
    );
  });
});
