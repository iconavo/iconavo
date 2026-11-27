// База D1 поверх синхронного SQLite — модуля node:sqlite (Node 22.13+): тесты и превью функций Workers без
// сети (аналитика — шаг 2 фазы 5, аккаунты — шаг 3, ADR-0055). Модуль Node сюда не импортируется — его
// передаёт вызывающий: `sqliteD1(new DatabaseSync(":memory:"))`.
//
// Что база повторяет за D1:
// - пределы D1, которых нет у node:sqlite (`D1_LIMITS`), — запрос, который D1 отклонит, отклоняется и
//   здесь, с тем же видом ошибки «D1_ERROR: … : SQLITE_…»; урок PR #207;
// - значения: булево — 1 или 0, байты — BLOB; undefined, дату, объект и BigInt D1 отклоняет, а
//   node:sqlite молча пишет дату как NULL — здесь это ошибка D1_TYPE_ERROR;
// - ответ run() и all() — { success, results, meta }: число изменённых строк и номер последней
//   вставленной — в meta.changes и meta.last_row_id, их читает и Better Auth;
// - пачка batch() — одна транзакция без пауз: запросы соседнего ответа в неё не вклиниваются;
// - BEGIN, COMMIT и SAVEPOINT в запросах D1 не пускает — транзакция только пачкой;
// - вид привязки: prepare, batch и exec — по ним Better Auth узнаёт D1 и идёт тем же путём, что на Workers.

import {
  D1_LIMITS,
  type D1Like,
  type D1Result,
  type D1Statement,
  type SqlValue,
} from "./index.js";
import {
  compoundTerms,
  isTransaction,
  isWrite,
  likePatterns,
  paramCount,
  statements,
  type Token,
  tokenize,
  tooManyArgs,
  tooManyColumns,
} from "./scan.js";

/** Значение, которое принимает node:sqlite. */
type SqliteValue = string | number | null | Uint8Array;

/** Часть StatementSync из node:sqlite. */
export interface SqliteStatement {
  run(...values: SqliteValue[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  all(...values: SqliteValue[]): unknown[];
  columns(): readonly unknown[];
}

/** Часть DatabaseSync из node:sqlite. */
export interface SqliteLike {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

/** Ошибка как у D1: «D1_ERROR: сообщение: SQLITE_КОД». */
const d1Error = (message: string, code = "SQLITE_ERROR"): Error =>
  new Error(`D1_ERROR: ${message}: ${code}`);

/** Основные коды SQLite по номеру (младший байт расширенного кода node:sqlite). */
const SQLITE_CODES: Record<number, string> = {
  1: "SQLITE_ERROR",
  5: "SQLITE_BUSY",
  6: "SQLITE_LOCKED",
  18: "SQLITE_TOOBIG",
  19: "SQLITE_CONSTRAINT",
  20: "SQLITE_MISMATCH",
  25: "SQLITE_RANGE",
};

/** Ошибку node:sqlite — в вид D1; ошибки D1 этой базы — как есть. */
function asD1Error(e: unknown): Error {
  if (e instanceof Error && /^D1_(TYPE_)?ERROR: /.test(e.message)) return e;
  const errcode = (e as { errcode?: unknown }).errcode;
  const code =
    typeof errcode === "number"
      ? (SQLITE_CODES[errcode & 0xff] ?? "SQLITE_ERROR")
      : "SQLITE_ERROR";
  return d1Error(e instanceof Error ? e.message : String(e), code);
}

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** Значение для node:sqlite: как его записала бы D1; неподходящее — ошибка D1_TYPE_ERROR. */
function toSqlite(value: SqlValue | undefined): SqliteValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || value === null) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error(
    `D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${String(value)}'`,
  );
}

const valueBytes = (value: SqliteValue): number =>
  typeof value === "string"
    ? bytes(value)
    : value instanceof Uint8Array
      ? value.byteLength
      : 0;

/** Предел D1, который нарушает запрос с этими значениями; ничего — undefined. */
function limitProblem(
  sql: string,
  tokens: readonly Token[],
  values: readonly SqliteValue[],
): Error | undefined {
  if (bytes(sql) > D1_LIMITS.sqlBytes) {
    return d1Error("statement too long", "SQLITE_TOOBIG");
  }
  if (isTransaction(tokens)) {
    return d1Error(
      "transaction statements are not supported, use batch()",
      "SQLITE_AUTH",
    );
  }
  if (compoundTerms(tokens) > D1_LIMITS.compoundTerms) {
    return d1Error("too many terms in compound SELECT");
  }
  if (Math.max(paramCount(tokens), values.length) > D1_LIMITS.params) {
    return d1Error("too many SQL variables");
  }
  if (values.some((v) => valueBytes(v) > D1_LIMITS.valueBytes)) {
    return d1Error("string or blob too big", "SQLITE_TOOBIG");
  }
  for (const pattern of likePatterns(tokens)) {
    const text =
      "literal" in pattern ? pattern.literal : values[pattern.param - 1];
    if (typeof text === "string" && bytes(text) > D1_LIMITS.likePatternBytes) {
      return d1Error("LIKE or GLOB pattern too complex");
    }
  }
  const fn = tooManyArgs(tokens);
  if (fn !== undefined) return d1Error(`too many arguments on function ${fn}`);
  const table = tooManyColumns(tokens);
  if (table !== undefined) return d1Error(`too many columns on ${table.table}`);
  return undefined;
}

const meta = (changes: number, lastRowId: number) => ({
  changes,
  last_row_id: lastRowId,
  changed_db: changes > 0,
  duration: 0,
  rows_read: 0,
  rows_written: changes,
});

class Statement implements D1Statement {
  constructor(
    private readonly db: SqliteLike,
    readonly sql: string,
    readonly values: readonly SqlValue[],
  ) {}

