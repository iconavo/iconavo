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
 * Итоги одного дня из сырых событий, без проверочных: просмотры по разделам; запросы, поисковые
 * сессии (запрос с пометкой «первый»), успехи, запросы без результатов и без открытой иконки, с
 * выдачей по смыслу; место первой открытой иконки; что скопировано и скачано; откуда открыта
 * иконка; переключения стиля; иконки копирований и скачиваний; время до первой иконки.
 * Параметры: начало дня (час), конец (час), день.
 */
export const ROLLUP_DAY = `WITH e AS (
  SELECT name, lang, coalesce(country, '') AS country, data FROM events
  WHERE test = 0 AND hour >= ? AND hour < ?
)
INSERT INTO days (day, lang, country, metric, key, value)
SELECT ?, lang, country, metric, coalesce(key, ''), count(*) FROM (
  SELECT lang, country, 'page' AS metric, json_extract(data, '$.section') AS key FROM e WHERE name = 'page'
  UNION ALL SELECT lang, country, 'query', '' FROM e WHERE name = 'query'
  UNION ALL SELECT lang, country, 'session', '' FROM e WHERE name = 'query' AND json_extract(data, '$.first') = 1
  UNION ALL SELECT lang, country, 'success', '' FROM e WHERE name = 'success'
  UNION ALL SELECT lang, country, 'noresults', '' FROM e WHERE name = 'query' AND json_extract(data, '$.results') = 0
  UNION ALL SELECT lang, country, 'noclick', '' FROM e WHERE name = 'query' AND json_extract(data, '$.position') IS NULL
  UNION ALL SELECT lang, country, 'semantic', '' FROM e WHERE name = 'query' AND json_extract(data, '$.semantic') = 1
  UNION ALL SELECT lang, country, 'position',
    CASE WHEN p = 1 THEN '1' WHEN p <= 5 THEN '2-5' WHEN p <= 10 THEN '6-10' WHEN p <= 20 THEN '11-20' ELSE '21+' END
    FROM (SELECT lang, country, json_extract(data, '$.position') AS p FROM e WHERE name = 'query') WHERE p IS NOT NULL
  UNION ALL SELECT lang, country, 'copy', json_extract(data, '$.what') FROM e WHERE name = 'copy'
  UNION ALL SELECT lang, country, 'download', json_extract(data, '$.format') FROM e WHERE name = 'download'
  UNION ALL SELECT lang, country, 'open', json_extract(data, '$.from') FROM e WHERE name = 'open'
  UNION ALL SELECT lang, country, 'style', json_extract(data, '$.where') || ':' || json_extract(data, '$.style') FROM e WHERE name = 'style'
  UNION ALL SELECT lang, country, 'icon', json_extract(data, '$.icon') FROM e
    WHERE name IN ('copy', 'download') AND json_extract(data, '$.icon') IS NOT NULL
  UNION ALL SELECT lang, country, 'entry',
    CASE WHEN s < 30 THEN '0-30' WHEN s < 60 THEN '30-60' WHEN s < 180 THEN '60-180' WHEN s < 600 THEN '180-600' ELSE '600+' END
    FROM (SELECT lang, country, json_extract(data, '$.entry') AS s FROM e WHERE name IN ('copy', 'download')) WHERE s IS NOT NULL
)
GROUP BY lang, country, metric, key`;

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
 * поэтому прошедший день новых событий не получит. Одна пачка — одна транзакция.
 */
export async function rollup(db: D1Like, now: number): Promise<RollupResult> {
  const today = Math.floor(hourOf(now) / DAY_HOURS);
  const first = today - RETENTION_DAYS;
  const statements = schemaStatements(db);
  const days: string[] = [];
  const clear = db.prepare("DELETE FROM days WHERE day = ?");
  const count = db.prepare(ROLLUP_DAY);
  for (let d = first; d < today; d++) {
    const from = d * DAY_HOURS;
    const day = dayOfHour(from);
    days.push(day);
    statements.push(clear.bind(day), count.bind(from, from + DAY_HOURS, day));
  }
  statements.push(
    db.prepare("DELETE FROM events WHERE hour < ?").bind(first * DAY_HOURS),
  );
  const results = await db.batch(statements);
  return { days, deleted: changesOf(results.at(-1)) };
}
