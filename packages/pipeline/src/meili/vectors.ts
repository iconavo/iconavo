// Векторы иконок в закрытом бакете iconavo-search (ADR-0049; уточнение к ADR-0047: в git их по-прежнему
// нет). Формат — как в .cache/embeddings: на набор файл icons/gemini-1024/{набор}.f32 (float32
// little-endian подряд, каждый вектор длины 1) и оглавление {набор}.json — строки «имя + хэш текста»,
// размер и SHA-256 файла векторов. Векторы пишутся первыми, оглавление — последним: не сходится — набор
// считается заново. Так индекс пересобирается без Polza и без компьютера владельца.

import { createHash } from "node:crypto";
import {
  bytesVector,
  SEARCH_MODEL,
  STORE_KEYS,
  vectorBytes,
} from "@iconavo-ui/search";
import { z } from "zod";
import { md5Hex } from "../cdn/s3.js";
import type { StorageClient } from "../cdn/storage.js";
import { TEXT_VERSION } from "../embed/config.js";
import { JSON_TYPE, STORE_CACHE, VECTOR_TYPE } from "./config.js";

const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

export const vectorIndexSchema = z.strictObject({
  format: z.literal("f32le"),
  model: z.string().min(1),
  dims: z.number().int().positive(),
  textVersion: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.array(
    z.strictObject({
      name: z.string().min(1),
      textHash: z.string().regex(/^[0-9a-f]{16}$/),
    }),
  ),
});

export type VectorIndex = z.infer<typeof vectorIndexSchema>;

export interface StoredVector {
  textHash: string;
  vector: Float32Array;
}

/** Векторы набора по имени карточки. */
export type SetVectors = Map<string, StoredVector>;

export type SetVectorsRead =
  | { status: "ok"; vectors: SetVectors }
  | { status: "missing"; vectors: SetVectors }
  | { status: "broken"; vectors: SetVectors; reason: string };

/** Векторы набора из бакета; нет или сломаны — пустой список и причина. */
export async function readSetVectors(
  storage: StorageClient,
  set: string,
): Promise<SetVectorsRead> {
  const empty: SetVectors = new Map();
  const indexBytes = await storage.get(STORE_KEYS.iconIndex(set));
  if (indexBytes === undefined) return { status: "missing", vectors: empty };
  const broken = (reason: string): SetVectorsRead => ({
    status: "broken",
    vectors: empty,
    reason,
  });
  let index: VectorIndex;
  try {
    index = vectorIndexSchema.parse(
      JSON.parse(Buffer.from(indexBytes).toString("utf8")),
    );
  } catch {
    return broken("оглавление не по форме");
  }
  if (
    index.model !== SEARCH_MODEL.id ||
    index.dims !== SEARCH_MODEL.dims ||
    index.textVersion !== TEXT_VERSION
  ) {
    return broken("другая модель, длина вектора или версия текста");
  }
  if (index.count !== index.rows.length) {
    return broken("число векторов не сходится со строками");
  }
  const bytes = await storage.get(STORE_KEYS.iconVectors(set));
  if (bytes === undefined) return broken("нет файла векторов");
  if (
    bytes.byteLength !== index.count * index.dims * 4 ||
    sha256(bytes) !== index.sha256
  ) {
    return broken("файл векторов не сходится с оглавлением");
  }
  const vectors: SetVectors = new Map();
  const size = index.dims * 4;
  index.rows.forEach((row, i) => {
    const vector = bytesVector(
      bytes.subarray(i * size, (i + 1) * size),
      index.dims,
    );
    if (vector) vectors.set(row.name, { textHash: row.textHash, vector });
  });
  return { status: "ok", vectors };
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Записать векторы набора: сначала файл векторов, оглавление — последним. */
export async function writeSetVectors(
  storage: StorageClient,
  set: string,
  vectors: SetVectors,
): Promise<void> {
  const names = [...vectors.keys()].sort(order);
  const size = SEARCH_MODEL.dims * 4;
  const bytes = new Uint8Array(names.length * size);
  const rows = names.map((name, i) => {
    const v = vectors.get(name) as StoredVector;
    if (v.vector.length !== SEARCH_MODEL.dims) {
      throw new Error(`${set}:${name}: вектор длины ${v.vector.length}`);
    }
    bytes.set(vectorBytes(v.vector), i * size);
    return { name, textHash: v.textHash };
  });
  const index: VectorIndex = {
    format: "f32le",
    model: SEARCH_MODEL.id,
    dims: SEARCH_MODEL.dims,
    textVersion: TEXT_VERSION,
    count: rows.length,
    sha256: sha256(bytes),
    rows,
  };
  await putObject(storage, STORE_KEYS.iconVectors(set), bytes, VECTOR_TYPE);
  await putObject(
    storage,
    STORE_KEYS.iconIndex(set),
    Buffer.from(`${JSON.stringify(index)}\n`, "utf8"),
    JSON_TYPE,
  );
}

/** Запись объекта в бакет поиска: хранилище сверяет содержимое по MD5. */
export function putObject(
  storage: StorageClient,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  return storage.put(key, body, {
    contentType,
    cacheControl: STORE_CACHE,
    md5: md5Hex(body),
    sha256: sha256(body),
  });
}
