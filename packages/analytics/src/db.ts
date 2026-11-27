// База аналитики D1 `iconavo-analytics` (шаг 2 фазы 5, ADR-0043): таблицы, запись событий и отказов,
// итоги дня и уборка старше 30 дней (ADR-0028). SQL один на D1 (приём и расписание функции edge API,
// отчёт через HTTP API Cloudflare) и на node:sqlite (тесты и превью): оба — SQLite.
//
// - events — сырые события: час (не точнее, решение владельца 26 ноября 2026), имя, язык сайта, код
//   страны или NULL, пометка проверочной пачки и поля события JSON. Хранятся 30 дней.
// - days — итоги дня: только числа по разделам, форматам, наборам, иконкам и странам, текстов
//   запросов нет. Хранятся без срока.
// - rejects — отклонённые события и пачки по дням и причинам.

import type { Lang, SiteEvent } from "./events.js";

/** Значение параметра запроса: так же у D1 и node:sqlite. */
export type SqlValue = string | number | null;

/** Подготовленный запрос — часть D1PreparedStatement. */
export interface D1Statement {
  bind(...values: SqlValue[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

/** Привязка базы — часть D1Database: пачка запросов идёт одной транзакцией. */
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

/**
 * Пределы D1 строже, чем у SQLite по умолчанию (замер на живой базе 27 ноября 2026, ADR-0043): в
 * составной выборке — не больше 5 частей UNION, INTERSECT или EXCEPT, в запросе — не больше 100
 * параметров. node:sqlite их не задаёт, поэтому база тестов и превью (`sqlite.ts`) повторяет их сама.
 */
export const D1_MAX_COMPOUND_TERMS = 5;
export const D1_MAX_PARAMS = 100;

/** Сырые события старше стольких дней удаляются (ADR-0028). */
export const RETENTION_DAYS = 30;

const HOUR_MS = 3_600_000;
const DAY_HOURS = 24;

/** Час события — часы с 1970 года по UTC: время точнее часа не хранится. */
export const hourOf = (ms: number): number => Math.floor(ms / HOUR_MS);

/** День UTC часа: «2026-11-26». */
export const dayOfHour = (hour: number): string =>
  new Date(hour * HOUR_MS).toISOString().slice(0, 10);

/** Таблицы и индекс; запросы безопасно повторять — функция создаёт их сама при первом обращении. */
export const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS events (
  hour INTEGER NOT NULL,
  name TEXT NOT NULL,
  lang TEXT NOT NULL,
  country TEXT,
  test INTEGER NOT NULL,
  data TEXT NOT NULL
)`,
  "CREATE INDEX IF NOT EXISTS events_hour ON events (hour)",
  `CREATE TABLE IF NOT EXISTS days (
  day TEXT NOT NULL,
  lang TEXT NOT NULL,
  country TEXT NOT NULL,
  metric TEXT NOT NULL,
  key TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (day, lang, country, metric, key)
)`,
  `CREATE TABLE IF NOT EXISTS rejects (
  day TEXT NOT NULL,
  reason TEXT NOT NULL,
  test INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, reason, test)
)`,
];

export const schemaStatements = (db: D1Like): D1Statement[] =>
  SCHEMA.map((sql) => db.prepare(sql));

/** Что приём знает о пачке: час прихода, язык сайта, страна, проверочная ли она. */
export interface Arrival {
  hour: number;
  lang: Lang;
  /** Двухбуквенный код страны по Cloudflare; нет — null. */
  country: string | null;
  test: boolean;
}

const INSERT_EVENT =
  "INSERT INTO events (hour, name, lang, country, test, data) VALUES (?, ?, ?, ?, ?, ?)";

/** Запись событий пачки: имя — своей колонкой, остальные поля — JSON. */
export function eventStatements(
  db: D1Like,
  arrival: Arrival,
  events: readonly SiteEvent[],
): D1Statement[] {
  const insert = db.prepare(INSERT_EVENT);
  return events.map(({ name, ...fields }) =>
    insert.bind(
      arrival.hour,
      name,
      arrival.lang,
      arrival.country,
      arrival.test ? 1 : 0,
      JSON.stringify(fields),
    ),
  );
}

const UPSERT_REJECT =
  "INSERT INTO rejects (day, reason, test, count) VALUES (?, ?, ?, ?) ON CONFLICT (day, reason, test) DO UPDATE SET count = count + excluded.count";

/** Отказы — счётчики дня по причинам: одна запись на причину. */
export function rejectStatements(
  db: D1Like,
  day: string,
  reasons: readonly string[],
  test: boolean,
): D1Statement[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const upsert = db.prepare(UPSERT_REJECT);
  return [...counts].map(([reason, count]) =>
    upsert.bind(day, reason, test ? 1 : 0, count),
  );
}

/**
 * Части итогов дня — выборки из сырых событий `e`, без проверочных: просмотры по разделам; запросы,
 * поисковые сессии (запрос с пометкой «первый»), успехи, запросы без результатов и без открытой
 * иконки, с выдачей по смыслу; место первой открытой иконки; что скопировано и скачано; откуда
 * открыта иконка; переключения стиля; иконки копирований и скачиваний; время до первой иконки.
 * Имена колонок — у каждой части: части делятся между запросами где угодно.
 */
const ROLLUP_TERMS: readonly string[] = [
  "SELECT day, lang, country, 'page' AS metric, json_extract(data, '$.section') AS key FROM e WHERE name = 'page'",
  "SELECT day, lang, country, 'query' AS metric, '' AS key FROM e WHERE name = 'query'",
  "SELECT day, lang, country, 'session' AS metric, '' AS key FROM e WHERE name = 'query' AND json_extract(data, '$.first') = 1",
  "SELECT day, lang, country, 'success' AS metric, '' AS key FROM e WHERE name = 'success'",
  "SELECT day, lang, country, 'noresults' AS metric, '' AS key FROM e WHERE name = 'query' AND json_extract(data, '$.results') = 0",
  "SELECT day, lang, country, 'noclick' AS metric, '' AS key FROM e WHERE name = 'query' AND json_extract(data, '$.position') IS NULL",
  "SELECT day, lang, country, 'semantic' AS metric, '' AS key FROM e WHERE name = 'query' AND json_extract(data, '$.semantic') = 1",
  `SELECT day, lang, country, 'position' AS metric,
    CASE WHEN p = 1 THEN '1' WHEN p <= 5 THEN '2-5' WHEN p <= 10 THEN '6-10' WHEN p <= 20 THEN '11-20' ELSE '21+' END AS key
    FROM (SELECT day, lang, country, json_extract(data, '$.position') AS p FROM e WHERE name = 'query') WHERE p IS NOT NULL`,
  "SELECT day, lang, country, 'copy' AS metric, json_extract(data, '$.what') AS key FROM e WHERE name = 'copy'",
  "SELECT day, lang, country, 'download' AS metric, json_extract(data, '$.format') AS key FROM e WHERE name = 'download'",
  "SELECT day, lang, country, 'open' AS metric, json_extract(data, '$.from') AS key FROM e WHERE name = 'open'",
  "SELECT day, lang, country, 'style' AS metric, json_extract(data, '$.where') || ':' || json_extract(data, '$.style') AS key FROM e WHERE name = 'style'",
  `SELECT day, lang, country, 'icon' AS metric, json_extract(data, '$.icon') AS key FROM e
    WHERE name IN ('copy', 'download') AND json_extract(data, '$.icon') IS NOT NULL`,
  `SELECT day, lang, country, 'entry' AS metric,
    CASE WHEN s < 30 THEN '0-30' WHEN s < 60 THEN '30-60' WHEN s < 180 THEN '60-180' WHEN s < 600 THEN '180-600' ELSE '600+' END AS key
    FROM (SELECT day, lang, country, json_extract(data, '$.entry') AS s FROM e WHERE name IN ('copy', 'download')) WHERE s IS NOT NULL`,
];

const rollupStatement = (terms: readonly string[]): string => `WITH e AS (
  SELECT date(hour * 3600, 'unixepoch') AS day, name, lang, coalesce(country, '') AS country, data
  FROM events WHERE test = 0 AND hour >= ? AND hour < ?
)
INSERT INTO days (day, lang, country, metric, key, value)
SELECT day, lang, country, metric, coalesce(key, ''), count(*) FROM (
  ${terms.join("\n  UNION ALL ")}
)
GROUP BY day, lang, country, metric, key`;

/**
 * Итоги дней — несколькими запросами: у D1 в одном не больше D1_MAX_COMPOUND_TERMS частей, а одним
 * запросом из всех частей D1 отказывал (27 ноября 2026). День — по часу события, UTC. Параметры каждого
 * запроса: начало (час) и конец (час, не включительно) — целые дни.
 */
export const ROLLUP_DAYS: readonly string[] = Array.from(
  { length: Math.ceil(ROLLUP_TERMS.length / D1_MAX_COMPOUND_TERMS) },
  (_, i) =>
    rollupStatement(
      ROLLUP_TERMS.slice(
        i * D1_MAX_COMPOUND_TERMS,
        (i + 1) * D1_MAX_COMPOUND_TERMS,
      ),
    ),
);

export interface RollupResult {
  /** Дни, чьи итоги посчитаны заново. */
  days: string[];
  /** Сколько сырых событий удалено. */
  deleted: number;
}

const changesOf = (result: unknown): number => {
  const changes = (result as { meta?: { changes?: unknown } } | undefined)?.meta
    ?.changes;
  return typeof changes === "number" ? changes : 0;
};

/**
 * Раз в сутки (расписание функции): итоги каждого прошедшего дня, чьи сырые события ещё хранятся, —
 * заново, затем удаление событий старше RETENTION_DAYS целыми днями. День либо есть целиком, либо
 * удалён целиком: итоги удалённого дня больше не пересчитываются и остаются. Час события ставит приём,
 * поэтому прошедший день новых событий не получит. Одна пачка — одна транзакция: не прошёл один
 * запрос — не изменилось ничего, и следующий запуск посчитает все хранящиеся дни сам.
 */
export async function rollup(db: D1Like, now: number): Promise<RollupResult> {
  const today = Math.floor(hourOf(now) / DAY_HOURS);
  const from = (today - RETENTION_DAYS) * DAY_HOURS;
  const to = today * DAY_HOURS;
  const days = Array.from({ length: RETENTION_DAYS }, (_, d) =>
    dayOfHour(from + d * DAY_HOURS),
  );
  const results = await db.batch([
    ...schemaStatements(db),
    db
      .prepare("DELETE FROM days WHERE day >= ? AND day < ?")
      .bind(dayOfHour(from), dayOfHour(to)),
    ...ROLLUP_DAYS.map((sql) => db.prepare(sql).bind(from, to)),
    db.prepare("DELETE FROM events WHERE hour < ?").bind(from),
  ]);
  return { days, deleted: changesOf(results.at(-1)) };
}
