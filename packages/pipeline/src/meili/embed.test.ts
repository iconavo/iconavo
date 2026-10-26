import { SEARCH_MODEL } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import { fakeEmbeddingClient, TEST_MODELS } from "../embed/client.testing.js";
import { MODELS } from "../embed/config.js";
import { embedBatches, searchEmbeddingModel } from "./embed.js";

describe("searchEmbeddingModel", () => {
  it("та же модель, что у pnpm embed: id и полная длина", () => {
    const model = searchEmbeddingModel();
    expect(model.id).toBe(SEARCH_MODEL.id);
    expect(model.dims).toBe(SEARCH_MODEL.fullDims);
    expect(model).toBe(MODELS.find((m) => m.key === "gemini"));
  });

  it("нет такой модели — ошибка", () => {
    expect(() => searchEmbeddingModel(TEST_MODELS)).toThrow(/нет в embed/);
  });
});

describe("embedBatches", () => {
  const model = searchEmbeddingModel();
  const texts = Array.from({ length: 250 }, (_, i) => `text ${i}`);

  it("пачки модели, векторы укорочены до длины индекса", async () => {
    const embed = fakeEmbeddingClient({ rub: 0.5 });
    const got = new Map<string, Float32Array>();
    const budget = { limit: 10, spent: 0 };
    const res = await embedBatches(texts, {
      client: embed.client,
      model,
      budget,
      text: (t) => t,
      onBatch: async (items, vectors) => {
        for (const [i, t] of items.entries()) {
          got.set(t, vectors[i] as Float32Array);
        }
      },
    });
    expect(res).toEqual({ computed: 250 });
    expect(embed.calls.map((c) => c.inputs.length)).toEqual([100, 100, 50]);
    expect(got.get("text 7")).toHaveLength(SEARCH_MODEL.dims);
    expect(budget.spent).toBeCloseTo(1.5, 6);
  });

  it("перерасход лимита — новые пачки не уходят", async () => {
    const embed = fakeEmbeddingClient({ rub: 5 });
    const res = await embedBatches(texts, {
      client: embed.client,
      model,
      budget: { limit: 4, spent: 0 },
      text: (t) => t,
      onBatch: async () => {},
      concurrency: 1,
    });
    expect(res.computed).toBe(100);
    expect(res.error).toMatch(/выше лимита/);
    expect(embed.calls).toHaveLength(1);
  });

  it("сбой пачки — ошибка, посчитанное остаётся", async () => {
    const embed = fakeEmbeddingClient({
      fail: (call) => (call === 2 ? new Error("сеть") : undefined),
    });
    const res = await embedBatches(texts, {
      client: embed.client,
      model,
      budget: { limit: 10, spent: 0 },
      text: (t) => t,
      onBatch: async () => {},
      concurrency: 1,
    });
    expect(res).toEqual({ computed: 100, error: "сеть" });
  });
});
