// PNG из пикселей RGBA — для картинок в отчёте контроля качества. Без зависимостей: zlib встроен
// в Node. Одинаковые пиксели дают одинаковый файл.

import { crc32, deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** PNG из пикселей RGBA без умножения на прозрачность: 8 бит на канал, без чересстрочности. */
export function encodePng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Buffer {
  const stride = width * 4;
  if (rgba.length !== stride * height) {
    throw new Error(
      `PNG: пикселей ${rgba.length / 4}, а нужно ${width}×${height}`,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // бит на канал
  header[9] = 6; // RGBA; сжатие, фильтр и чересстрочность — нули
  // Каждая строка начинается с номера фильтра: 0 — без фильтра.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** PNG как адрес data: для <img> в отчёте. */
export const pngDataUri = (rgba: Uint8Array, width: number, height: number) =>
  `data:image/png;base64,${encodePng(rgba, width, height).toString("base64")}`;
