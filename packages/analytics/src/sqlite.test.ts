import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1_MAX_COMPOUND_TERMS, D1_MAX_PARAMS } from "./db.js";
import { sqliteD1 } from "./sqlite.js";

const fresh = () => sqliteD1(new DatabaseSync(":memory:"));

/** Составная выборка из n частей: SELECT 1 UNION ALL SELECT 2 … */
const union = (n: number) =>
  Array.from({ length: n }, (_, i) => `SELECT ${i + 1} AS x`).join(
    " UNION ALL ",
  );

const numbers = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

// Пределы D1 строже, чем у SQLite по умолчанию, а node:sqlite их не задаёт: тесты и превью проходили
// запрос, который D1 отклонял (итоги дня, 27 ноября 2026). Числа — замер на живой базе.
describe("пределы D1", () => {
  it("в составной выборке — не больше 5 частей", async () => {
    expect(D1_MAX_COMPOUND_TERMS).toBe(5);
    expect((await fresh().prepare(union(5)).all()).results).toEqual(
      numbers(5).map((x) => ({ x })),
    );
    await expect(fresh().prepare(union(6)).all()).rejects.toThrow(
      "D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR",
    );
  });

  it("части считаются в своих скобках; слова в строках и комментариях — не части", async () => {
    const nested = `SELECT x FROM (${union(5)}) UNION ALL SELECT x FROM (${union(5)})`;
    expect((await fresh().prepare(nested).all()).results).toHaveLength(10);
    const words = `SELECT 'UNION UNION UNION UNION UNION' AS x -- UNION UNION
      /* UNION UNION UNION */ UNION ALL SELECT "UNION" FROM (SELECT 1 AS "UNION")`;
    expect((await fresh().prepare(words).all()).results).toHaveLength(2);
    await expect(
      fresh()
        .prepare(`SELECT x FROM (${union(6)})`)
        .all(),
    ).rejects.toThrow("too many terms in compound SELECT");
  });

  it("в запросе — не больше 100 параметров", async () => {
    expect(D1_MAX_PARAMS).toBe(100);
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
    expect(
      (await db.prepare("SELECT count(*) AS n FROM t").all()).results,
    ).toEqual([{ n: 0 }]);
  });
});
