import { DatabaseSync } from "node:sqlite";
import { batchBody, EVENT_ORIGIN, MAX_BODY_BYTES } from "@iconavo-ui/analytics";
import type { D1Like } from "@iconavo-ui/analytics/db";
import { sqliteD1 } from "@iconavo-ui/analytics/sqlite";
import { describe, expect, it, vi } from "vitest";
import type { RateLimiter } from "./env.js";
import { countryOf, handleEvent } from "./event.js";
import worker from "./index.js";

/** 26 ноября 2026, 12:34:56 UTC. */
const NOW = Date.UTC(2026, 10, 26, 12, 34, 56);
const URL_ = "https://api.iconavo.dev/event";
const PAGE = { name: "page", section: "home" } as const;

const fresh = (): D1Like => sqliteD1(new DatabaseSync(":memory:"));

interface Sent {
  body?: string;
  origin?: string | null;
  method?: string;
  headers?: Record<string, string>;
  cf?: Record<string, unknown>;
}

function request(o: Sent = {}): Request {
  const headers = new Headers(o.headers);
  if (o.origin !== null) headers.set("origin", o.origin ?? EVENT_ORIGIN);
  headers.set("content-type", "text/plain;charset=UTF-8");
  const method = o.method ?? "POST";
  const r = new Request(URL_, {
    method,
    headers,
    ...(method === "POST" ? { body: o.body ?? batchBody("en", [PAGE]) } : {}),
  });
  if (o.cf !== undefined) Object.assign(r, { cf: o.cf });
  return r;
}

const rows = async (db: D1Like, sql: string) =>
  (await db.prepare(sql).all()).results;

