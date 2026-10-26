// Векторы через Polza для робота индекса (ADR-0049): пачки модели, несколько пачек сразу, лимит
// стоимости. Модель — gemini из pnpm embed (ADR-0047): тот же id и полная длина вектора; в индекс
// идут первые 1024 числа, снова длины 1 (ADR-0048). Каждая готовая пачка сразу уходит в onBatch:
// обрыв теряет только пачки в пути.

import { SEARCH_MODEL, truncateUnit } from "@iconavo-ui/search";
import type { EmbeddingClient } from "../embed/client.js";
import { type EmbeddingModel, MODELS } from "../embed/config.js";
import { estimateRub, rubOfTokens } from "../embed/cost.js";
import { pool } from "../util/pool.js";
import { EMBED_CONCURRENCY } from "./config.js";

/** Модель поиска в конфиге эмбеддингов: тот же id и полная длина вектора. */
export function searchEmbeddingModel(
  models: readonly EmbeddingModel[] = MODELS,
): EmbeddingModel {
  const model = models.find((m) => m.id === SEARCH_MODEL.id);
  if (!model || model.dims !== SEARCH_MODEL.fullDims) {
    throw new Error(
      `модели ${SEARCH_MODEL.id} длины ${SEARCH_MODEL.fullDims} нет в embed/config.ts`,
    );
  }
  return model;
}

/** Лимит прогона и потраченное: общий на векторы иконок и фраз. */
export interface Budget {
  limit: number;
  spent: number;
}

/** Оценка в рублях за тексты — с запасом, как у pnpm embed. */
export const estimateTexts = (
  model: EmbeddingModel,
  texts: readonly string[],
): number =>
  estimateRub(
    model,
    texts.reduce((sum, t) => sum + t.length, 0),
  );

export interface EmbedBatchesOptions<T> {
  client: EmbeddingClient;
  model: EmbeddingModel;
  budget: Budget;
  text: (item: T) => string;
  /** Готовая пачка: элементы и их векторы длины SEARCH_MODEL.dims. */
  onBatch: (items: readonly T[], vectors: Float32Array[]) => Promise<void>;
  concurrency?: number;
}

/**
 * Векторы элементов пачками модели. Первая ошибка останавливает новые пачки; перерасход лимита —
 * тоже. Возвращает, сколько посчитано, и ошибку, если была.
 */
export async function embedBatches<T>(
  items: readonly T[],
  options: EmbedBatchesOptions<T>,
): Promise<{ computed: number; error?: string }> {
  const { client, model, budget } = options;
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += model.batchSize) {
    batches.push(items.slice(i, i + model.batchSize));
  }
  let computed = 0;
  let error: string | undefined;
  await pool(
    batches,
    options.concurrency ?? EMBED_CONCURRENCY,
    async (batch) => {
      if (error !== undefined) return;
      if (budget.spent > budget.limit) {
        error = `потрачено ${budget.spent.toFixed(2)} ₽ — выше лимита ${budget.limit} ₽`;
        return;
      }
      try {
        const texts = batch.map(options.text);
        const res = await client.embed(model, texts);
        budget.spent +=
          res.rub ??
          (res.tokens !== undefined
            ? rubOfTokens(model, res.tokens)
            : estimateTexts(model, texts));
        const vectors = res.vectors.map((v) =>
          truncateUnit(v, SEARCH_MODEL.dims),
        );
        await options.onBatch(batch, vectors);
        computed += batch.length;
      } catch (e) {
        error ??= (e as Error).message;
      }
    },
  );
  return error === undefined ? { computed } : { computed, error };
}
