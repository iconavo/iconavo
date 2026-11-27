// Картинки фото профиля (шаг 3 фазы 5, PR 4а): только PNG и JPEG, размер — из заголовка файла, без
// библиотек и без перекодирования. Сайт присылает уже обрезанный квадрат; сервис проверяет, что это
// действительно картинка нужного вида, а не что-то другое под её именем.

export interface ImageInfo {
  type: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const u16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32 = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) << 24) >>> 0) +
  ((b[i + 1] ?? 0) << 16) +
  ((b[i + 2] ?? 0) << 8) +
  (b[i + 3] ?? 0);

function png(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 33 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) {
    return undefined;
  }
  // Первый кусок — IHDR длиной 13: ширина и высота.
  const ihdr = String.fromCharCode(
    b[12] ?? 0,
    b[13] ?? 0,
    b[14] ?? 0,
    b[15] ?? 0,
  );
  if (u32(b, 8) !== 13 || ihdr !== "IHDR") return undefined;
  return {
    type: "image/png",
    ext: "png",
    width: u32(b, 16),
    height: u32(b, 20),
  };
}

/** Маркеры JPEG с размером кадра (SOF), кроме DHT, JPG и DAC. */
const SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpeg(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1] ?? 0;
    // Заполнители и маркеры без длины.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = u16(b, i + 2);
    if (length < 2) return undefined;
    if (SOF.has(marker)) {
      if (i + 9 > b.length) return undefined;
      return {
        type: "image/jpeg",
        ext: "jpg",
        width: u16(b, i + 7),
        height: u16(b, i + 5),
      };
    }
    i += 2 + length;
  }
  return undefined;
}

/** Вид и размер картинки; не PNG и не JPEG или заголовок испорчен — undefined. */
export function imageInfo(bytes: Uint8Array): ImageInfo | undefined {
  return png(bytes) ?? jpeg(bytes);
}
