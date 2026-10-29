import { crc32, deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, pngDataUri } from "./png.js";

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

/** PNG 8 бит с заданным видом цвета и фильтром каждой строки — как пишут браузеры. */
function filteredPng(
  pixels: number[][],
  width: number,
  channels: 3 | 4,
  filters: number[],
): Buffer {
  const stride = width * channels;
  const rows = pixels.map((row) => Uint8Array.from(row));
  const raw: number[] = [];
  for (const [y, row] of rows.entries()) {
    const filter = filters[y] as number;
    raw.push(filter);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (row[x - channels] as number) : 0;
      const up = y > 0 ? (rows[y - 1]?.[x] as number) : 0;
      const upLeft =
        y > 0 && x >= channels ? (rows[y - 1]?.[x - channels] as number) : 0;
      const p = left + up - upLeft;
      const paeth =
        Math.abs(p - left) <= Math.abs(p - up) &&
        Math.abs(p - left) <= Math.abs(p - upLeft)
          ? left
          : Math.abs(p - up) <= Math.abs(p - upLeft)
            ? up
            : upLeft;
      const predicted = [0, left, up, (left + up) >> 1, paeth][
        filter
      ] as number;
      raw.push(((row[x] as number) - predicted) & 0xff);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(rows.length, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    encodePng(new Uint8Array(4), 1, 1).subarray(0, 8),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("PNG снимков браузера", () => {
  it("обратно из encodePng — те же пиксели", () => {
    expect(decodePng(encodePng(RGBA, 2, 2))).toEqual({
      width: 2,
      height: 2,
      data: RGBA,
    });
  });

  it("все пять фильтров строк, RGB — с полной непрозрачностью", () => {
    const rgb = [
      [10, 20, 30, 200, 100, 50],
      [11, 22, 33, 199, 98, 47],
      [250, 5, 128, 7, 255, 0],
      [1, 2, 3, 4, 5, 6],
      [9, 8, 7, 6, 5, 4],
    ];
    const image = decodePng(filteredPng(rgb, 2, 3, [0, 1, 2, 3, 4]));
    expect(image.width).toBe(2);
    expect(image.height).toBe(5);
    expect([...image.data]).toEqual(
      rgb.flatMap((row) => [...row.slice(0, 3), 255, ...row.slice(3), 255]),
    );
    const rgba = [
      [1, 2, 3, 4, 250, 251, 252, 253],
      [5, 6, 7, 8, 9, 10, 11, 12],
    ];
    expect([...decodePng(filteredPng(rgba, 2, 4, [4, 3])).data]).toEqual(
      rgba.flat(),
    );
  });

  it("не PNG и неизвестный фильтр — ошибка", () => {
    expect(() => decodePng(Buffer.from("not a png"))).toThrow(/нет подписи/);
    const bad = filteredPng([[1, 2, 3]], 1, 3, [0]);
    // Подменить номер фильтра первой строки на 7: распаковать, поправить, упаковать.
    const at = bad.indexOf("IDAT", 8, "latin1");
    const length = bad.readUInt32BE(at - 4);
    const raw = inflateSync(bad.subarray(at + 4, at + 4 + length));
    raw[0] = 7;
    const idat = deflateSync(raw);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(idat.length, 0);
    head.write("IDAT", 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), idat])), 0);
    const broken = Buffer.concat([
      bad.subarray(0, at - 4),
      head,
      idat,
      crc,
      bad.subarray(at + 8 + length),
    ]);
    expect(() => decodePng(broken)).toThrow(/неизвестный фильтр 7/);
  });
});