async function send(
  o: Sent = {},
  env: {
    ANALYTICS?: D1Like;
    EVENT_LIMIT?: RateLimiter;
    EVENT_ORIGINS?: string;
  } = {
    ANALYTICS: fresh(),
  },
  log: string[] = [],
) {
  const res = await handleEvent(request(o), env, {
    now: () => NOW,
    log: (line) => log.push(line),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    json: text === "" ? undefined : (JSON.parse(text) as { error: string }),
  };
}

describe("приём событий /event", () => {
  it("пачка со страницы iconavo.dev — 204 после записи: час, страна кодом, язык, поля", async () => {
    const db = fresh();
    const res = await send(
      {
        body: batchBody("ru", [
          PAGE,
          {
            name: "query",
            q: "Ёлка",
            results: 3,
            semantic: true,
            pages: 1,
            first: true,
            copied: false,
            downloaded: false,
          },
        ]),
        cf: { country: "EE", city: "Tallinn", region: "Harjumaa" },
        headers: { "cf-connecting-ip": "203.0.113.7" },
      },
      { ANALYTICS: db },
    );
    expect(res.status).toBe(204);
    expect(res.json).toBeUndefined();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await rows(db, "SELECT * FROM events")).toEqual([
      {
        hour: Math.floor(NOW / 3_600_000),
        name: "page",
        lang: "ru",
        country: "EE",
        test: 0,
        data: '{"section":"home"}',
      },
      {
        hour: Math.floor(NOW / 3_600_000),
        name: "query",
        lang: "ru",
        country: "EE",
        test: 0,
        data: '{"q":"елка","results":3,"semantic":true,"pages":1,"first":true,"copied":false,"downloaded":false}',
      },
    ]);
    // Ни IP, ни города, ни точного времени — нигде в базе.
    const dump = JSON.stringify(
      await rows(
        db,
        "SELECT * FROM events UNION ALL SELECT day, reason, test, count, 0, 0 FROM rejects",
      ),
    );
    expect(dump).not.toMatch(/203\.0\.113|Tallinn|Harjumaa|34:56/);
  });

  it("часть событий не по списку — верные записаны, неверные посчитаны", async () => {
    const db = fresh();
    const res = await send(
      {
        body: batchBody("en", [
          PAGE,
          { name: "page", section: "/secret/path" } as never,
          { name: "nope" } as never,
        ]),
      },
      { ANALYTICS: db },
    );
    expect(res.status).toBe(204);
    expect(await rows(db, "SELECT name FROM events")).toEqual([
      { name: "page" },
    ]);
    expect(
      await rows(
        db,
        "SELECT day, reason, test, count FROM rejects ORDER BY reason",
      ),
    ).toEqual([
      { day: "2026-11-26", reason: "event:name", test: 0, count: 1 },
      { day: "2026-11-26", reason: "event:page:section", test: 0, count: 1 },
    ]);
  });

  it("ни одного события по списку — 400, отказ посчитан", async () => {
    const db = fresh();
    const res = await send(
      { body: batchBody("en", [{ name: "nope" } as never]) },
      { ANALYTICS: db },
    );
    expect(res.status).toBe(400);
    expect(res.json?.error).toBe("invalid_events");
    expect(await rows(db, "SELECT count(*) AS n FROM events")).toEqual([
      { n: 0 },
    ]);
    expect(await rows(db, "SELECT reason, count FROM rejects")).toEqual([
      { reason: "event:name", count: 1 },
    ]);
  });

  it.each([
    [
      "чужая страница",
      { origin: "https://example.com" },
      403,
      "forbidden_origin",
      "origin",
    ],
    ["без Origin", { origin: null }, 403, "forbidden_origin", "origin"],
    [
      "превью — не iconavo.dev",
      { origin: "http://127.0.0.1:4284" },
      403,
      "forbidden_origin",
      "origin",
    ],
    ["не JSON", { body: "{oops" }, 400, "invalid_events", "json"],
    [
      "не пачка",
      { body: '{"v":1,"lang":"en"}' },
      400,
      "invalid_events",
      "shape",
    ],
    [
      "длиннее 16 КБ",
      { body: `"${"a".repeat(MAX_BODY_BYTES)}"` },
      413,
      "too_large",
      "size",
    ],
  ] as const)(
    "%s — отказ %i (%s), причина «%s» в счётчике",
    async (_, sent, status, error, reason) => {
      const db = fresh();
      const res = await send(sent, { ANALYTICS: db });
      expect(res.status).toBe(status);
      expect(res.json?.error).toBe(error);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await rows(db, "SELECT reason, test, count FROM rejects")).toEqual(
        [{ reason, test: 0, count: 1 }],
      );
      expect(await rows(db, "SELECT count(*) AS n FROM events")).toEqual([
        { n: 0 },
      ]);
    },
  );

  it("превью задаёт свои страницы", async () => {
    const res = await send(
      { origin: "http://127.0.0.1:4284" },
      { ANALYTICS: fresh(), EVENT_ORIGINS: "http://127.0.0.1:4284" },
    );
    expect(res.status).toBe(204);
  });

  it("проверочная пачка помечена — и события, и отказы", async () => {
    const db = fresh();
    await send({ headers: { "x-iconavo-test": "1" } }, { ANALYTICS: db });
    await send(
      { headers: { "x-iconavo-test": "1" }, origin: "https://example.com" },
      { ANALYTICS: db },
    );
    expect(await rows(db, "SELECT name, test FROM events")).toEqual([
      { name: "page", test: 1 },
    ]);
    expect(await rows(db, "SELECT reason, test FROM rejects")).toEqual([
      { reason: "origin", test: 1 },
    ]);
  });

  it("не POST — 405 с Allow: POST, в базу ничего", async () => {
    const db = fresh();
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT"]) {
      const res = await send({ method }, { ANALYTICS: db });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
    expect(await rows(db, "SELECT name FROM sqlite_master")).toEqual([]);
  });

  it("лимит частоты — по адресу, до всего остального; отказы по нему в базу не пишутся", async () => {
    const db = fresh();
    const keys: string[] = [];
    const limiter: RateLimiter = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: false };
      },
    };
    const res = await send(
      {
        headers: { "cf-connecting-ip": "203.0.113.7" },
        origin: "https://example.com",
      },
      { ANALYTICS: db, EVENT_LIMIT: limiter },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(keys).toEqual(["203.0.113.7"]);
    expect(await rows(db, "SELECT name FROM sqlite_master")).toEqual([]);
  });

  it("лимит не ответил — пачка всё равно принимается", async () => {
    const log: string[] = [];
    const res = await send(
      {},
      {
        ANALYTICS: fresh(),
        EVENT_LIMIT: {
          limit: async () => {
            throw new Error("down");
          },
        },
      },
      log,
    );
    expect(res.status).toBe(204);
    expect(log).toEqual(["аналитика: лимит частоты не ответил: down"]);
  });

  it("нет базы — 503; база упала — 503 и строка журнала без содержимого событий", async () => {
    expect((await send({}, {})).status).toBe(503);
    const log: string[] = [];
    const broken: D1Like = {
      prepare: fresh().prepare,
      batch: async () => {
        throw new Error("D1_ERROR: database is locked");
      },
    };
    const res = await send(
      { body: batchBody("en", [{ ...PAGE }]) },
      { ANALYTICS: broken },
      log,
    );
    expect(res.status).toBe(503);
    expect(res.json?.error).toBe("analytics_unavailable");
    expect(log).toEqual([
      "аналитика: запись в базу не удалась: D1_ERROR: database is locked",
    ]);
  });

  it("таблицы пропали — следующая пачка создаёт их заново", async () => {
    const db = fresh();
    expect((await send({}, { ANALYTICS: db })).status).toBe(204);
    await db.batch([db.prepare("DROP TABLE events")]);
    expect((await send({}, { ANALYTICS: db })).status).toBe(503);
    expect((await send({}, { ANALYTICS: db })).status).toBe(204);
    expect(await rows(db, "SELECT count(*) AS n FROM events")).toEqual([
      { n: 1 },
    ]);
  });

  it.each([
    [{ country: "EE" }, "EE"],
    [{ country: "T1" }, "T1"],
    [{ country: "XX" }, null],
    [{ country: "Estonia" }, null],
    [{ country: 7 }, null],
    [{}, null],
    [undefined, null],
  ])("страна %j → %s", (cf, country) => {
    expect(countryOf(request(cf === undefined ? {} : { cf }))).toBe(country);
  });
});

