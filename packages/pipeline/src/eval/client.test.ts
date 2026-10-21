import { describe, expect, it } from "vitest";
import { errorScope } from "../embed/client.js";
import { polzaChatClient } from "./client.js";

const KEY = "sk-test-secret-key";

type Reply = Response | Error;

/** Подменный fetch: ответы по очереди, тела запросов запоминаются. */
function setup(replies: Reply[]) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const sleeps: number[] = [];
  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    urls.push(String(input));
    bodies.push(JSON.parse(String(init?.body)));
    const next = replies.shift();
    if (next === undefined) throw new Error("тест: ответы кончились");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  let t = 0;
  const client = polzaChatClient({
    apiKey: KEY,
    baseUrl: "https://example.test/api/v1",
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => (t += 10),
  });
  return { client, bodies, urls, sleeps };
}

const answer = (content: unknown, usage: object = {}) =>
  Response.json({ choices: [{ message: { content } }], usage });

const BODY = {
  model: "test/judge",
  messages: [{ role: "user", content: "x" }],
  response_format: { type: "json_schema" },
  reasoning: { effort: "low" },
};

describe("чат Polza", () => {
  it("POST /chat/completions; текст, токены и рубли из ответа", async () => {
    const { client, urls, bodies } = setup([
      answer('{"verdicts":[]}', {
        prompt_tokens: 1200,
        completion_tokens: 80,
        cost_rub: 0.07,
      }),
    ]);
    const res = await client.complete(BODY);
    expect(urls).toEqual(["https://example.test/api/v1/chat/completions"]);
    expect(bodies[0]).toEqual(BODY);
    expect(res).toEqual({
      text: '{"verdicts":[]}',
      promptTokens: 1200,
      completionTokens: 80,
      rub: 0.07,
      ms: 10,
    });
  });

  it("ответ частями — текст склеивается", async () => {
    const { client } = setup([
      answer([
        { type: "text", text: '{"a":' },
        { type: "text", text: "1}" },
      ]),
    ]);
    expect((await client.complete(BODY)).text).toBe('{"a":1}');
  });

  it("сервер не принял поле — запрос уходит без усилия мышления, затем без схемы", async () => {
    const { client, bodies } = setup([
      new Response("bad field", { status: 400 }),
      new Response("bad field", { status: 422 }),
      answer("ok"),
    ]);
    expect((await client.complete(BODY)).text).toBe("ok");
    expect(bodies.map((b) => Object.keys(b).sort())).toEqual([
      ["messages", "model", "reasoning", "response_format"],
      ["messages", "model", "response_format"],
      ["messages", "model"],
    ]);
  });

  it("перегрузка — повтор с паузой из Retry-After", async () => {
    const { client, sleeps } = setup([
      new Response("busy", { status: 429, headers: { "retry-after": "3" } }),
      answer("ok"),
    ]);
    expect((await client.complete(BODY)).text).toBe("ok");
    expect(sleeps).toEqual([3000]);
  });

  it("лимит в минуту без Retry-After — паузы длиннее: 5, 15 с", async () => {
    const { client, sleeps } = setup([
      new Response("rpm", { status: 429 }),
      new Response("rpm", { status: 429 }),
      answer("ok"),
    ]);
    expect((await client.complete(BODY)).text).toBe("ok");
    expect(sleeps).toEqual([5000, 15000]);
  });

  it("сбой сети — те же долгие паузы", async () => {
    const down = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENOTFOUND" },
    });
    const { client, sleeps } = setup([down, answer("ok")]);
    expect((await client.complete(BODY)).text).toBe("ok");
    expect(sleeps).toEqual([5000]);
  });

  it("ключ не подошёл — остановка всего прогона, ключ в сообщение не попадает", async () => {
    const { client } = setup([
      new Response(`invalid key ${KEY}`, { status: 401 }),
    ]);
    const error = await client.complete(BODY).catch((e: Error) => e);
    expect(errorScope(error)).toBe("run");
    expect((error as Error).message).toContain("POLZA_API_KEY");
    expect((error as Error).message).not.toContain(KEY);
  });

  it("другой отказ — ошибка запроса без повторов", async () => {
    const { client, bodies } = setup([
      new Response("no model", { status: 404 }),
    ]);
    const error = await client.complete(BODY).catch((e: Error) => e);
    expect(errorScope(error)).toBe("model");
    expect((error as Error).message).toContain("HTTP 404");
    expect(bodies).toHaveLength(1);
  });
});