  bind(...values: SqlValue[]): D1Statement {
    return new Statement(this.db, this.sql, values);
  }

  /** Запрос на node:sqlite с пределами D1; ответ — как у D1. */
  execute<T>(): D1Result<T> {
    const values = this.values.map(toSqlite);
    const tokens = tokenize(this.sql);
    const problem = limitProblem(this.sql, tokens, values);
    if (problem !== undefined) throw problem;
    try {
      const statement = this.db.prepare(this.sql);
      const columns = statement.columns().length;
      if (columns > D1_LIMITS.columns) {
        throw d1Error("too many columns in result set");
      }
      if (columns === 0) {
        const { changes, lastInsertRowid } = statement.run(...values);
        return {
          success: true,
          results: [],
          meta: meta(Number(changes), Number(lastInsertRowid)),
        };
      }
      const results = statement.all(...values) as T[];
      if (!isWrite(tokens)) return { success: true, results, meta: meta(0, 0) };
      // INSERT … RETURNING: строки и число изменений вместе, как у D1.
      const [counts] = this.db
        .prepare("SELECT changes() AS c, last_insert_rowid() AS r")
        .all() as { c: number; r: number }[];
      return {
        success: true,
        results,
        meta: meta(Number(counts?.c ?? 0), Number(counts?.r ?? 0)),
      };
    } catch (e) {
      throw asD1Error(e);
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const [row] = this.execute<Record<string, unknown>>().results;
    if (row === undefined) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) {
      throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    }
    return row[column] as T;
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const rows = this.execute<Record<string, unknown>>().results;
    const arrays = rows.map((row) => Object.values(row));
    if (options?.columnNames !== true) return arrays as T[];
    const names = this.db
      .prepare(this.sql)
      .columns()
      .map((c) => (c as { name?: unknown }).name);
    return [names, ...arrays] as T[];
  }
}

export function sqliteD1(db: SqliteLike): D1Like {
  return {
    prepare: (sql) => new Statement(db, sql, []),
    batch: async <T>(list: D1Statement[]) => {
      const own = list.map((s) => {
        if (!(s instanceof Statement)) {
          throw new Error("запрос не от этой базы");
        }
        return s;
      });
      db.exec("BEGIN");
      try {
        const results = own.map((s) => s.execute<T>());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    exec: async (sql) => {
      const parts = statements(tokenize(sql));
      for (const tokens of parts) {
        const problem = limitProblem("", tokens, []);
        if (problem !== undefined) throw problem;
      }
      try {
        db.exec(sql);
      } catch (e) {
        throw asD1Error(e);
      }
      return { count: parts.length, duration: 0 };
    },
  };
}
