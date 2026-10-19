import { describe, expect, it } from "vitest";
import {
  coverage,
  crop,
  difference,
  type Image,
  inkOnly,
  overflow,
  overlay,
  type Rect,
  unpremultiply,
} from "./pixels.js";

type Rgba = readonly [number, number, number, number];
const BLACK: Rgba = [0, 0, 0, 255];
const WHITE: Rgba = [255, 255, 255, 255];

/** Картинка, закрашенная функцией (x, y) → цвет; undefined — прозрачный пиксель. */
function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgba | undefined,
): Image {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = paint(x, y);
      if (color) data.set(color, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Холст 16×16 с запасом 4 пикселя: картинка 24×24. */
const CANVAS: Rect = { x: 4, y: 4, width: 16, height: 16 };
const inside = (x: number, y: number) => x >= 4 && x < 20 && y >= 4 && y < 20;

describe("пиксели", () => {
  it("закрашенность: пусто, целиком, полупрозрачное считается частично, за краем — не считается", () => {
    expect(
      coverage(
        image(24, 24, () => undefined),
        CANVAS,
      ),
    ).toBe(0);
    expect(
      coverage(
        image(24, 24, () => BLACK),
        CANVAS,
      ),
    ).toBe(1);
    expect(
      coverage(
        image(24, 24, () => [0, 0, 0, 51]),
        CANVAS,
      ),
    ).toBeCloseTo(0.2);
    const outside = image(24, 24, (x, y) => (inside(x, y) ? undefined : BLACK));
    expect(coverage(outside, CANVAS)).toBe(0);
  });

  it("вылет: внутри — 0, соседний с краем пиксель — 1, дальше — больше; бледный ореол не считается", () => {
    const dot = (px: number, py: number, color = BLACK) =>
      image(24, 24, (x, y) =>
        inside(x, y) || (x === px && y === py) ? color : undefined,
      );
    expect(
      overflow(
        image(24, 24, (x, y) => (inside(x, y) ? BLACK : undefined)),
        CANVAS,
      ),
    ).toBe(0);
    expect(overflow(dot(3, 10), CANVAS)).toBe(1);
    expect(overflow(dot(22, 10), CANVAS)).toBe(3);
    expect(overflow(dot(0, 0), CANVAS)).toBe(4);
    expect(overflow(dot(0, 0, [0, 0, 0, 30]), CANVAS)).toBe(0);
  });

  it("цвет, умноженный на прозрачность, переводится в обычный", () => {
    const premultiplied = {
      width: 2,
      height: 1,
      data: new Uint8Array([128, 0, 0, 128, 10, 20, 30, 0]),
    };
    expect([...unpremultiply(premultiplied).data]).toEqual([
      255, 0, 0, 128, 10, 20, 30, 0,
    ]);
  });

  it("вырезание холста", () => {
    const corner = image(24, 24, (x, y) =>
      x === 4 && y === 4 ? BLACK : undefined,
    );
    const part = crop(corner, CANVAS);
    expect([part.width, part.height]).toEqual([16, 16]);
    expect([...part.data.subarray(0, 4)]).toEqual([...BLACK]);
    expect(coverage(part, { x: 0, y: 0, width: 16, height: 16 })).toBe(1 / 256);
  });

  it("тёмная краска: светлое исчезает, тёмное становится чёрным с прежней прозрачностью", () => {
    const colors: Rgba[] = [WHITE, [33, 33, 33, 255], [229, 72, 77, 128]];
    const ink = inkOnly(image(3, 1, (x) => colors[x]));
    expect([...ink.data]).toEqual([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128]);
  });

  it("сравнение: одинаковые — 0, блок 10×10 — больше 1%, разный размер — 1", () => {
    const square = (x: number, y: number) =>
      x >= 16 && x < 48 && y >= 16 && y < 48;
    const a = image(64, 64, (x, y) => (square(x, y) ? BLACK : undefined));
    const b = image(64, 64, (x, y) =>
      square(x, y) || (x < 10 && y < 10) ? BLACK : undefined,
    );
    expect(difference(a, a)).toBe(0);
    expect(difference(a, b)).toBeGreaterThan(0.01);
    expect(difference(a, crop(a, { x: 0, y: 0, width: 32, height: 32 }))).toBe(
      1,
    );
  });

  it("белое на прозрачном — тоже отличие", () => {
    const empty = image(64, 64, () => undefined);
    const white = image(64, 64, (x, y) =>
      x < 20 && y < 20 ? WHITE : undefined,
    );
    expect(difference(empty, white)).toBeGreaterThan(0.01);
  });

  it("наложение: пропавшее — красным, появившееся — синим, совпадающее — серым", () => {
    const was = image(16, 16, (x, y) => (x < 8 && y < 12 ? BLACK : undefined));
    const now = image(16, 16, (x, y) =>
      (x < 4 || x >= 8) && y < 12 ? BLACK : undefined,
    );
    const out = overlay(was, now);
    const at = (x: number, y: number) => {
      const i = (y * 16 + x) * 4;
      return [...out.data.subarray(i, i + 3)];
    };
    expect(at(6, 6)).toEqual([229, 72, 77]);
    expect(at(12, 6)).toEqual([62, 99, 221]);
    const same = at(1, 6);
    expect(same[0]).toBe(same[1]);
    expect(same[0]).toBeGreaterThan(100);
    expect(() =>
      overlay(was, crop(was, { x: 0, y: 0, width: 8, height: 8 })),
    ).toThrow();
  });
});
