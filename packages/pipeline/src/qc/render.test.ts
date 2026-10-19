import { beforeAll, describe, expect, it } from "vitest";
import { SVG_NS } from "../svg/xml.js";
import { CROP_LIMIT, EMPTY_LIMIT, MARGIN, SPARSE_LIMIT } from "./config.js";
import { coverage, crop, difference, inkOnly, overflow } from "./pixels.js";
import { pngDataUri } from "./png.js";
import {
  canvasRect,
  initRenderer,
  paddedSvg,
  renderIcon,
  renderSource,
} from "./render.js";

beforeAll(() => initRenderer());

const icon = (body: string, width = 24, height = 24) => ({
  body,
  width,
  height,
});

describe("рисунок через resvg", () => {
  it("квадрат 16×16 на сетке 24: 64 px холста с запасом 16 px, закрашено около 44%", () => {
    const r = renderIcon(
      icon(`<path fill="currentColor" d="M4 4h16v16H4z"/>`),
      24,
    );
    expect([r.image.width, r.image.height]).toEqual([96, 96]);
    expect(r.canvas).toEqual({ x: MARGIN, y: MARGIN, width: 64, height: 64 });
    expect(coverage(r.image, r.canvas)).toBeCloseTo((16 / 24) ** 2, 2);
    expect(overflow(r.image, r.canvas)).toBe(0);
  });

  it("currentColor рисуется чёрным и непрозрачным", () => {
    const r = renderIcon(
      icon(`<path fill="currentColor" d="M0 0h24v24H0z"/>`),
      24,
    );
    const i = ((MARGIN + 10) * r.image.width + MARGIN + 10) * 4;
    expect([...r.image.data.subarray(i, i + 4)]).toEqual([0, 0, 0, 255]);
  });

  it("точка r=.1 — пустая; точки Phosphor в тонком начертании — почти пустые", () => {
    const tiny = renderIcon(
      icon(`<circle cx="12" cy="12" r=".1" fill="currentColor"/>`),
      24,
    );
    expect(coverage(tiny.image, tiny.canvas)).toBeLessThan(EMPTY_LIMIT);
    // Тела ph:dot-thin и ph:cell-signal-none-thin после сборки.
    for (const body of [
      `<path fill="currentColor" d="M12.75 12a.75.75 0 11-.75-.75.75.75 0 01.75.75"/>`,
      `<path fill="currentColor" d="M4.125 18v.75a.375.375 0 01-.75 0V18a.375.375 0 01.75 0"/>`,
    ]) {
      const r = renderIcon(icon(body), 24);
      const filled = coverage(r.image, r.canvas);
      expect(filled).toBeGreaterThan(EMPTY_LIMIT);
      expect(filled).toBeLessThan(SPARSE_LIMIT);
    }
  });

  it("круг у края выходит за холст, а линия до самого края — нет", () => {
    const out = renderIcon(
      icon(`<circle cx="22" cy="12" r="6" fill="currentColor"/>`),
      24,
    );
    expect(overflow(out.image, out.canvas) / 64).toBeGreaterThan(CROP_LIMIT);
    // Как в Lucide: обводка 2 со скруглёнными концами от x=1 до x=23 касается краёв 0 и 24.
    const edge = renderIcon(
      icon(
        `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M1 12h22"/>`,
      ),
      24,
    );
    expect(overflow(edge.image, edge.canvas)).toBe(0);
  });

  it("исходник Material Symbols на холсте 960 совпадает со своим результатом", () => {
    const source = `<svg xmlns="${SVG_NS}" width="48" height="48" viewBox="0 -960 960 960"><path d="M450-450H200v-60h250v-250h60v250h250v60H510v250h-60v-250Z"/></svg>`;
    const r = renderIcon(
      icon(
        `<path fill="currentColor" d="M11.25 12.75H5v-1.5h6.25V5h1.5v6.25H19v1.5h-6.25V19h-1.5z"/>`,
      ),
      24,
    );
    const original = renderSource(`﻿${source}`, 64);
    expect([original.width, original.height]).toEqual([64, 64]);
    expect(
      difference(inkOnly(original), inkOnly(crop(r.image, r.canvas))),
    ).toBe(0);
  });

  it("запас вокруг холста одинаков для resvg и браузера, высота иконки сохраняется", () => {
    expect(paddedSvg(icon("<g/>"), 24)).toBe(
      `<svg xmlns="${SVG_NS}" viewBox="-6 -6 36 36" width="96" height="96" preserveAspectRatio="none" color="#000"><g/></svg>`,
    );
    expect(canvasRect(icon("<g/>", 32, 33), 32)).toEqual({
      x: 16,
      y: 16,
      width: 64,
      height: 66,
    });
  });

  it("PNG для отчёта читает настоящий декодер", () => {
    const rgba = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255,
    ]);
    const svg = `<svg xmlns="${SVG_NS}" width="2" height="2"><image width="2" height="2" href="${pngDataUri(rgba, 2, 2)}"/></svg>`;
    expect([...renderSource(svg, 2).data]).toEqual([...rgba]);
  });

  it("если resvg не справился — исключение", () => {
    expect(() => renderSource("<svg", 64)).toThrow();
    expect(() => renderIcon(icon("<path"), 24)).toThrow();
  });
});
