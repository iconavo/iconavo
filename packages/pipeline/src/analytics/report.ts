// Отчёт аналитики pnpm analytics (шаг 2 фазы 5, ADR-0043) — главная метрика и сырьё для настройки поиска.
// Успех поиска по неделям, отдельно ru и en: успехи / поисковые сессии (запросы с пометкой «первый»).
// Дни, чьи сырые события ещё хранятся (30 дней), считаются из них, более старые — из итогов дня.
// Остальное — из сырых событий за 30 дней: запросы без результатов и без кликов за неделю с числом
// повторов, место первого клика, что копируют и скачивают, откуда открывают, время до первой иконки,
// страны, отклонённое. Проверочные пачки (pnpm api check) в счёт не идут — отчёт только называет их число.

import { RETENTION_DAYS } from "@iconavo-ui/analytics/db";
import type { Reader } from "./reader.js";

export const DEFAULT_WEEKS = 4;
/** Неудачные запросы — за последние столько дней. */
export const FAILED_DAYS = 7;
/** Строк в списках неудачных запросов и иконок. */
const FAILED_LIMIT = 100;
const ICONS_LIMIT = 20;
const DAY_MS = 86_400_000;
const DAY_HOURS = 24;

/** Места первого клика — те же вёдра, что в итогах дня. */
export const POSITION_BUCKETS = ["1", "2-5", "6-10", "11-20", "21+"] as const;

export interface WeekRow {
  /** Понедельник недели по UTC. */
  week: string;
  lang: string;
  sessions: number;
  successes: number;
  queries: number;
  noresults: number;
  noclick: number;
  views: number;
}

export interface TextCount {
  q: string;
  lang: string;
  count: number;
}

export interface KeyCount {
  key: string;
  count: number;
}

export interface CountryRow {
  country: string;
  views: number;
  sessions: number;
  successes: number;
}

export interface AnalyticsReport {
  /** Первый день отчёта (понедельник) и сегодня, UTC. */
  from: string;
  to: string;
  weeks: number;
  /** С этого дня сырые события есть; раньше — только итоги дня. */
  rawFrom: string;
  /** Всего событий людей в сырых. */
  total: number;
  weeksTable: WeekRow[];
  noResults: TextCount[];
  noClicks: TextCount[];
  positions: KeyCount[];
  copies: KeyCount[];
  downloads: KeyCount[];
  sets: KeyCount[];
  icons: KeyCount[];
  opens: KeyCount[];
  styles: KeyCount[];
  sections: KeyCount[];
  /** Секунды от входа на сайт до первого копирования или скачивания во вкладке. */
  firstIcon: { median?: number; count: number };
  countries: CountryRow[];
  rejects: KeyCount[];
  /** Проверочные пачки pnpm api check: событий и отказов. */
  tests: { events: number; rejects: number };
}

const dayString = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);
const dayNumber = (text: string) =>
  Math.floor(Date.parse(`${text}T00:00:00Z`) / DAY_MS);
/** Понедельник недели дня. */
const mondayOf = (day: number) =>
  day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);

const num = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const RAW_DAYS = `SELECT hour / ${DAY_HOURS} AS d, lang,
  sum(name = 'query' AND json_extract(data, '$.first') = 1) AS sessions,
  sum(name = 'success') AS successes,
  sum(name = 'query') AS queries,
  sum(name = 'query' AND json_extract(data, '$.results') = 0) AS noresults,
  sum(name = 'query' AND json_extract(data, '$.position') IS NULL) AS noclick,
  sum(name = 'page') AS views
FROM events WHERE test = 0 AND hour >= ? GROUP BY d, lang`;

const metric = (name: string, as: string) =>
  `sum(CASE WHEN metric = '${name}' THEN value ELSE 0 END) AS ${as}`;

const TOTAL_DAYS = `SELECT day, lang, ${metric("session", "sessions")}, ${metric("success", "successes")},
  ${metric("query", "queries")}, ${metric("noresults", "noresults")}, ${metric("noclick", "noclick")},
  ${metric("page", "views")}
FROM days WHERE day >= ? AND day < ? GROUP BY day, lang`;

