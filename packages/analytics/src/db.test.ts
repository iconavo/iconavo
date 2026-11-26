import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  type Arrival,
  type D1Like,
  dayOfHour,
  eventStatements,
  hourOf,
  RETENTION_DAYS,
  rejectStatements,
  rollup,
  schemaStatements,
} from "./db.js";
import type { SiteEvent } from "./events.js";
import { sqliteD1 } from "./sqlite.js";

const DAY_MS = 86_400_000;
/** 26 ноября 2026, 12:34:56 UTC. */
const NOW = Date.UTC(2026, 10, 26, 12, 34, 56);

async function fresh(): Promise<D1Like> {
  const db = sqliteD1(new DatabaseSync(":memory:"));
  await db.batch(schemaStatements(db));
  return db;
}

const arrival = (ms: number, over: Partial<Arrival> = {}): Arrival => ({
  hour: hourOf(ms),
  lang: "en",
  country: "DE",
  test: false,
  ...over,
});

async function put(
  db: D1Like,
  ms: number,
  events: SiteEvent[],
  over: Partial<Arrival> = {},
) {
  await db.batch(eventStatements(db, arrival(ms, over), events));
}

const rows = async (db: D1Like, sql: string) =>
  (await db.prepare(sql).all()).results;

const query = (over: Partial<SiteEvent & { name: "query" }> = {}) =>
  ({
    name: "query",
    q: "house",
    results: 10,
    semantic: true,
    pages: 1,
    first: true,
    copied: false,
    downloaded: false,
    ...over,
  }) as SiteEvent;

describe("запись событий", () => {
  it("час — не точнее часа, страна — код, поля — JSON без имени", async () => {
    const db = await fresh();
    await put(db, NOW, [{ name: "page", section: "home" }]);
    expect(await rows(db, "SELECT * FROM events")).toEqual([
      {
        hour: hourOf(NOW),
        name: "page",
        lang: "en",
        country: "DE",
        test: 0,
        data: '{"section":"home"}',
      },
    ]);
    expect(dayOfHour(hourOf(NOW))).toBe("2026-11-26");
    expect(hourOf(NOW) * 3_600_000).toBe(Date.UTC(2026, 10, 26, 12));
  });

  it("отказы — счётчики дня по причинам, проверочные отдельно", async () => {
    const db = await fresh();
    const day = "2026-11-26";
    await db.batch(
      rejectStatements(db, day, ["origin", "json", "origin"], false),
    );
    await db.batch(rejectStatements(db, day, ["origin"], false));
    await db.batch(rejectStatements(db, day, ["origin"], true));
    expect(
      await rows(db, "SELECT * FROM rejects ORDER BY reason, test"),
    ).toEqual([
      { day, reason: "json", test: 0, count: 1 },
      { day, reason: "origin", test: 0, count: 3 },
      { day, reason: "origin", test: 1, count: 1 },
    ]);
  });

  it("таблицы можно создавать повторно", async () => {
    const db = await fresh();
    await put(db, NOW, [{ name: "page", section: "home" }]);
    await db.batch(schemaStatements(db));
    expect(await rows(db, "SELECT count(*) AS n FROM events")).toEqual([
      { n: 1 },
    ]);
  });

  it("пачка — одна транзакция: сбой одного запроса откатывает все", async () => {
    const db = await fresh();
    await expect(
      db.batch([
        ...eventStatements(db, arrival(NOW), [
          { name: "page", section: "home" },
        ]),
        db.prepare("INSERT INTO nowhere VALUES (1)"),
      ]),
    ).rejects.toThrow(/nowhere/);
    expect(await rows(db, "SELECT count(*) AS n FROM events")).toEqual([
      { n: 0 },
    ]);
  });
});

