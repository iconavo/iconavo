import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, pngDataUri } from "./png.js";

// 2×2: красный, полупрозрачный зелёный, прозрачный синий, почти чёрный.
const RGBA = new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4,
]);

/** Кусок PNG по типу: данные и проверка контрольной суммы. */
function chunkOf(png: Buffer, type: string) {
  const at = png.indexOf(type, 8, "latin1");
  const length = png.readUInt32BE(at - 4);
  const data = png.subarray(at + 4, at + 4 + length);
  const crc = png.readUInt32BE(at + 4 + length);
  return { data, crcOk: crc === crc32(png.subarray(at, at + 4 + length)) };
}

describe("PNG для отчёта", () => {
  it("подпись, заголовок и контрольные суммы", () => {
    const png = encodePng(RGBA, 2, 2);
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const header = chunkOf(png, "IHDR");
    expect(header.crcOk).toBe(true);
    expect(header.data.readUInt32BE(0)).toBe(2);
    expect(header.data.readUInt32BE(4)).toBe(2);
    expect([...header.data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    expect(chunkOf(png, "IDAT").crcOk).toBe(true);
    expect(png.subarray(-12).toString("latin1", 4, 8)).toBe("IEND");
  });

  it("распаковка возвращает те же пиксели, строка начинается с фильтра 0", () => {
    const raw = inflateSync(chunkOf(encodePng(RGBA, 2, 2), "IDAT").data);
    expect([...raw]).toEqual([
      0,
      ...RGBA.subarray(0, 8),
      0,
      ...RGBA.subarray(8),
    ]);
  });

  it("одинаковые пиксели — одинаковый файл; размер должен сходиться", () => {
    expect(encodePng(RGBA, 2, 2).equals(encodePng(RGBA, 2, 2))).toBe(true);
    expect(() => encodePng(RGBA, 3, 2)).toThrow(/нужно 3×2/);
    expect(pngDataUri(RGBA, 2, 2)).toMatch(/^data:image\/png;base64,iVBORw0K/);
  });
});
