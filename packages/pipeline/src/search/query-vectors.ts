// Векторы поисковых запросов (шаг 12, ADR-0048): кэш — файл на запрос,
// .cache/search/queries/{модель}/{хэш}.f32 (float32 little-endian, длина 1). Хэш — от id модели и
// того, что уходит модели (у Qwen — с инструкцией), поэтому смена модели или инструкции не берёт
// старый вектор. Промахи кэша уходят пачками, как тексты иконок: 200 запросов эталона — две пачки.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../build/write.js";
import {
  type EmbeddingClient,
  errorScope,
  type StopScope,
} from "../embed/client.js";
import type { EmbeddingModel } from "../embed/config.js";
import { bytesToFloat32 } from "../embed/store.js";
import { queryInput } from "../embed/text.js";

/** Первые 32 символа SHA-256 от id модели и текста, который уходит модели. */
export const queryHash = (model: EmbeddingModel, input: string): string =>
  createHash("sha256")
    .update(`${model.id}\n${input}`)
    .digest("hex")
    .slice(0, 32);

export const queryVectorPath = (
  dir: string,
  model: EmbeddingModel,
  query: string,
) => join(dir, model.key, `${queryHash(model, queryInput(model, query))}.f32`);

export interface QueryVectors {
  /** Векторы в порядке запросов; нет — undefined (поиск тогда — только текстовая часть). */
  vectors: (Float32Array | undefined)[];
  /** Из кэша и посчитано сейчас. */
  cached: number;
  fetched: number;
  /** Время ответов Polza на пачки, мс; рубли из ответов. */
  ms: number[];
  rub: number;
  /** Почему векторов нет: нет ключа, сбой сети, отказ — и что он останавливает. */
  error?: string;
  scope?: StopScope;
}

async function readCached(
  path: string,
  dims: number,
): Promise<Float32Array | undefined> {
  try {
    const bytes = await readFile(path);
    return bytes.byteLength === dims * 4 ? bytesToFloat32(bytes) : undefined;
  } catch {
    return undefined;
  }
}

/** Векторы запросов модели: из кэша, недостающие — у Polza пачками по model.batchSize. */
export async function queryVectors(
  model: EmbeddingModel,
  queries: readonly string[],
  options: { dir: string; client?: EmbeddingClient },
): Promise<QueryVectors> {
  const out: QueryVectors = {
    vectors: [],
    cached: 0,
    fetched: 0,
    ms: [],
    rub: 0,
  };
  const missing = new Map<string, number[]>();
  for (const [i, query] of queries.entries()) {
    const vector = await readCached(
      queryVectorPath(options.dir, model, query),
      model.dims,
    );
    out.vectors.push(vector);
    if (vector) {
      out.cached++;
      continue;
    }
    const list = missing.get(query) ?? [];
    list.push(i);
    missing.set(query, list);
  }
  if (missing.size === 0) return out;
  if (!options.client) {
    out.error = "нет ключа POLZA_API_KEY — только текстовая часть";
    return out;
  }
  const todo = [...missing.keys()];
  for (let start = 0; start < todo.length; start += model.batchSize) {
    const batch = todo.slice(start, start + model.batchSize);
    try {
      const res = await options.client.embed(
        model,
        batch.map((q) => queryInput(model, q)),
      );
      out.ms.push(res.ms);
      out.rub += res.rub ?? 0;
      for (const [k, query] of batch.entries()) {
        const vector = res.vectors[k];
        if (!vector) continue;
        await writeFileAtomic(
          queryVectorPath(options.dir, model, query),
          new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
        );
        out.fetched++;
        for (const i of missing.get(query) ?? []) out.vectors[i] = vector;
      }
    } catch (e) {
      out.error = (e as Error).message;
      out.scope = errorScope(e);
      break;
    }
  }
  return out;
}
