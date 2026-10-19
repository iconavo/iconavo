import { describe, expect, it } from "vitest";
import type { NormalizedIcon } from "../normalize/normalize.js";
import { optimizeIcon } from "./optimize.js";

const icon = (body: string, width = 24, height = 24): NormalizedIcon => ({
  body,
  width,
  height,
});

/** Успешный результат или ошибка теста с причиной. */
function ok(input: NormalizedIcon, base = "demo--x") {
  const r = optimizeIcon(input, base);
  if (!r.ok) throw new Error(r.problem);
  return r;
}

/** Самое длинное число знаков после запятой в теле. */
const maxDecimals = (body: string) =>
  Math.max(0, ...[...body.matchAll(/\.(\d+)/g)].map((m) => m[1]?.length ?? 0));

describe("оптимизация иконки", () => {
  it("Material Symbols: масштаб 960 → 24 впечатан в координаты", () => {
    const r = ok(
      icon(
        `<g transform="scale(0.025) translate(0 960)"><path d="M450-450H200v-60h250v-250h60v250h250v60H510v250h-60v-250Z" fill="currentColor"/></g>`,
      ),
    );
    expect(r.icon.body).toBe(
      `<path fill="currentColor" d="M11.25 12.75H5v-1.5h6.25V5h1.5v6.25H19v1.5h-6.25V19h-1.5z"/>`,
    );
    expect(r.transformsLeft).toBe(0);
  });

  it("Phosphor: масштаб 256 → 24 впечатан, прозрачность дуотона сохранена", () => {
    const r = ok(
      icon(
        `<g fill="currentColor" transform="scale(0.09375)"><path d="M216,120v96H152V152H104v64H40V120a8,8,0,0,1,2.34-5.66l80-80a8,8,0,0,1,11.32,0Z" opacity="0.2"/><path d="M219.31,108.68l-80-80a16,16,0,0,0-22.62,0Z"/></g>`,
      ),
    );
    expect(r.icon.body).not.toContain("transform");
    expect(r.icon.body).toContain('opacity=".2"');
    expect(r.icon.body).toContain("M20.25 11.25v9h-6v-6h-4.5v6h-6v-9");
    expect(maxDecimals(r.icon.body)).toBeLessThanOrEqual(3);
    expect(r.transformsLeft).toBe(0);
  });

  it("Lucide: круг остаётся кругом, линии сливаются в один контур", () => {
    const r = ok(
      icon(
        `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/></g>`,
      ),
    );
    expect(r.icon.body).toBe(
      `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6m20 0-3-3M6.38 18.7 4 21m13.64-2.33L20 21"/></g>`,
    );
  });

  it("Tabler: невидимая рамка удаляется и в контурной, и в залитой иконке", () => {
    const frame = `<path stroke="none" d="M0 0h24v24H0z" fill="none"/>`;
    const outline = ok(
      icon(
        `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${frame}<path d="M5 12l-2 0l9 -9l9 9l-2 0"/></g>`,
      ),
    );
    expect(outline.icon.body).not.toContain("M0 0h24v24H0z");
    expect(outline.icon.body).toContain('stroke="currentColor"');
    const filled = ok(
      icon(
        `<g fill="currentColor">${frame}<path d="M6.979 3.074a6 6 0 0 1 4.988 1.425z"/></g>`,
      ),
    );
    expect(filled.icon.body).toBe(
      `<path fill="currentColor" d="M6.979 3.074a6 6 0 014.988 1.425z"/>`,
    );
  });

  it("содержимое clipPath без заливки не трогается, ID нумеруются по нашей схеме", () => {
    const r = ok(
      icon(
        `<defs><clipPath id="demo--x-7"><path d="M0 0h12v12H0z" fill="none"/></clipPath></defs><g clip-path="url(#demo--x-7)"><path d="M0 0h24v24H0z" fill="currentColor"/><path d="M2 2h4v4H2z" fill="#fff"/></g>`,
      ),
    );
    expect(r.icon.body).toContain('<clipPath id="demo--x-0">');
    expect(r.icon.body).toContain("M0 0h12v12H0z");
    expect(r.icon.body).toContain('clip-path="url(#demo--x-0)"');
  });

  it("ссылки href у <use> и градиентов сохраняются", () => {
    const r = ok(
      icon(
        `<defs><linearGradient id="demo--x-0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><linearGradient id="demo--x-1" href="#demo--x-0" x2="1"/><path id="demo--x-2" d="M0 0h4v4H0z"/></defs><path fill="url(#demo--x-1)" d="M0 0h24v24H0z"/><use href="#demo--x-2" fill="currentColor"/><use href="#demo--x-2" x="10" fill="currentColor"/>`,
      ),
    );
    expect(r.icon.body).toMatch(/href="#demo--x-\d"/);
    expect(r.icon.body.match(/<use /g)).toHaveLength(2);
    expect(r.icon.body).toMatch(/fill="url\(#demo--x-\d\)"/);
  });

  it("порядок атрибутов в результате не зависит от входного", () => {
    const a = ok(
      icon(`<path fill="currentColor" d="M0 0h24v24H0z" opacity="0.5"/>`),
    );
    const b = ok(
      icon(`<path opacity="0.5" d="M0 0h24v24H0z" fill="currentColor"/>`),
    );
    expect(a.icon.body).toBe(b.icon.body);
    expect(ok(icon(a.icon.body)).icon.body).toBe(a.icon.body);
  });

  it("числа — не больше трёх знаков, без экспоненты и «-0»", () => {
    const r = ok(
      icon(
        `<g transform="scale(0.025)"><path fill="currentColor" d="M0.00001 -0.00001H479.99999V480.123456H0Z"/></g>`,
      ),
    );
    expect(maxDecimals(r.icon.body)).toBeLessThanOrEqual(3);
    expect(r.icon.body).not.toMatch(/\de[+-]?\d/);
    expect(r.icon.body).not.toMatch(/-0(?![.\d])/);
  });

  it("масштаб, который нельзя впечатать, остаётся и учитывается", () => {
    const r = ok(
      icon(
        `<g transform="scale(0.5)"><circle cx="24" cy="24" r="10" fill="currentColor"/><rect x="2" y="2" width="8" height="8" rx="2" fill="currentColor"/></g>`,
      ),
    );
    expect(r.transformsLeft).toBeGreaterThan(0);
  });

  it("дробный размер округляется так же, как viewBox у SVGO", () => {
    const r = ok(
      icon(`<path fill="currentColor" d="M0 0h20v24H0z"/>`, 23.4375),
    );
    expect(r.icon.width).toBe(23.438);
    expect(r.icon.height).toBe(24);
  });

  it("анимация останавливает оптимизацию", () => {
    const r = optimizeIcon(
      icon(
        `<path d="M0 0h24v24H0z"><animate attributeName="opacity" values="0;1" dur="1s"/></path>`,
      ),
      "demo--x",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/анимац/);
  });

  it("ссылка в никуда, которая была до SVGO, — не повод останавливаться", () => {
    const r = optimizeIcon(
      icon(
        `<path fill="url(#missing)" d="M0 0h24v24H0z"/><path fill="currentColor" d="M2 2h4v4H2z"/>`,
      ),
      "demo--x",
    );
    expect(r.ok).toBe(true);
  });
});
