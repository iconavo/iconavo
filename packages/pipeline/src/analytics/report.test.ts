import { DatabaseSync } from "node:sqlite";
import type { SiteEvent } from "@iconavo-ui/analytics";
import {
  type Arrival,
  eventStatements,
  hourOf,
  rejectStatements,
  rollup,
  schemaStatements,
} from "@iconavo-ui/analytics/db";
import type { D1Like } from "@iconavo-ui/d1";
import { sqliteD1 } from "@iconavo-ui/d1/sqlite";
import { describe, expect, it } from "vitest";
import worker from "../../../../apps/api/src/index.js";
import { formatAnalytics, renderAnalyticsPage } from "./page.js";
import { apiReader, dbReader, ReaderError } from "./reader.js";
import { buildReport, median, successRate } from "./report.js";

const DAY_MS = 86_400_000;
/** Четверг 26 ноября 2026, 12:00 UTC: неделя с понедельника 23 ноября. */
const NOW = Date.UTC(2026, 10, 26, 12);

const query = (over: Record<string, unknown>): SiteEvent =>
  ({
    name: "query",
    q: "house",
    results: 10,
    semantic: true,
    pages: 1,
    first: false,
    copied: false,
    downloaded: false,
    ...over,
  }) as SiteEvent;

async function seeded(): Promise<D1Like> {
  const db = sqliteD1(new DatabaseSync(":memory:"));
  await db.batch(schemaStatements(db));
  const put = (ms: number, events: SiteEvent[], over: Partial<Arrival> = {}) =>
    db.batch(
      eventStatements(
        db,
        { hour: hourOf(ms), lang: "en", country: "EE", test: false, ...over },
        events,
      ),
    );
  // Сегодня, en: сессия с успехом, два запроса без результатов, один без кликов.
  await put(NOW, [
    { name: "page", section: "search" },
    query({ first: true, position: 1, copied: true }),
    { name: "open", from: "search", icon: "lucide:house" },
    { name: "success", queries: 1, seconds: 12 },
    { name: "copy", what: "svg", icon: "lucide:house", entry: 30 },
    query({ q: "zzzz", results: 0 }),
    query({ q: "zzzz", results: 0 }),
    query({ q: "cat" }),
    { name: "style", style: "filled", where: "filter" },
  ]);
  // ru без страны: сессия без успеха.
  await put(
    NOW,
    [{ name: "page", section: "home" }, query({ q: "дом", first: true })],
    {
      lang: "ru",
      country: null,
    },
  );
  // Проверочная пачка — не в счёт.
  await put(NOW, [{ name: "page", section: "other" }], { test: true });
  await db.batch([
    ...rejectStatements(db, "2026-11-26", ["origin"], true),
    ...rejectStatements(
      db,
      "2026-11-26",
      ["event:page:section", "event:page:section", "event:page:section"],
      false,
    ),
  ]);
  // 40 дней назад: сырые события уже удалены, итоги дня остались.
  const old = NOW - 40 * DAY_MS;
  await put(old, [
    query({ q: "old", first: true }),
    { name: "success", queries: 1, seconds: 5 },
  ]);
  await rollup(db, old + DAY_MS);
  await rollup(db, NOW);
  return db;
}

