import { describe, expect, it } from "vitest";
import type { GoldenQuery } from "../eval/golden.js";
import type { FetchFn } from "../sources/npm.js";
import {
  benchMet,
  benchSearch,
  benchSummary,
  formatBench,
  percentile,
  renderBenchPage,
} from "./bench.js";

const queries: GoldenQuery[] = [
  {
    id: "ru-002",
    query: "дом",
    lang: "ru",
    type: "object",
    description: "Домик.",
    split: "holdout",
  },
  {
    id: "en-002",
    query: "house",
    lang: "en",
    type: "object",
    description: "Домик.",
    split: "holdout",
  },
];

/** Часы и сеть: ответ за answerMs; «дом» сначала pending, полная — со второго повтора. */
function fakeNet(answerMs: number) {
  let t = 0;
  const seen = new Map<string, number>();
  const full = new Set<string>();
  const calls: string[] = [];
  const fetchFn: FetchFn = async (input) => {
    const url = String(input);
    calls.push(url);
    t += answerMs;
    const n = (seen.get(url) ?? 0) + 1;
    seen.set(url, n);
    const pending = url.includes(encodeURIComponent("дом")) && n < 3;
    // Полная выдача ложится в кэш: следующий запрос того же адреса — HIT.
    const cache = full.has(url) ? "HIT" : "MISS";
    if (!pending) full.add(url);
    return new Response(
      JSON.stringify({ icons: [], semantic: pending ? "pending" : "full" }),
      {
        headers: {
          "x-cache": cache,
          "server-timing": `vector;desc="${pending ? "pending" : "store"}";dur=5, total;dur=40`,
        },
      },
    );
  };
  return {
    fetchFn,
    calls,
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("pnpm api bench", () => {
  it("холодный проход с ожиданием полной выдачи, повтор — из кэша, темп не выше лимита", async () => {
    const net = fakeNet(80);
    const r = await benchSearch({
      base: "https://api.example",
      queries,
      fetch: net.fetchFn,
      now: net.now,
      sleep: net.sleep,
    });
    expect(r.cold.map((s) => s.semantic)).toEqual(["pending", "full"]);
    expect(r.cold[0]?.vector).toBe("pending");
    expect(r.cold[0]?.fullMs).toBeGreaterThan(0);
    expect(r.cold[1]).toMatchObject({ ms: 80, vector: "store", serverMs: 40 });
    expect(r.warm.every((s) => s.cache === "HIT")).toBe(true);
    // Темп: не чаще раза в 1,3 с, вместе с повторами pending.
    expect(net.calls).toHaveLength(2 + 2 + 2);
    const cold = benchSummary(r.cold);
    expect(cold).toMatchObject({ n: 2, errors: 0, within: 1, neverFull: 0 });
    expect(benchMet(r)).toBe(true);
    expect(formatBench(r).at(-1)).toMatch(/Цель ADR-0040 выполнена/);
    expect(renderBenchPage(r)).toContain("Холодный проход");
  });

  it("медленные ответы — цель не выполнена", async () => {
    const net = fakeNet(450);
    const r = await benchSearch({
      base: "https://api.example",
      queries,
      fetch: net.fetchFn,
      now: net.now,
      sleep: net.sleep,
    });
    expect(benchMet(r)).toBe(false);
    expect(formatBench(r).at(-1)).toMatch(
      /не выполнена: P95 первых ответов 450 мс/,
    );
  });

  it("перцентиль — по ближайшему рангу", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile([7], 0.99)).toBe(7);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });
});
