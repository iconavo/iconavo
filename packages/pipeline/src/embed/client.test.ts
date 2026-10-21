import { describe, expect, it } from "vitest";
import { errorScope, polzaEmbeddingClient, retryDelay } from "./client.js";
import { TEST_MODELS } from "./client.testing.js";

const model = TEST_MODELS[0];
if (!model) throw new Error("нет тестовой модели");
const KEY = "sk-test-secret-key";

type Reply = Response | Error | (() => Response | Error);

/** Подменный fetch: ответы по очереди, запросы запоминаются. */
function fakeFetch(replies: Reply[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    const next = replies.shift();
    if (next === undefined) throw new Error("тест: ответы кончились");
    const reply = typeof next === "function" ? next() : next;
    if (reply instanceof Error) throw reply;
    return reply;
  }) as typeof fetch;
  return { fetch: fn, requests };
}

const ok = (
  vectors: number[][],
  usage: object = { prompt_tokens: 7, cost_rub: 0.25 },
) =>
  Response.json({
    object: "list",
    data: vectors.map((embedding, index) => ({
      object: "embedding",
      index,
      embedding,
    })),
    usage,
  });

function setup(replies: Reply[]) {
  const f = fakeFetch(replies);
  const sleeps: number[] = [];
  let t = 0;
  const client = polzaEmbeddingClient({
    apiKey: KEY,
    baseUrl: "https://example.test/api/v1",
    fetch: f.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => (t += 10),
  });
  return { client, sleeps, requests: f.requests };
}

describe("клиент Polza", () => {
  it("POST /embeddings с моделью и текстами, без dimensions; векторы по index", async () => {
    const reply = Response.json({
      data: [
        { index: 1, embedding: [0, 2, 0, 0] },
        { index: 0, embedding: [1, 0, 0, 0] },
      ],
      usage: { prompt_tokens: 7, cost_rub: 0.25 },
    });
    const { client, requests } = setup([reply]);
    const res = await client.embed(model, ["a", "b"]);
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req?.url).toBe("https://example.test/api/v1/embeddings");
    expect(req?.init.method).toBe("POST");
    expect(JSON.parse(String(req?.init.body))).toEqual({
      model: "test/a",
      input: ["a", "b"],
    });
    const headers = (req?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(Array.from(res.vectors[0] ?? [])).toEqual([1, 0, 0, 0]);
    expect(Array.from(res.vectors[1] ?? [])).toEqual([0, 1, 0, 0]);
    expect(res).toMatchObject({ tokens: 7, rub: 0.25, ms: 10 });
  });

  it("429 ждёт по Retry-After, 503 — 1, 2, 4, 8 с, после 5 попыток — ошибка модели", async () => {
    const busy = () =>
      new Response("busy", { status: 429, headers: { "retry-after": "2" } });
    const down = () => new Response("down", { status: 503 });
    const first = setup([busy(), ok([[1, 0, 0, 0]])]);
    await first.client.embed(model, ["a"]);
    expect(first.sleeps).toEqual([2000]);

    const second = setup([down(), down(), down(), down(), down()]);
    const error = await second.client.embed(model, ["a"]).catch((e) => e);
    expect(error.message).toMatch(
      /HTTP 503 — down — не получилось за 5 попыток/,
    );
    expect(errorScope(error)).toBe("model");
    expect(second.sleeps).toEqual([1000, 2000, 4000, 8000]);
  });

  it("повтор после сбоя сети, истёкшего ожидания и ответа не в JSON", async () => {
    const network = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET" },
    });
    const timeout = new DOMException("timeout", "TimeoutError");
    const { client, sleeps } = setup([
      network,
      timeout,
      new Response("<html>прокси</html>", { status: 200 }),
      ok([[0, 0, 0, 1]]),
    ]);
    const res = await client.embed(model, ["a"]);
    expect(Array.from(res.vectors[0] ?? [])).toEqual([0, 0, 0, 1]);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("401 и 402 останавливают весь прогон сразу, ключа в тексте нет", async () => {
    for (const status of [401, 402, 403]) {
      const { client, sleeps } = setup([
        new Response(`{"error":"bad key ${KEY}"}`, { status }),
      ]);
      const error = await client.embed(model, ["a"]).catch((e) => e);
      expect(errorScope(error)).toBe("run");
      expect(error.message).toContain(`HTTP ${status}`);
      expect(error.message).not.toContain(KEY);
      expect(sleeps).toEqual([]);
    }
  });

  it("другой 4xx — остановка модели с началом ответа, без повтора", async () => {
    const { client, sleeps } = setup([
      new Response(`{"error":{"message":"too many inputs"}}`, { status: 400 }),
    ]);
    const error = await client.embed(model, ["a"]).catch((e) => e);
    expect(errorScope(error)).toBe("model");
    expect(error.message).toMatch(
      /test\/a: запрос отклонён \(HTTP 400 — .*too many inputs/,
    );
    expect(sleeps).toEqual([]);
  });

  it("вектор не той длины — ошибка модели без повтора", async () => {
    const { client, sleeps } = setup([ok([[1, 0, 0]])]);
    const error = await client.embed(model, ["a"]).catch((e) => e);
    expect(error.message).toMatch(/test\/a: модель вернула 3 чисел вместо 4/);
    expect(errorScope(error)).toBe("model");
    expect(sleeps).toEqual([]);
  });

  it("пауза из Retry-After — не больше минуты, дата тоже понимается", () => {
    expect(retryDelay("3", 1)).toBe(3000);
    expect(retryDelay("600", 1)).toBe(60_000);
    expect(retryDelay(null, 1)).toBe(1000);
    expect(retryDelay(null, 4)).toBe(8000);
    expect(retryDelay(null, 9)).toBe(8000);
    const soon = new Date(Date.now() + 5000).toUTCString();
    expect(retryDelay(soon, 1)).toBeGreaterThan(3000);
    expect(retryDelay(soon, 1)).toBeLessThanOrEqual(5000);
  });
});
