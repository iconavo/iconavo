// PNG из пикселей RGBA — для картинок в отчёте контроля качества — и обратно: снимки браузера для
// визуального сравнения (шаг 9 фазы 3). Без зависимостей: zlib встроен в Node. Одинаковые пиксели
// дают одинаковый файл.

import { crc32, deflateSync, inflateSync } from "node:zlib";
import type { Image } from "./pixels.js";

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

/** Предсказатель Паэта: соседний байт, ближайший к left + up − upLeft. */
function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const a = Math.abs(p - left);
  const b = Math.abs(p - up);
  const c = Math.abs(p - upLeft);
  return a <= b && a <= c ? left : b <= c ? up : upLeft;
}

/**
 * Пиксели RGBA из PNG — такого, какой дают снимки браузеров: 8 бит на канал, RGB или RGBA, без
 * чересстрочности. RGB получает полную непрозрачность. Другой PNG — ошибка.
 */
export function decodePng(png: Uint8Array): Image {
  const data = Buffer.from(png);
  if (!data.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("PNG: нет подписи");
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Buffer[] = [];
  for (let at = 8; at + 8 <= data.length; ) {
    const length = data.readUInt32BE(at);
    const type = data.toString("latin1", at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const color = body[9];
      if (depth !== 8 || (color !== 2 && color !== 6) || body[12] !== 0) {
        throw new Error(
          `PNG: нужен 8 бит RGB или RGBA без чересстрочности, а здесь бит ${depth}, цвет ${color}, чересстрочность ${body[12]}`,
        );
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      parts.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (channels === 0) throw new Error("PNG: нет заголовка IHDR");
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) {
    throw new Error(
      `PNG: данных ${raw.length} байт, а нужно ${(stride + 1) * height}`,
    );
  }
  // Строка без фильтра — по байтам с учётом левого (на пиксель раньше) и верхнего соседей.
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const from = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const byte = raw[from + x] as number;
      const left = x >= channels ? (rows[out + x - channels] as number) : 0;
      const up = y > 0 ? (rows[out - stride + x] as number) : 0;
      const upLeft =
        y > 0 && x >= channels
          ? (rows[out - stride + x - channels] as number)
          : 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : filter === 4
                  ? paeth(left, up, upLeft)
                  : Number.NaN;
      if (Number.isNaN(predicted)) {
        throw new Error(`PNG: неизвестный фильтр ${filter} в строке ${y}`);
      }
      rows[out + x] = (byte + predicted) & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    rgba[j] = rows[i] as number;
    rgba[j + 1] = rows[i + 1] as number;
    rgba[j + 2] = rows[i + 2] as number;
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}
