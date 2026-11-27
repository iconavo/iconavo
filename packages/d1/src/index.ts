// Общий модуль базы D1 (шаг 3 фазы 5, ADR-0055): свои типы привязки D1 вместо @cloudflare/workers-types —
// новая зависимость ради нескольких строк не нужна — и пределы D1, которые строже SQLite по умолчанию.
// База поверх node:sqlite для тестов и превью — вход `@iconavo-ui/d1/sqlite`: она отклоняет то, что
// отклонит настоящая D1, с тем же видом ошибки. Урок PR #207: тесты на node:sqlite проходили запрос,
// который D1 отклонил.

/**
 * Значение параметра запроса, как у D1: булево D1 пишет числом 1 или 0, байты — BLOB. Остальное
 * (undefined, дату, объект, BigInt) D1 отклоняет ошибкой D1_TYPE_ERROR — база тестов тоже.
 */
export type SqlValue =
  | string
  | number
  | boolean
  | null
  | ArrayBuffer
  | ArrayBufferView;

/** Сведения о запросе — часть D1Result.meta. */
export interface D1Meta {
  changes: number;
  last_row_id: number;
  changed_db: boolean;
  duration: number;
  rows_read: number;
  rows_written: number;
}

/** Ответ на запрос — часть D1Result: у run() и all() он одинаковый. */
export interface D1Result<T = Record<string, unknown>> {
  success: true;
  results: T[];
  meta: D1Meta;
}

/** Подготовленный запрос — часть D1PreparedStatement. */
export interface D1Statement {
  bind(...values: SqlValue[]): D1Statement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

/** Привязка базы — часть D1Database: пачка запросов идёт одной транзакцией. */
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch<T = Record<string, unknown>>(
    statements: D1Statement[],
  ): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}

/**
 * Пределы D1 — страница https://developers.cloudflare.com/d1/platform/limits/ (27 ноября 2026). Части
 * составной выборки и параметры подтверждены и замером на живой базе (ADR-0043).
 */
export const D1_LIMITS = {
  /** Параметров в запросе. */
  params: 100,
  /** Частей составной выборки: UNION, INTERSECT, EXCEPT. */
  compoundTerms: 5,
  /** Байт в тексте одного запроса. */
  sqlBytes: 100_000,
  /** Байт в строке, BLOB или строке таблицы. */
  valueBytes: 2_000_000,
  /** Байт в шаблоне LIKE или GLOB. */
  likePatternBytes: 50,
  /** Аргументов у функции SQL. */
  functionArgs: 32,
  /** Столбцов в таблице и в ответе. */
  columns: 100,
} as const;