describe("точка входа функции", () => {
  it("/event обрабатывает приём, а не маршруты API", async () => {
    const db = fresh();
    const res = await worker.fetch(
      request(),
      { CDN: { get: async () => null }, ANALYTICS: db },
      { waitUntil: () => {} },
    );
    expect(res.status).toBe(204);
    expect(await rows(db, "SELECT name FROM events")).toEqual([
      { name: "page" },
    ]);
  });

  it("расписание считает итоги и убирает старое; без базы — ничего", async () => {
    const db = fresh();
    await worker.scheduled(
      {},
      { CDN: { get: async () => null }, ANALYTICS: db },
    );
    expect(
      await rows(
        db,
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ),
    ).toEqual([{ name: "days" }, { name: "events" }, { name: "rejects" }]);
    await expect(
      worker.scheduled({}, { CDN: { get: async () => null } }),
    ).resolves.toBeUndefined();
  });

  it("сбой расписания — строка журнала и ошибка запуска", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: D1Like = {
      prepare: fresh().prepare,
      batch: async () => {
        throw new Error("D1_ERROR: overloaded");
      },
    };
    await expect(
      worker.scheduled(
        {},
        { CDN: { get: async () => null }, ANALYTICS: broken },
      ),
    ).rejects.toThrow("overloaded");
    expect(errors.mock.calls).toEqual([
      ["аналитика: итоги дня не посчитаны: D1_ERROR: overloaded"],
    ]);
    errors.mockRestore();
  });
});
