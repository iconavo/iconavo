// База D1 поверх синхронного SQLite — модуля node:sqlite (Node 22.13+): тесты и превью функции edge
// API без сети (шаг 2 фазы 5). Модуль Node сюда не импортируется — его передаёт вызывающий:
// `sqliteD1(new DatabaseSync(":memory:"))`. Пачка — одна транзакция, как у D1, и выполняется без
// пауз: запросы соседнего ответа в неё не вклиниваются. Пределы D1, которых нет у node:sqlite, база
// повторяет сама: запрос, который D1 отклонит, отклоняется и здесь — с тем же текстом ошибки.

import {
  D1_MAX_COMPOUND_TERMS,
  D1_MAX_PARAMS,
  type D1Like,
  type D1Statement,
  type SqlValue,
} from "./db.js";

/** Часть StatementSync из node:sqlite. */
export interface SqliteStatement {
  run(...values: SqlValue[]): { changes: number | bigint };
  all(...values: SqlValue[]): unknown[];
}

/** Часть DatabaseSync из node:sqlite. */
export interface SqliteLike {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

/** Конец строки в кавычках: удвоенная кавычка внутри — сама кавычка. */
function quoteEnd(sql: string, start: number): number {
  const quote = sql[start];
  for (let i = start + 1; i < sql.length; i++) {
    if (sql[i] !== quote) continue;
    if (sql[i + 1] !== quote) return i + 1;
    i++;
  }
  return sql.length;
}

/**
 * Частей в самой длинной составной выборке запроса: у каждых скобок свой счёт, как у SQLite.
 * Строки, имена в кавычках и комментарии пропускаются.
 */
function compoundTerms(sql: string): number {
  const open = [1];
  let most = 1;
  let i = 0;
  while (i < sql.length) {
    const c = sql.charAt(i);
    const next = sql.charAt(i + 1);
    if (c === "'" || c === '"' || c === "`") {
      i = quoteEnd(sql, i);
    } else if (c === "[") {
      const end = sql.indexOf("]", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (/[A-Za-z_]/.test(c)) {
      const word = /^[A-Za-z0-9_$]+/.exec(sql.slice(i))?.[0] ?? c;
      if (/^(UNION|INTERSECT|EXCEPT)$/i.test(word)) {
        open[open.length - 1] = (open.at(-1) ?? 1) + 1;
      }
      i += word.length;
    } else {
      if (c === "(") open.push(1);
      if (c === ")" && open.length > 1) most = Math.max(most, open.pop() ?? 1);
      i++;
    }
  }
  return Math.max(most, ...open);
}

/** Как отказ D1: «D1_ERROR: … : SQLITE_ERROR». */
function checkLimits(sql: string, values: readonly SqlValue[]): void {
  const problem =
    compoundTerms(sql) > D1_MAX_COMPOUND_TERMS
      ? "too many terms in compound SELECT"
      : values.length > D1_MAX_PARAMS
        ? "too many SQL variables"
        : undefined;
  if (problem) throw new Error(`D1_ERROR: ${problem}: SQLITE_ERROR`);
}

class Statement implements D1Statement {
  constructor(
    private readonly db: SqliteLike,
    readonly sql: string,
    readonly values: readonly SqlValue[],
  ) {}

  bind(...values: SqlValue[]): D1Statement {
    return new Statement(this.db, this.sql, values);
  }

  /** Как ответ D1 на запись: число изменённых строк — в meta.changes. */
  runSync(): { success: true; meta: { changes: number }; results: [] } {
    checkLimits(this.sql, this.values);
    const { changes } = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(changes) }, results: [] };
  }

  async run(): Promise<unknown> {
    return this.runSync();
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    checkLimits(this.sql, this.values);
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
}

export function sqliteD1(db: SqliteLike): D1Like {
  return {
    prepare: (sql) => new Statement(db, sql, []),
    batch: async (statements) => {
      const own = statements.map((s) => {
        if (!(s instanceof Statement)) {
          throw new Error("запрос не от этой базы");
        }
        return s;
      });
      db.exec("BEGIN");
      try {
        const results = own.map((s) => s.runSync());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