describe("отчёт аналитики", () => {
  it("успех поиска по неделям: свежие — из сырых событий, старые — из итогов дня", async () => {
    const r = await buildReport(dbReader(await seeded()), NOW, 8);
    expect(r.from).toBe("2026-10-05");
    expect(r.to).toBe("2026-11-26");
    expect(r.rawFrom).toBe("2026-10-27");
    expect(r.weeksTable).toEqual([
      {
        week: "2026-11-23",
        lang: "en",
        sessions: 1,
        successes: 1,
        queries: 4,
        noresults: 2,
        noclick: 3,
        views: 1,
      },
      {
        week: "2026-11-23",
        lang: "ru",
        sessions: 1,
        successes: 0,
        queries: 1,
        noresults: 0,
        noclick: 1,
        views: 1,
      },
      {
        week: "2026-10-12",
        lang: "en",
        sessions: 1,
        successes: 1,
        queries: 1,
        noresults: 0,
        noclick: 1,
        views: 0,
      },
    ]);
    // Четыре недели — только сырые события: старой недели нет.
    const short = await buildReport(dbReader(await seeded()), NOW);
    expect(short.weeksTable.map((w) => w.week)).toEqual([
      "2026-11-23",
      "2026-11-23",
    ]);
  });

  it("неудачные запросы с повторами, места, форматы, наборы, страны, отказы и проверочные пачки", async () => {
    const r = await buildReport(dbReader(await seeded()), NOW);
    expect(r.noResults).toEqual([{ q: "zzzz", lang: "en", count: 2 }]);
    expect(r.noClicks).toEqual([
      { q: "cat", lang: "en", count: 1 },
      { q: "дом", lang: "ru", count: 1 },
    ]);
    expect(r.positions).toEqual([
      { key: "1", count: 1 },
      { key: "2-5", count: 0 },
      { key: "6-10", count: 0 },
      { key: "11-20", count: 0 },
      { key: "21+", count: 0 },
    ]);
    expect(r.copies).toEqual([{ key: "svg", count: 1 }]);
    expect(r.sets).toEqual([{ key: "lucide", count: 1 }]);
    expect(r.icons).toEqual([{ key: "lucide:house", count: 1 }]);
    expect(r.opens).toEqual([{ key: "search", count: 1 }]);
    expect(r.styles).toEqual([{ key: "filter:filled", count: 1 }]);
    expect(r.sections).toEqual([
      { key: "home", count: 1 },
      { key: "search", count: 1 },
    ]);
    expect(r.firstIcon).toEqual({ median: 30, count: 1 });
    expect(r.countries).toEqual([
      { country: "", views: 1, sessions: 1, successes: 0 },
      { country: "EE", views: 1, sessions: 1, successes: 1 },
    ]);
    expect(r.rejects).toEqual([{ key: "event:page:section", count: 3 }]);
    expect(r.tests).toEqual({ events: 1, rejects: 1 });
    expect(r.total).toBe(11);
  });

  it("страница и терминал: успех, неудачные запросы — с экранированием", async () => {
    const db = await seeded();
    await db.batch(
      eventStatements(
        db,
        { hour: hourOf(NOW), lang: "en", country: "EE", test: false },
        [query({ q: "<script>", results: 0 })],
      ),
    );
    const r = await buildReport(dbReader(db), NOW);
    const html = renderAnalyticsPage(r);
    expect(html).toContain("<h2>Успех поиска</h2>");
    expect(html).toContain("<b>100%</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    const lines = formatAnalytics(r);
    expect(lines.join("\n")).toMatch(/2026-11-23\s+en\s+1\s+1\s+100%/);
  });

  it("медиана и доля успехов", () => {
    expect(median([])).toBeUndefined();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(successRate(0, 0)).toBe("—");
    expect(successRate(1, 3)).toBe("33%");
  });
});

describe("чтение живой базы через edge API", () => {
  const options = { key: "secret-key", sleep: async () => {} };

  it("запрос с параметрами и ключом на /analytics/query; строки — из results", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const reader = apiReader({
      ...options,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ results: [{ n: 3 }] });
      },
    });
    expect(await reader.all("SELECT ? AS n", [3])).toEqual([{ n: 3 }]);
    expect(calls[0]?.url).toBe("https://api.iconavo.dev/analytics/query");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer secret-key",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      sql: "SELECT ? AS n",
      params: [3],
    });
    const preview = apiReader({
      ...options,
      base: "http://127.0.0.1:4281",
      fetch: async (url) => {
        calls.push({ url: String(url) });
        return Response.json({ results: [] });
      },
    });
    await preview.all("SELECT 1");
    expect(calls[1]?.url).toBe("http://127.0.0.1:4281/analytics/query");
  });

  it.each([
    [401, /ANALYTICS_REPORT_KEY не принят \(401\)/],
    [404, /нет ключа отчёта \(404\)/],
  ])(
    "ответ %i — понятная причина, без ключа в тексте",
    async (status, text) => {
      const reader = apiReader({
        ...options,
        fetch: async () =>
          Response.json({ status, error: "unauthorized" }, { status }),
      });
      const error = await reader.all("SELECT 1").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ReaderError);
      expect((error as Error).message).toMatch(text);
      expect((error as Error).message).not.toContain("secret-key");
    },
  );

  it("временный сбой — повтор; ошибка запроса — текст функции", async () => {
    let n = 0;
    const flaky = apiReader({
      ...options,
      fetch: async () =>
        ++n === 1
          ? new Response("busy", { status: 503 })
          : Response.json({ results: [] }),
    });
    expect(await flaky.all("SELECT 1")).toEqual([]);
    expect(n).toBe(2);
    const broken = apiReader({
      ...options,
      fetch: async () =>
        Response.json(
          {
            status: 400,
            error: "query_failed",
            message: "D1_ERROR: no such table: events: SQLITE_ERROR",
          },
          { status: 400 },
        ),
    });
    await expect(broken.all("SELECT * FROM events")).rejects.toThrow(
      "запрос отчёта отклонён (400): D1_ERROR: no such table: events: SQLITE_ERROR",
    );
  });

  it("отчёт на настоящей функции edge API: те же строки, что из базы напрямую", async () => {
    const db = await seeded();
    const key = "k".repeat(43);
    const env = {
      CDN: { get: async () => null },
      ANALYTICS: db,
      ANALYTICS_REPORT_KEY: key,
    };
    const reader = apiReader({
      key,
      fetch: async (url, init) =>
        worker.fetch(new Request(String(url), init), env, {
          waitUntil: () => {},
        }),
    });
    expect(await buildReport(reader, NOW, 8)).toEqual(
      await buildReport(dbReader(db), NOW, 8),
    );
  });
});