const FAILED = (
  where: string,
) => `SELECT json_extract(data, '$.q') AS q, lang, count(*) AS count
FROM events WHERE test = 0 AND name = 'query' AND hour >= ? AND ${where}
GROUP BY q, lang ORDER BY count DESC, q LIMIT ${FAILED_LIMIT}`;

const POSITIONS = `SELECT CASE WHEN p = 1 THEN '1' WHEN p <= 5 THEN '2-5' WHEN p <= 10 THEN '6-10'
  WHEN p <= 20 THEN '11-20' ELSE '21+' END AS key, count(*) AS count
FROM (SELECT json_extract(data, '$.position') AS p FROM events
  WHERE test = 0 AND name = 'query' AND hour >= ?) WHERE p IS NOT NULL GROUP BY key`;

const KEYS = (key: string, names: string, extra = "", limit = "") =>
  `SELECT ${key} AS key, count(*) AS count FROM events
WHERE test = 0 AND name IN (${names}) AND hour >= ?${extra} GROUP BY key ORDER BY count DESC, key${limit}`;

const ICON = "json_extract(data, '$.icon')";

const COUNTRIES = `SELECT coalesce(country, '') AS country,
  sum(name = 'page') AS views,
  sum(name = 'query' AND json_extract(data, '$.first') = 1) AS sessions,
  sum(name = 'success') AS successes
FROM events WHERE test = 0 AND hour >= ? GROUP BY country ORDER BY views DESC, country`;

