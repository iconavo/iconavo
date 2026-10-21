// Векторы на диске (ADR-0047), решение владельца — локально, не в git:
// .cache/embeddings/{модель}/{набор}.f32 — числа float32 подряд, little-endian, каждый вектор длины 1;
// {набор}.json — оглавление: модель, длина вектора, версия текста, строки «имя + хэш текста», размер и
// SHA-256 файла векторов, накопленный расход. Векторы пишутся первыми, оглавление — последним: пока
// оно не сходится с .f32, векторы набора считаются заново. Это кэш: сломанный файл — пересчёт, а не
// остановка команды.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { endianness } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../build/write.js";
import { type EmbeddingModel, TEXT_VERSION } from "./config.js";
import type { Spent } from "./cost.js";

export const STORE_FORMAT = "f32le";

const spentSchema = z.strictObject({
  requests: z.number().int().nonnegative(),
  texts: z.number().int().nonnegative(),
  tokens: z.number().nonnegative(),
  chars: z.number().int().nonnegative(),
  rub: z.number().nonnegative(),
  rubCalculated: z.number().nonnegative(),
});

export const storeIndexSchema = z.strictObject({
  format: z.literal(STORE_FORMAT),
  model: z.string().min(1),
  dims: z.number().int().positive(),
  textVersion: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.array(
    z.strictObject({
      name: z.string().min(1),
      textHash: z.string().regex(/^[0-9a-f]{16}$/),
    }),
  ),
  /** Расход на векторы этого набора с первого прогона. */
  spent: spentSchema,
});

export type StoreIndex = z.infer<typeof storeIndexSchema>;
export type StoreRow = StoreIndex["rows"][number];

export interface StoredVectors {
  index: StoreIndex;
  /** count × dims чисел подряд, в порядке строк оглавления. */
  vectors: Float32Array;
}

export type IndexRead =
  | { kind: "missing" }
  | { kind: "broken"; reason: string }
  | { kind: "ok"; index: StoreIndex };

export type StoreRead =
  | { kind: "missing" }
  | { kind: "broken"; reason: string }
  | { kind: "ok"; store: StoredVectors };

export const storePaths = (
  dir: string,
  model: EmbeddingModel,
  setId: string,
) => ({
  index: join(dir, model.key, `${setId}.json`),
  vectors: join(dir, model.key, `${setId}.f32`),
});

const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

/** Float32Array пишется и читается в порядке байтов машины, а формат файла — little-endian. */
function assertLittleEndian(): void {
  if (endianness() !== "LE") {
    throw new Error(
      "векторы хранятся в порядке байтов little-endian, а у этого компьютера другой",
    );
  }
}

/** Оглавление без векторов: для таблицы готовности и проверки, не устарели ли векторы. */
export async function readIndex(
  dir: string,
  model: EmbeddingModel,
  setId: string,
): Promise<IndexRead> {
  let text: string;
  try {
    text = await readFile(storePaths(dir, model, setId).index, "utf8");
  } catch {
    return { kind: "missing" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "broken", reason: "оглавление векторов не читается" };
  }
  const parsed = storeIndexSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "broken", reason: "оглавление векторов не по формату" };
  }
  const index = parsed.data;
  if (index.model !== model.id || index.dims !== model.dims) {
    return {
      kind: "broken",
      reason: `векторы другой модели или длины (${index.model}, ${index.dims})`,
    };
  }
  if (index.textVersion !== TEXT_VERSION) {
    return {
      kind: "broken",
      reason: `векторы для текста версии ${index.textVersion}, а сейчас версия ${TEXT_VERSION}`,
    };
  }
  if (
    index.rows.length !== index.count ||
    index.bytes !== index.count * index.dims * 4
  ) {
    return { kind: "broken", reason: "оглавление векторов не сходится" };
  }
  return { kind: "ok", index };
}

/** Оглавление и векторы; размер и хэш .f32 сверяются с оглавлением. */
export async function readStore(
  dir: string,
  model: EmbeddingModel,
  setId: string,
): Promise<StoreRead> {
  assertLittleEndian();
  const head = await readIndex(dir, model, setId);
  if (head.kind !== "ok") return head;
  let buf: Buffer;
  try {
    buf = await readFile(storePaths(dir, model, setId).vectors);
  } catch {
    return { kind: "broken", reason: "нет файла векторов" };
  }
  if (
    buf.byteLength !== head.index.bytes ||
    sha256(buf) !== head.index.sha256
  ) {
    return {
      kind: "broken",
      reason: "файл векторов не сходится с оглавлением",
    };
  }
  return {
    kind: "ok",
    store: { index: head.index, vectors: bytesToFloat32(buf) },
  };
}

/**
 * Байты файла → числа float32. Без копии, если байты начинаются с адреса, кратного 4: большой файл
 * Node читает в свой буфер с начала, и векторы набора не занимают память дважды. Иначе — копия:
 * Buffer бывает куском общего пула со смещением, не кратным 4, и Float32Array поверх него не построить.
 */
export function bytesToFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) {
    throw new Error(`байтов ${bytes.byteLength} — не кратно 4`);
  }
  if (bytes.byteOffset % 4 === 0) {
    return new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 4,
    );
  }
  const out = new Float32Array(bytes.byteLength / 4);
  new Uint8Array(out.buffer).set(bytes);
  return out;
}

/** Векторы первыми, оглавление последним — оба через временный файл. */
export async function writeStore(
  dir: string,
  model: EmbeddingModel,
  setId: string,
  rows: readonly StoreRow[],
  vectors: Float32Array,
  spent: Spent,
): Promise<StoreIndex> {
  assertLittleEndian();
  if (vectors.length !== rows.length * model.dims) {
    throw new Error(
      `${model.key}/${setId}: чисел ${vectors.length}, а строк ${rows.length} по ${model.dims}`,
    );
  }
  const bytes = new Uint8Array(
    vectors.buffer,
    vectors.byteOffset,
    vectors.byteLength,
  );
  const index: StoreIndex = {
    format: STORE_FORMAT,
    model: model.id,
    dims: model.dims,
    textVersion: TEXT_VERSION,
    count: rows.length,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    rows: rows.map((r) => ({ name: r.name, textHash: r.textHash })),
    spent,
  };
  const paths = storePaths(dir, model, setId);
  await writeFileAtomic(paths.vectors, bytes);
  await writeFileAtomic(paths.index, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
