import { createHash } from "node:crypto";
import type { EmbeddingClient } from "./client.js";
import type { EmbeddingModel } from "./config.js";
import { unitVector } from "./parse.js";

/** Модели для тестов: короткие векторы и маленькие пачки. */
export const TEST_MODELS: readonly EmbeddingModel[] = [
  { key: "a", id: "test/a", dims: 4, rubPerMillion: 10, batchSize: 2 },
  {
    key: "q",
    id: "test/q",
    dims: 6,
    rubPerMillion: 1,
    batchSize: 100,
    queryInstruction: "Find icons",
  },
];

/** Постоянный «вектор смысла» из хэша текста: у разных текстов — разные векторы. */
export function hashVector(text: string, dims: number): number[] {
  const digest = createHash("sha256").update(text).digest();
  return Array.from({ length: dims }, (_, i) => (digest[i % 32] ?? 0) - 127.5);
}

export interface FakeEmbeddingOptions {
  /** Числа вектора для текста; по умолчанию — из хэша текста. */
  vector?: (model: EmbeddingModel, input: string) => number[];
  /** Ошибка для вызова номер call (с 1). */
  fail?: (
    call: number,
    model: EmbeddingModel,
    inputs: readonly string[],
  ) => Error | undefined;
  /** Рубли за один вызов; null — Polza не вернула cost_rub. */
  rub?: number | null;
}

/**
 * Подменный клиент Polza без сети: запоминает вызовы и считает, сколько их шло одновременно.
 * Токены — по символу на токен, чтобы их было легко проверить.
 */
export function fakeEmbeddingClient(options: FakeEmbeddingOptions = {}) {
  const calls: { model: string; inputs: string[] }[] = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  const client: EmbeddingClient = {
    async embed(model, inputs) {
      calls.push({ model: model.key, inputs: [...inputs] });
      const call = calls.length;
      stats.inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        const error = options.fail?.(call, model, inputs);
        if (error) throw error;
        const vectors = inputs.map((input) => {
          const v = unitVector(
            options.vector?.(model, input) ?? hashVector(input, model.dims),
          );
          if (!v) throw new Error("тест: нулевой вектор");
          return v;
        });
        const rub = options.rub === undefined ? 0.01 : options.rub;
        return {
          vectors,
          tokens: inputs.join("").length,
          ...(rub === null ? {} : { rub }),
          ms: 5,
        };
      } finally {
        stats.inFlight--;
      }
    },
  };
  return { client, calls, stats };
}
