// Векторы запросов и фраз (ADR-0047, ADR-0049): ключ, укорачивание и байты. Ключ — первые 32 символа
// SHA-256 от id модели и нормализованного текста; считается через WebCrypto, одинаково в Node (робот
// индекса, замер) и в Workers (функция edge API). Байты — float32 little-endian, как в .cache/embeddings.

const encoder = new TextEncoder();

/** Ключ вектора текста: смена модели не берёт старый вектор. */
export async function vectorHash(
  modelId: string,
  text: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${modelId}\n${text}`),
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex.slice(0, 32);
}

/** Первые dims чисел вектора, снова приведённые к длине 1 (ADR-0048). */
export function truncateUnit(
  vector: ArrayLike<number>,
  dims: number,
): Float32Array {
  if (vector.length < dims) {
    throw new Error(
      `в векторе ${vector.length} чисел, нужно не меньше ${dims}`,
    );
  }
  let sum = 0;
  for (let i = 0; i < dims; i++) {
    const v = vector[i] as number;
    sum += v * v;
  }
  const norm = Math.sqrt(sum);
  if (!(norm > 0 && Number.isFinite(norm))) {
    throw new Error("у вектора нулевая или неверная длина");
  }
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i++) out[i] = (vector[i] as number) / norm;
  return out;
}

/** Вектор → байты float32 little-endian. */
export function vectorBytes(vector: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(vector.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < vector.length; i++) {
    view.setFloat32(i * 4, vector[i] as number, true);
  }
  return out;
}

/** Байты float32 little-endian → вектор; не та длина — undefined. */
export function bytesVector(
  bytes: ArrayBuffer | Uint8Array,
  dims: number,
): Float32Array | undefined {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength !== dims * 4) return undefined;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
