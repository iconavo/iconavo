import { describe, expect, it } from "vitest";
import type { FetchFn } from "../sources/npm.js";
import { meiliClient } from "./client.js";

interface Reply {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
}

function fakeFetch(handler: (method: string, path: string) => Reply) {
  const calls: {
    method: string;
    path: string;
    auth: string;
    body?: unknown;
  }[] = [];
  const fn: FetchFn = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    const headers = init?.headers as Record<string, string>;
    calls.push({
      method,
      path,
      auth: headers.authorization ?? "",
      ...(init?.body === undefined
        ? {}
        : { body: JSON.parse(String(init.body)) }),
    });
    const r = handler(method, path);
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), {
      status: r.status,
      ...(r.headers ? { headers: r.headers } : {}),
    });
  };
  return { fn, calls };
}

const KEY = "secret-admin-key";

function client(handler: (method: string, path: string) => Reply) {
  const fetch = fakeFetch(handler);
  const sleeps: number[] = [];
  let clock = 0;
  const meili = meiliClient({
    url: "https://ms.example.com/",
    apiKey: KEY,
    fetch: fetch.fn,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    taskPollMs: 1000,
    taskTimeoutMs: 5000,
  });
  return { meili, calls: fetch.calls, sleeps };
}

describe("meiliClient", () => {
  it("индекс: 404 — нет индекса; ключ в заголовке Authorization", async () => {
    const { meili, calls } = client((_m, path) =>
      path === "/indexes/icons"
        ? { status: 404, json: { code: "index_not_found" } }
        : { status: 200, json: { uid: "other", primaryKey: "id" } },
    );
    expect(await meili.index("icons")).toBeUndefined();
    expect(await meili.index("other")).toEqual({
      uid: "other",
      primaryKey: "id",
    });
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/indexes/icons",
      auth: `Bearer ${KEY}`,
    });
  });

  it("документы — все страницы, только нужные поля", async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `d${from + i}`, hash: "h" }));
    const { meili, calls } = client((_m, path) => {
      const offset = Number(
        new URL(`https://x${path}`).searchParams.get("offset"),
      );
      return {
        status: 200,
        json: {
          results: offset === 0 ? page(1000, 0) : page(3, 1000),
          total: 1003,
        },
      };
    });
    const docs = await meili.documents("icons", ["id", "hash"]);
    expect(docs).toHaveLength(1003);
    expect(calls.map((c) => c.path)).toEqual([
      "/indexes/icons/documents?fields=id%2Chash&limit=1000&offset=0",
      "/indexes/icons/documents?fields=id%2Chash&limit=1000&offset=1000",
    ]);
  });

  it("запись документов — задача; ожидание до завершения", async () => {
    let polls = 0;
    const { meili, calls, sleeps } = client((method) => {
      if (method === "POST") return { status: 202, json: { taskUid: 7 } };
      polls++;
      return {
        status: 200,
        json: {
          uid: 7,
          type: "documentAdditionOrUpdate",
          status: polls < 3 ? "processing" : "succeeded",
        },
      };
    });
    const uid = await meili.addDocuments("icons", [{ id: "a" }]);
    expect(uid).toBe(7);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/indexes/icons/documents?primaryKey=id",
      body: [{ id: "a" }],
    });
    expect((await meili.waitTask(uid)).status).toBe("succeeded");
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("неудачная задача и долгая задача — ошибка", async () => {
    const failed = client(() => ({
      status: 200,
      json: {
        uid: 3,
        type: "settingsUpdate",
        status: "failed",
        error: { message: "Invalid ranking rule" },
      },
    }));
    await expect(failed.meili.waitTask(3)).rejects.toThrow(
      /задача 3 \(settingsUpdate\) не выполнена — Invalid ranking rule/,
    );
    const slow = client(() => ({
      status: 200,
      json: { uid: 4, type: "indexCreation", status: "enqueued" },
    }));
    await expect(slow.meili.waitTask(4)).rejects.toThrow(/не завершилась/);
  });

  it("ключ не подошёл — «СТОП» с подсказкой и без самого ключа", async () => {
    const { meili } = client(() => ({
      status: 401,
      json: { message: `bad key ${KEY}` },
    }));
    const error = await meili.settings("icons").catch((e: Error) => e);
    expect(String(error)).toMatch(/MEILISEARCH_ADMIN_KEY/);
    expect(String(error)).not.toContain(KEY);
  });

  it("временный отказ повторяется", async () => {
    let n = 0;
    const { meili } = client(() =>
      ++n === 1
        ? { status: 503, json: { message: "busy" } }
        : { status: 202, json: { taskUid: 1 } },
    );
    expect(await meili.deleteDocuments("icons", ["a"])).toBe(1);
    expect(n).toBe(2);
  });
});
