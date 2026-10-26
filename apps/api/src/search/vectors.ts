// Вектор запроса (ADR-0040, ADR-0049): кэш дата-центра → фразы каталога в бакете iconavo-search →
// Polza. Ключ — vectorHash общего модуля, тот же, что у робота индекса. Polza просит сразу 1024 числа
// (dimensions): вектор тот же, что укороченный полный, а ответ втрое короче. Вектор нового запроса
// запоминается в кэше дата-центра; в бакет функция не пишет (ADR-0028).

import {
  bytesVector,
  SEARCH_MODEL,
  STORE_KEYS,
  truncateUnit,
  vectorBytes,
} from "@iconavo-ui/search";
import {
  CACHE_GENERATION,
  CACHE_ORIGIN,
  POLZA_EMBEDDINGS_URL,
  QUERY_VECTOR_CACHE,
} from "../config.js";
import type { Bucket, EdgeCache } from "../env.js";

export type VectorSource = "cache" | "store" | "model";

/** Модель векторов не ответила или ответила не так: поиск идёт только по словам (ADR-0027). */
export class ModelError extends Error {}

const vectorKey = (hash: string) =>
  new Request(
    `${CACHE_ORIGIN}/${CACHE_GENERATION}/qv/${SEARCH_MODEL.key}/${hash}`,
  );

/** Вектор из кэша дата-центра; нет — undefined. */
export async function cachedVector(
  cache: EdgeCache,
  hash: string,
): Promise<Float32Array | undefined> {
  const hit = await cache.match(vectorKey(hash));
  return hit
    ? bytesVector(await hit.arrayBuffer(), SEARCH_MODEL.dims)
    : undefined;
}

/** Запомнить вектор в кэше дата-центра. */
export function rememberVector(
  cache: EdgeCache,
  hash: string,
  vector: Float32Array,
): Promise<void> {
  return cache.put(
    vectorKey(hash),
    // Буфер ровно по вектору: vectorBytes создаёт его заново.
    new Response(vectorBytes(vector).buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": QUERY_VECTOR_CACHE,
      },
    }),
  );
}

/** Вектор фразы каталога из бакета поиска; нет — undefined. */
export async function storedVector(
  bucket: Bucket | undefined,
  hash: string,
): Promise<Float32Array | undefined> {
  const object = await bucket?.get(STORE_KEYS.phrase(hash));
  return object
    ? bytesVector(await object.arrayBuffer(), SEARCH_MODEL.dims)
    : undefined;
}

/** Вектор текста у Polza: первые 1024 числа, снова длины 1. */
export async function modelVector(
  fetchFn: typeof fetch,
  apiKey: string,
  text: string,
  timeoutMs: number,
): Promise<Float32Array> {
  let res: Response;
  try {
    res = await fetchFn(POLZA_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: SEARCH_MODEL.id,
        input: [text],
        dimensions: SEARCH_MODEL.dims,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ModelError(`Polza: ${(e as Error).name}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new ModelError(`Polza: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    data?: { embedding?: unknown }[];
  };
  const embedding = data.data?.[0]?.embedding;
  if (
    !Array.isArray(embedding) ||
    embedding.length < SEARCH_MODEL.dims ||
    !embedding.every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    throw new ModelError("Polza: ответ без вектора");
  }
  return truncateUnit(embedding as number[], SEARCH_MODEL.dims);
}
