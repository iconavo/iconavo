// База D1 поверх синхронного SQLite — модуля node:sqlite (Node 22.13+): тесты и превью функции edge
// API без сети (шаг 2 фазы 5). Модуль Node сюда не импортируется — его передаёт вызывающий:
// `sqliteD1(new DatabaseSync(":memory:"))`. Пачка — одна транзакция, как у D1, и выполняется без
// пауз: запросы соседнего ответа в неё не вклиниваются.

import type { D1Like, D1Statement, SqlValue } from "./db.js";

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
    const { changes } = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(changes) }, results: [] };
  }

  async run(): Promise<unknown> {
    return this.runSync();
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
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