/** Отчёт за weeks недель по сегодня (now) — всё из базы, без записи. */
export async function buildReport(
  reader: Reader,
  now: number,
  weeks: number = DEFAULT_WEEKS,
): Promise<AnalyticsReport> {
  const today = Math.floor(now / DAY_MS);
  const rawFirst = today - RETENTION_DAYS;
  const first = mondayOf(today) - (weeks - 1) * 7;
  const rawHour = rawFirst * DAY_HOURS;
  const failedHour = (today - FAILED_DAYS + 1) * DAY_HOURS;
  const keys = async (sql: string, from = rawHour) =>
    (await reader.all<{ key: unknown; count: unknown }>(sql, [from])).map(
      (r) => ({ key: String(r.key ?? ""), count: num(r.count) }),
    );

  // Недели: дни из сырых событий, старше — из итогов дня.
  type DayRow = Omit<WeekRow, "week" | "lang">;
  const byWeek = new Map<string, WeekRow>();
  const add = (day: number, lang: string, row: DayRow) => {
    if (day < first) return;
    const week = dayString(mondayOf(day));
    const key = `${week}|${lang}`;
    const sum =
      byWeek.get(key) ??
      ({
        week,
        lang,
        sessions: 0,
        successes: 0,
        queries: 0,
        noresults: 0,
        noclick: 0,
        views: 0,
      } satisfies WeekRow);
    for (const field of Object.keys(row) as (keyof DayRow)[]) {
      sum[field] += row[field];
    }
    byWeek.set(key, sum);
  };
  const dayRow = (r: Record<string, unknown>): DayRow => ({
    sessions: num(r.sessions),
    successes: num(r.successes),
    queries: num(r.queries),
    noresults: num(r.noresults),
    noclick: num(r.noclick),
    views: num(r.views),
  });
  for (const r of await reader.all<Record<string, unknown>>(RAW_DAYS, [
    Math.max(first, rawFirst) * DAY_HOURS,
  ])) {
    add(num(r.d), String(r.lang), dayRow(r));
  }
  if (first < rawFirst) {
    for (const r of await reader.all<Record<string, unknown>>(TOTAL_DAYS, [
      dayString(first),
      dayString(rawFirst),
    ])) {
      add(dayNumber(String(r.day)), String(r.lang), dayRow(r));
    }
  }
  const weeksTable = [...byWeek.values()].sort(
    (a, b) => b.week.localeCompare(a.week) || a.lang.localeCompare(b.lang),
  );

  const failed = async (where: string) =>
    (
      await reader.all<{ q: unknown; lang: unknown; count: unknown }>(
        FAILED(where),
        [failedHour],
      )
    ).map((r) => ({
      q: String(r.q ?? ""),
      lang: String(r.lang),
      count: num(r.count),
    }));

  const positionCounts = new Map(
    (await keys(POSITIONS)).map((k) => [k.key, k.count]),
  );
  const entries = (
    await reader.all<{ s: unknown }>(
      `SELECT json_extract(data, '$.entry') AS s FROM events
WHERE test = 0 AND name IN ('copy', 'download') AND hour >= ? AND json_extract(data, '$.entry') IS NOT NULL`,
      [rawHour],
    )
  ).map((r) => num(r.s));
  const firstIconMedian = median(entries);

  const [total] = await reader.all<{ n: unknown }>(
    "SELECT count(*) AS n FROM events WHERE test = 0 AND hour >= ?",
    [rawHour],
  );
  const [testEvents] = await reader.all<{ n: unknown }>(
    "SELECT count(*) AS n FROM events WHERE test = 1 AND hour >= ?",
    [rawHour],
  );
  const [testRejects] = await reader.all<{ n: unknown }>(
    "SELECT coalesce(sum(count), 0) AS n FROM rejects WHERE test = 1 AND day >= ?",
    [dayString(rawFirst)],
  );

  return {
    from: dayString(first),
    to: dayString(today),
    weeks,
    rawFrom: dayString(rawFirst),
    total: num(total?.n),
    weeksTable,
    noResults: await failed("json_extract(data, '$.results') = 0"),
    noClicks: await failed(
      "json_extract(data, '$.results') > 0 AND json_extract(data, '$.position') IS NULL AND json_extract(data, '$.copied') = 0 AND json_extract(data, '$.downloaded') = 0",
    ),
    positions: POSITION_BUCKETS.map((key) => ({
      key,
      count: positionCounts.get(key) ?? 0,
    })),
    copies: await keys(KEYS("json_extract(data, '$.what')", "'copy'")),
    downloads: await keys(KEYS("json_extract(data, '$.format')", "'download'")),
    sets: await keys(
      KEYS(
        `substr(${ICON}, 1, instr(${ICON}, ':') - 1)`,
        "'copy', 'download'",
        ` AND ${ICON} IS NOT NULL`,
      ),
    ),
    icons: await keys(
      KEYS(
        ICON,
        "'copy', 'download'",
        ` AND ${ICON} IS NOT NULL`,
        ` LIMIT ${ICONS_LIMIT}`,
      ),
    ),
    opens: await keys(KEYS("json_extract(data, '$.from')", "'open'")),
    styles: await keys(
      KEYS(
        "json_extract(data, '$.where') || ':' || json_extract(data, '$.style')",
        "'style'",
      ),
    ),
    sections: await keys(KEYS("json_extract(data, '$.section')", "'page'")),
    firstIcon: {
      ...(firstIconMedian === undefined ? {} : { median: firstIconMedian }),
      count: entries.length,
    },
    countries: (
      await reader.all<Record<string, unknown>>(COUNTRIES, [rawHour])
    ).map((r) => ({
      country: String(r.country ?? ""),
      views: num(r.views),
      sessions: num(r.sessions),
      successes: num(r.successes),
    })),
    rejects: (
      await reader.all<{ key: unknown; count: unknown }>(
        "SELECT reason AS key, sum(count) AS count FROM rejects WHERE test = 0 AND day >= ? GROUP BY reason ORDER BY count DESC, reason",
        [dayString(rawFirst)],
      )
    ).map((r) => ({ key: String(r.key), count: num(r.count) })),
    tests: { events: num(testEvents?.n), rejects: num(testRejects?.n) },
  };
}

/** Доля успехов: «—», если сессий не было. */
export const successRate = (successes: number, sessions: number): string =>
  sessions === 0 ? "—" : `${((successes / sessions) * 100).toFixed(0)}%`;