describe("итоги дня и уборка", () => {
  const yesterday = NOW - DAY_MS;

  it("итоги вчерашнего дня — только числа, без текстов запросов и проверочных событий", async () => {
    const db = await fresh();
    await put(db, yesterday, [
      { name: "page", section: "search" },
      { name: "page", section: "search" },
      query({ position: 1, copied: true }),
      query({ q: "secret text", first: false, results: 0, semantic: false }),
      query({ q: "xyz", first: false, position: 14 }),
      { name: "success", queries: 1, seconds: 20 },
      { name: "copy", what: "svg", icon: "lucide:house", entry: 25 },
      { name: "download", format: "png", icon: "lucide:house", size: 48 },
      { name: "open", from: "search", icon: "lucide:house" },
      { name: "style", style: "filled", where: "filter" },
    ]);
    await put(db, yesterday, [{ name: "page", section: "home" }], {
      lang: "ru",
      country: null,
    });
    await put(db, yesterday, [{ name: "page", section: "docs" }], {
      test: true,
    });
    await put(db, NOW, [{ name: "page", section: "home" }]);

    const result = await rollup(db, NOW);
    expect(result.days).toHaveLength(RETENTION_DAYS);
    expect(result.days.at(-1)).toBe("2026-11-25");
    expect(result.deleted).toBe(0);

    const days = await rows(
      db,
      "SELECT lang, country, metric, key, value FROM days WHERE day = '2026-11-25' ORDER BY lang, metric, key",
    );
    expect(days).toEqual([
      { lang: "en", country: "DE", metric: "copy", key: "svg", value: 1 },
      { lang: "en", country: "DE", metric: "download", key: "png", value: 1 },
      { lang: "en", country: "DE", metric: "entry", key: "0-30", value: 1 },
      {
        lang: "en",
        country: "DE",
        metric: "icon",
        key: "lucide:house",
        value: 2,
      },
      { lang: "en", country: "DE", metric: "noclick", key: "", value: 1 },
      { lang: "en", country: "DE", metric: "noresults", key: "", value: 1 },
      { lang: "en", country: "DE", metric: "open", key: "search", value: 1 },
      { lang: "en", country: "DE", metric: "page", key: "search", value: 2 },
      { lang: "en", country: "DE", metric: "position", key: "1", value: 1 },
      {
        lang: "en",
        country: "DE",
        metric: "position",
        key: "11-20",
        value: 1,
      },
      { lang: "en", country: "DE", metric: "query", key: "", value: 3 },
      { lang: "en", country: "DE", metric: "semantic", key: "", value: 2 },
      { lang: "en", country: "DE", metric: "session", key: "", value: 1 },
      {
        lang: "en",
        country: "DE",
        metric: "style",
        key: "filter:filled",
        value: 1,
      },
      { lang: "en", country: "DE", metric: "success", key: "", value: 1 },
      { lang: "ru", country: "", metric: "page", key: "home", value: 1 },
    ]);
    // Сегодняшний день не закончен — его итогов нет; тексты запросов в итоги не попадают.
    expect(
      await rows(db, "SELECT count(*) AS n FROM days WHERE day = '2026-11-26'"),
    ).toEqual([{ n: 0 }]);
    expect(
      await rows(
        db,
        "SELECT count(*) AS n FROM days WHERE key LIKE '%secret%' OR key LIKE '%xyz%'",
      ),
    ).toEqual([{ n: 0 }]);
  });

  it("повторный подсчёт даёт те же итоги", async () => {
    const db = await fresh();
    await put(db, yesterday, [{ name: "page", section: "home" }]);
    await rollup(db, NOW);
    await rollup(db, NOW);
    expect(await rows(db, "SELECT day, metric, key, value FROM days")).toEqual([
      { day: "2026-11-25", metric: "page", key: "home", value: 1 },
    ]);
  });

  it("события старше 30 дней удаляются целыми днями, итоги их дней остаются", async () => {
    const db = await fresh();
    const kept = NOW - RETENTION_DAYS * DAY_MS; // 27 октября — ещё хранится
    const gone = kept - DAY_MS; // 26 октября — удаляется
    const startOfKept = Date.UTC(2026, 9, 27, 0, 0, 0);
    const endOfGone = startOfKept - 1;
    await put(db, gone, [{ name: "page", section: "home" }]);
    await put(db, endOfGone, [{ name: "page", section: "home" }]);
    await put(db, startOfKept, [{ name: "page", section: "set" }]);
    await put(db, kept, [{ name: "page", section: "set" }]);

    // Вчера по расписанию: оба дня ещё хранились и посчитаны.
    await rollup(db, NOW - DAY_MS);
    // Сегодня: 26 октября вышел за 30 дней — его события удалены, итоги остались.
    const today = await rollup(db, NOW);
    expect(today.deleted).toBe(2);
    expect(today.days[0]).toBe("2026-10-27");
    expect(
      await rows(
        db,
        "SELECT DISTINCT json_extract(data, '$.section') AS s FROM events",
      ),
    ).toEqual([{ s: "set" }]);
    expect(
      await rows(db, "SELECT day, key, value FROM days ORDER BY day"),
    ).toEqual([
      { day: "2026-10-26", key: "home", value: 2 },
      { day: "2026-10-27", key: "set", value: 2 },
    ]);
  });

  it("на пустой базе создаёт таблицы сама", async () => {
    const db = sqliteD1(new DatabaseSync(":memory:"));
    await expect(rollup(db, NOW)).resolves.toMatchObject({ deleted: 0 });
  });
});
