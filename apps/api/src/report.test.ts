import { DatabaseSync } from "node:sqlite";
import { REPORT_MAX_BODY_BYTES, REPORT_PATH } from "@iconavo-ui/analytics";
import type { D1Like } from "@iconavo-ui/d1";
import { sqliteD1 } from "@iconavo-ui/d1/sqlite";
import { describe, expect, it } from "vitest";
import worker from "./index.js";
import { handleReport, type ReportEnv, sameKey } from "./report.js";

const KEY = "k".repeat(43);
const URL_ = `https://api.iconavo.dev${REPORT_PATH}`;

async function seeded(): Promise<D1Like> {
  const db = sqliteD1(new DatabaseSync(":memory:"));
  await db.exec(
    "CREATE TABLE events (hour INTEGER, name TEXT); INSERT INTO events VALUES (1, 'page'), (2, 'query')",
  );
  return db;
}

function request(
  body: unknown,
  o: { key?: string; method?: string; raw?: string } = {},
): Request {
  const method = o.method ?? "POST";
  return new Request(URL_, {
    method,
    headers: {
      "content-type": "application/json",
      ...(o.key === undefined ? {} : { authorization: `Bearer ${o.key}` }),
    },
    ...(method === "POST" ? { body: o.raw ?? JSON.stringify(body) } : {}),
  });
}

async function send(
  req: Request,
  env: ReportEnv,
): Promise<{ status: number; json?: Record<string, unknown>; res: Response }> {
  const res = await handleReport(req, env);
  const text = await res.clone().text();
  return {
    status: res.status,
    res,
    ...(text === "" ? {} : { json: JSON.parse(text) }),
  };
}

const QUERY = { sql: "SELECT name FROM events WHERE hour >= ?", params: [2] };

describe("чтение базы для отчёта /analytics/query", () => {
  it("с ключом — строки запроса, без кэша", async () => {
    const r = await send(request(QUERY, { key: KEY }), {
      ANALYTICS: await seeded(),
      ANALYTICS_REPORT_KEY: KEY,
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ results: [{ name: "query" }] });
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(r.res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("без ключа у функции адреса нет — 404, даже с ключом в запросе", async () => {
    const r = await send(request(QUERY, { key: KEY }), {
      ANALYTICS: await seeded(),
    });
    expect(r.status).toBe(404);
    expect(r.json?.error).toBe("not_found");
  });

  it.each([
    ["без ключа", undefined],
    ["чужой ключ той же длины", "x".repeat(43)],
    ["ключ с лишним знаком", `${KEY}x`],
    ["пустой ключ", ""],
  ])("%s — 401", async (_, key) => {
    const r = await send(request(QUERY, key === undefined ? {} : { key }), {
      ANALYTICS: await seeded(),
      ANALYTICS_REPORT_KEY: KEY,
    });
    expect(r.status).toBe(401);
    expect(r.json?.error).toBe("unauthorized");
    expect(r.res.headers.get("www-authenticate")).toBe("Bearer");
    expect(r.res.headers.get("cache-control")).toBe("no-store");
  });

  it("не POST — 405", async () => {
    const r = await send(request(undefined, { method: "GET", key: KEY }), {
      ANALYTICS_REPORT_KEY: KEY,
    });
    expect(r.status).toBe(405);
    expect(r.res.headers.get("allow")).toBe("POST");
  });

  it("нет базы — 503", async () => {
    const r = await send(request(QUERY, { key: KEY }), {
      ANALYTICS_REPORT_KEY: KEY,
    });
    expect(r.status).toBe(503);
    expect(r.json?.error).toBe("analytics_unavailable");
  });

  it("тело больше предела — 413", async () => {
    const r = await send(
      request(undefined, {
        key: KEY,
        raw: JSON.stringify({
          sql: `SELECT '${"a".repeat(REPORT_MAX_BODY_BYTES)}'`,
        }),
      }),
      { ANALYTICS: await seeded(), ANALYTICS_REPORT_KEY: KEY },
    );
    expect(r.status).toBe(413);
  });

  it.each([
    ["не JSON", "{"],
    ["массив", "[]"],
    ["не SELECT", JSON.stringify({ sql: "DELETE FROM events" })],
    [
      "WITH перед DELETE",
      JSON.stringify({
        sql: "WITH x AS (SELECT 1) DELETE FROM events",
      }),
    ],
    [
      "второй запрос через ;",
      JSON.stringify({ sql: "SELECT 1; DELETE FROM events" }),
    ],
    [
      "параметр — объект",
      JSON.stringify({ sql: "SELECT ?", params: [{ a: 1 }] }),
    ],
    [
      "больше 100 параметров",
      JSON.stringify({ sql: "SELECT 1", params: Array(101).fill(1) }),
    ],
  ])("%s — 400, база не тронута", async (_, raw) => {
    const db = await seeded();
    const r = await send(request(undefined, { key: KEY, raw }), {
      ANALYTICS: db,
      ANALYTICS_REPORT_KEY: KEY,
    });
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe("invalid_query");
    expect(
      (await db.prepare("SELECT count(*) AS n FROM events").all()).results,
    ).toEqual([{ n: 2 }]);
  });

  it("запрос, который отклонила бы D1, — 400 с её ошибкой", async () => {
    const union = Array.from({ length: 6 }, (_, i) => `SELECT ${i}`).join(
      " UNION ALL ",
    );
    const r = await send(request({ sql: union }, { key: KEY }), {
      ANALYTICS: await seeded(),
      ANALYTICS_REPORT_KEY: KEY,
    });
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe("query_failed");
    expect(r.json?.message).toBe(
      "D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR",
    );
  });

  it("ключи сравниваются целиком", async () => {
    expect(await sameKey(KEY, KEY)).toBe(true);
    expect(await sameKey(KEY.slice(0, -1), KEY)).toBe(false);
    expect(await sameKey("", KEY)).toBe(false);
  });

  it("точка входа отдаёт адрес чтению, а не маршрутам API", async () => {
    const res = await worker.fetch(
      request(QUERY, { key: KEY }),
      {
        CDN: { get: async () => null },
        ANALYTICS: await seeded(),
        ANALYTICS_REPORT_KEY: KEY,
      },
      { waitUntil: () => {} },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ name: "query" }] });
  });
});
