import type { IconData } from "@iconavo-ui/core/internal";
import { describe, expect, it } from "vitest";
import { numberSvg } from "./digits.js";
import { gridSvg } from "./grid.js";

const icon = (body: string, width = 24, height = 24): IconData => ({
  body,
  left: 0,
  top: 0,
  width,
  height,
});

describe("gridSvg", () => {
  it("до 12 иконок — 4 колонки по 96 px, больше — 6; холст — целые ряды", () => {
    const one = icon('<path d="M0 0h1"/>');
    expect(gridSvg(Array(12).fill(one))).toMatchObject({
      width: 384,
      height: 288,
    });
    expect(gridSvg(Array(13).fill(one))).toMatchObject({
      width: 576,
      height: 288,
    });
    expect(gridSvg(Array(24).fill(one))).toMatchObject({
      width: 576,
      height: 384,
    });
    expect(gridSvg([one])).toMatchObject({ width: 384, height: 96 });
  });

  it("номер в каждой клетке — контурами, без <text>; клетка без рисунка — только номер", () => {
    const { svg } = gridSvg([icon('<path d="M0 0h1"/>'), null]);
    expect(svg).not.toContain("<text");
    expect(svg.match(/<g transform="translate\(/g)).toHaveLength(2);
    expect(svg.match(/<svg x=/g)).toHaveLength(1);
  });

  it("у каждой клетки свои ID: одинаковые градиенты двух иконок не путаются", () => {
    const gradient =
      '<defs><linearGradient id="a"/></defs><path fill="url(#a)" d="M0 0h1"/>';
    const { svg } = gridSvg([icon(gradient), icon(gradient)]);
    expect(svg).toContain('id="c0_0"');
    expect(svg).toContain("url(#c0_0)");
    expect(svg).toContain('id="c1_0"');
    expect(svg).toContain("url(#c1_0)");
    expect(svg).not.toContain('id="a"');
  });

  it("неквадратная иконка вписывается по большей стороне, по центру клетки", () => {
    const { svg } = gridSvg([icon('<path d="M0 0h1"/>', 32, 16)]);
    expect(svg).toContain(
      '<svg x="24" y="36" width="48" height="24" viewBox="0 0 32 16">',
    );
  });

  it("currentColor — тёмный цвет корня; фон белый", () => {
    const { svg } = gridSvg([icon('<path fill="currentColor" d="M0 0h1"/>')]);
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]* color="#18181b">/,
    );
    expect(svg).toContain('fill="#ffffff"');
  });
});

describe("numberSvg", () => {
  it("знак на цифру, сдвиг на ширину знака; не число — ошибка", () => {
    const svg = numberSvg(12, 7, 7, 12, "#000");
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('transform="translate(6.4 0)"');
    expect(svg).toContain('transform="translate(7 7) scale(1.2)"');
    expect(() => numberSvg(1.5, 0, 0, 10, "#000")).toThrow();
    expect(() => numberSvg(-1, 0, 0, 10, "#000")).toThrow();
  });
});
