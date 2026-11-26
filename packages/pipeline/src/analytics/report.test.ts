import { DatabaseSync } from "node:sqlite";
import type { SiteEvent } from "@iconavo-ui/analytics";
import {
  type Arrival,
  type D1Like,
  eventStatements,
  hourOf,
  rejectStatements,
  rollup,
  schemaStatements,
} from "@iconavo-ui/analytics/db";
import { sqliteD1 } from "@iconavo-ui/analytics/sqlite";
import { describe, expect, it } from "vitest";
import { formatAnalytics, renderAnalyticsPage } from "./page.js";
import { dbReader, httpReader, ReaderError } from "./reader.js";
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

describe("чтение живой базы через API Cloudflare", () => {
  const options = {
    accountId: "a".repeat(32),
    databaseId: "57b4a761-665e-4fe1-9623-94f9f9936239",
    token: "secret-token",
    sleep: async () => {},
  };

  it("запрос с параметрами и ключом; строки — из result[0].results", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const reader = httpReader({
      ...options,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          success: true,
          errors: [],
          result: [{ success: true, results: [{ n: 3 }] }],
        });
      },
    });
    expect(await reader.all("SELECT ? AS n", [3])).toEqual([{ n: 3 }]);
    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/d1/database/57b4a761-665e-4fe1-9623-94f9f9936239/query`,
    );
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer secret-token",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      sql: "SELECT ? AS n",
      params: [3],
    });
  });

  it("ключ не принят — понятная причина, без ключа в тексте", async () => {
    const reader = httpReader({
      ...options,
      fetch: async () =>
        Response.json(
          {
            success: false,
            errors: [{ code: 10000, message: "Authentication error" }],
          },
          { status: 403 },
        ),
    });
    const error = await reader.all("SELECT 1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReaderError);
    expect((error as Error).message).toMatch(
      /ANALYTICS_READ_TOKEN не принят \(403\)/,
    );
    expect((error as Error).message).not.toContain("secret-token");
  });

  it("временный сбой — повтор; ошибка запроса — текст Cloudflare", async () => {
    let n = 0;
    const flaky = httpReader({
      ...options,
      fetch: async () =>
        ++n === 1
          ? new Response("busy", { status: 503 })
          : Response.json({ success: true, result: [{ results: [] }] }),
    });
    expect(await flaky.all("SELECT 1")).toEqual([]);
    expect(n).toBe(2);
    const broken = httpReader({
      ...options,
      fetch: async () =>
        Response.json(
          {
            success: false,
            errors: [{ code: 7500, message: "no such table: events" }],
          },
          { status: 400 },
        ),
    });
    await expect(broken.all("SELECT * FROM events")).rejects.toThrow(
      "Cloudflare ответил 400: no such table: events",
    );
  });
});
