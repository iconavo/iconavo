import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1_LIMITS, type D1Like, type SqlValue } from "./index.js";
import { sqliteD1 } from "./sqlite.js";

const fresh = () => sqliteD1(new DatabaseSync(":memory:"));

/** Составная выборка из n частей: SELECT 1 UNION ALL SELECT 2 … */
const union = (n: number) =>
  Array.from({ length: n }, (_, i) => `SELECT ${i + 1} AS x`).join(
    " UNION ALL ",
  );

const numbers = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const rows = async (db: D1Like, sql: string, ...values: SqlValue[]) =>
  (
    await db
      .prepare(sql)
      .bind(...values)
      .all()
  ).results;

// Пределы D1 строже, чем у SQLite по умолчанию, а node:sqlite их не задаёт: тесты и превью проходили
// запрос, который D1 отклонял (итоги дня аналитики, 27 ноября 2026). Числа — со страницы пределов D1;
// части составной выборки и параметры — ещё и замер на живой базе.
describe("пределы D1", () => {
  it("в составной выборке — не больше 5 частей", async () => {
    expect(D1_LIMITS.compoundTerms).toBe(5);
    expect(await rows(fresh(), union(5))).toEqual(
      numbers(5).map((x) => ({ x })),
    );
    await expect(fresh().prepare(union(6)).all()).rejects.toThrow(
      "D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR",
    );
  });

  it("части считаются в своих скобках; слова в строках и комментариях — не части", async () => {
    const nested = `SELECT x FROM (${union(5)}) UNION ALL SELECT x FROM (${union(5)})`;
    expect(await rows(fresh(), nested)).toHaveLength(10);
    const words = `SELECT 'UNION UNION UNION UNION UNION' AS x -- UNION UNION
      /* UNION UNION UNION */ UNION ALL SELECT "UNION" FROM (SELECT 1 AS "UNION")`;
    expect(await rows(fresh(), words)).toHaveLength(2);
    await expect(
      fresh()
        .prepare(`SELECT x FROM (${union(6)})`)
        .all(),
    ).rejects.toThrow("too many terms in compound SELECT");
  });

  it("в запросе — не больше 100 параметров, по номерам SQLite", async () => {
    expect(D1_LIMITS.params).toBe(100);
    const select = (n: number) =>
      fresh()
        .prepare(
          `SELECT ${numbers(n)
            .map(() => "?")
            .join(", ")}`,
        )
        .bind(...numbers(n));
    expect((await select(100).all()).results).toHaveLength(1);
    await expect(select(101).all()).rejects.toThrow(
      "D1_ERROR: too many SQL variables: SQLITE_ERROR",
    );
    // ?101 — сто первый параметр, даже когда он один; ?NNN повторяет номер, а не добавляет новый.
    await expect(fresh().prepare("SELECT ?101").bind(1).all()).rejects.toThrow(
      "too many SQL variables",
    );
    const repeated = `SELECT ${numbers(150)
      .map(() => "?1")
      .join(" + ")} AS s`;
    expect(await rows(fresh(), repeated, 1)).toEqual([{ s: 150 }]);
  });

  it("текст запроса — не длиннее 100 000 байт", async () => {
    expect(D1_LIMITS.sqlBytes).toBe(100_000);
    // SELECT '…' AS x — 14 байт вокруг строки.
    const sized = (n: number) => `SELECT '${"a".repeat(n - 14)}' AS x`;
    expect(await rows(fresh(), sized(100_000))).toHaveLength(1);
    await expect(fresh().prepare(sized(100_001)).all()).rejects.toThrow(
      "D1_ERROR: statement too long: SQLITE_TOOBIG",
    );
  });

  it("строка и BLOB — не больше 2 000 000 байт, считаются байты, а не буквы", async () => {
    expect(D1_LIMITS.valueBytes).toBe(2_000_000);
    const db = fresh();
    expect(
      await rows(db, "SELECT length(?) AS n", "a".repeat(2_000_000)),
    ).toEqual([{ n: 2_000_000 }]);
    await expect(
      db.prepare("SELECT ?").bind("я".repeat(1_000_001)).all(),
    ).rejects.toThrow("D1_ERROR: string or blob too big: SQLITE_TOOBIG");
    await expect(
      db.prepare("SELECT ?").bind(new Uint8Array(2_000_001)).all(),
    ).rejects.toThrow("string or blob too big");
  });

  it("шаблон LIKE и GLOB — не длиннее 50 байт, и внутри lower(?)", async () => {
    expect(D1_LIMITS.likePatternBytes).toBe(50);
    const db = fresh();
    await db.exec("CREATE TABLE u (email TEXT)");
    const long = `${"a".repeat(50)}%`;
    expect(
      await rows(db, "SELECT * FROM u WHERE email LIKE ?", "a".repeat(50)),
    ).toEqual([]);
    for (const sql of [
      "SELECT * FROM u WHERE email LIKE ?",
      "SELECT * FROM u WHERE LOWER(email) LIKE LOWER(?)",
      "SELECT * FROM u WHERE email NOT GLOB ?",
    ]) {
      await expect(db.prepare(sql).bind(long).all()).rejects.toThrow(
        "D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR",
      );
    }
    await expect(
      db.prepare(`SELECT * FROM u WHERE email LIKE '${long}'`).all(),
    ).rejects.toThrow("LIKE or GLOB pattern too complex");
  });

  it("у функции — не больше 32 аргументов; списки столбцов и IN — не функции", async () => {
    expect(D1_LIMITS.functionArgs).toBe(32);
    const max = (n: number) => `SELECT max(${numbers(n).join(", ")}) AS m`;
    expect(await rows(fresh(), max(32))).toEqual([{ m: 32 }]);
    await expect(fresh().prepare(max(33)).all()).rejects.toThrow(
      "D1_ERROR: too many arguments on function max: SQLITE_ERROR",
    );
    const db = fresh();
    const names = numbers(40).map((i) => `c${i}`);
    await db.exec(`CREATE TABLE wide (${names.join(" INTEGER, ")} INTEGER)`);
    await db
      .prepare(
        `INSERT INTO wide (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
      )
      .bind(...numbers(40))
      .run();
    expect(
      await rows(
        db,
        `SELECT c1 FROM wide WHERE c40 IN (${numbers(40).join(", ")})`,
      ),
    ).toEqual([{ c1: 1 }]);
  });

  it("в таблице и в ответе — не больше 100 столбцов", async () => {
    expect(D1_LIMITS.columns).toBe(100);
    const table = (n: number) =>
      `CREATE TABLE t (${numbers(n)
        .map((i) => `c${i} INTEGER`)
        .join(", ")}, PRIMARY KEY (c1))`;
    await fresh().exec(table(100));
    await expect(fresh().exec(table(101))).rejects.toThrow(
      "D1_ERROR: too many columns on t: SQLITE_ERROR",
    );
    await expect(fresh().prepare(table(101)).run()).rejects.toThrow(
      "too many columns on t",
    );
    const select = (n: number) =>
      `SELECT ${numbers(n)
        .map((i) => `${i} AS c${i}`)
        .join(", ")}`;
    expect(await rows(fresh(), select(100))).toHaveLength(1);
    await expect(fresh().prepare(select(101)).all()).rejects.toThrow(
      "D1_ERROR: too many columns in result set: SQLITE_ERROR",
    );
  });

  it("запрос сверх предела роняет всю пачку", async () => {
    const db = fresh();
    await db.batch([db.prepare("CREATE TABLE t (x INTEGER)")]);
    await expect(
      db.batch([
        db.prepare("INSERT INTO t VALUES (1)"),
        db.prepare(`INSERT INTO t ${union(6)}`),
      ]),
    ).rejects.toThrow("too many terms in compound SELECT");
    expect(await rows(db, "SELECT count(*) AS n FROM t")).toEqual([{ n: 0 }]);
  });

  it("BEGIN, COMMIT и SAVEPOINT D1 не пускает — транзакция только пачкой", async () => {
    const db = fresh();
    for (const sql of ["BEGIN", "COMMIT", "SAVEPOINT a", "ROLLBACK"]) {
      await expect(db.prepare(sql).run()).rejects.toThrow(
        "D1_ERROR: transaction statements are not supported, use batch(): SQLITE_AUTH",
      );
    }
    await expect(db.exec("BEGIN; SELECT 1; COMMIT")).rejects.toThrow(
      "transaction statements are not supported",
    );
  });
});

describe("значения — как у D1", () => {
  it("булево — 1 и 0, байты — BLOB", async () => {
    const db = fresh();
    expect(await rows(db, "SELECT ? AS t, ? AS f", true, false)).toEqual([
      { t: 1, f: 0 },
    ]);
    const [blob] = await rows(
      db,
      "SELECT length(?) AS n",
      new Uint8Array([1, 2, 3]).buffer,
    );
    expect(blob).toEqual({ n: 3 });
  });

  it("undefined, дата, объект и BigInt — ошибка D1_TYPE_ERROR (node:sqlite записал бы дату как NULL)", async () => {
    for (const value of [undefined, new Date(0), {}, 10n]) {
      await expect(
        fresh()
          .prepare("SELECT ?")
          .bind(value as unknown as SqlValue)
          .all(),
      ).rejects.toThrow(/^D1_TYPE_ERROR: Type '\w+' not supported for value/);
    }
  });
});

describe("ответы — как у D1", () => {
  it("run() и all() отдают meta: число изменений и номер вставленной строки", async () => {
    const db = fresh();
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT)");
    const insert = await db
      .prepare("INSERT INTO t (x) VALUES (?)")
      .bind("a")
      .run();
    expect(insert).toMatchObject({
      success: true,
      results: [],
      meta: { changes: 1, last_row_id: 1, changed_db: true },
    });
    // Better Auth пишет через all() — изменения и там.
    const viaAll = await db
      .prepare("INSERT INTO t (x) VALUES (?)")
      .bind("b")
      .all();
    expect(viaAll.meta).toMatchObject({ changes: 1, last_row_id: 2 });
    const returning = await db
      .prepare("UPDATE t SET x = ? WHERE id > 0 RETURNING id")
      .bind("c")
      .all<{ id: number }>();
    expect(returning.results).toEqual([{ id: 1 }, { id: 2 }]);
    expect(returning.meta.changes).toBe(2);
    const select = await db.prepare("SELECT x FROM t").all();
    expect(select.meta).toMatchObject({ changes: 0, changed_db: false });
  });

  it("first() — первая строка или значение столбца; raw() — массивы", async () => {
    const db = fresh();
    expect(await db.prepare("SELECT 1 AS a, 2 AS b").first()).toEqual({
      a: 1,
      b: 2,
    });
    expect(await db.prepare("SELECT 1 AS a, 2 AS b").first("b")).toBe(2);
    expect(await db.prepare("SELECT 1 AS a WHERE 0").first()).toBeNull();
    await expect(db.prepare("SELECT 1 AS a").first("z")).rejects.toThrow(
      "D1_COLUMN_NOTFOUND",
    );
    expect(await db.prepare("SELECT 1 AS a, 2 AS b").raw()).toEqual([[1, 2]]);
    expect(
      await db.prepare("SELECT 1 AS a, 2 AS b").raw({ columnNames: true }),
    ).toEqual([
      ["a", "b"],
      [1, 2],
    ]);
  });

  it("ошибки SQLite — в виде D1, с основным кодом", async () => {
    const db = fresh();
    await db.exec("CREATE TABLE t (x TEXT UNIQUE)");
    await db.prepare("INSERT INTO t VALUES (?)").bind("a").run();
    await expect(
      db.prepare("INSERT INTO t VALUES (?)").bind("a").run(),
    ).rejects.toThrow(
      "D1_ERROR: UNIQUE constraint failed: t.x: SQLITE_CONSTRAINT",
    );
    await expect(db.prepare("SELEC 1").all()).rejects.toThrow(
      /^D1_ERROR: near "SELEC": syntax error: SQLITE_ERROR$/,
    );
  });

  it("exec() — несколько запросов, число запросов в ответе", async () => {
    const db = fresh();
    expect(
      await db.exec("CREATE TABLE a (x INTEGER); CREATE TABLE b (y INTEGER);"),
    ).toEqual({ count: 2, duration: 0 });
    await expect(db.exec(`SELECT 1; ${union(6)}`)).rejects.toThrow(
      "too many terms in compound SELECT",
    );
  });

  it("вид привязки — D1: Better Auth узнаёт её по prepare, batch и exec", () => {
    const db = fresh();
    expect("prepare" in db && "batch" in db && "exec" in db).toBe(true);
    // Так Better Auth узнаёт базу node:sqlite и better-sqlite3 — у привязки D1 этого нет.
    expect("createSession" in db || "aggregate" in db).toBe(false);
  });
});
