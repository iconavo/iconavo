import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCatalog, setDocs } from "../search/catalog.js";
import { demoConfig, loadedSet } from "../search/fixture.testing.js";
import {
  COLUMNS,
  csvCell,
  currentLabels,
  fitsOf,
  type GoldenQuery,
  type Judgments,
  parseCsv,
  parseQueries,
  readJudgments,
  readOverrides,
} from "./golden.js";

const HEAD = COLUMNS.join(",");

describe("queries.csv", () => {
  it("поля в кавычках: запятые, кавычки, переводы строк", () => {
    expect(parseCsv('a,"b, c","d ""e""","f\ng"\nh,,i\n')).toEqual([
      ["a", "b, c", 'd "e"', "f\ng"],
      ["h", "", "i"],
    ]);
    for (const v of ["plain", "with, comma", 'quote "q"', "line\nbreak"]) {
      expect(parseCsv(`${csvCell(v)}\n`)).toEqual([[v]]);
    }
    expect(() => parseCsv('"open')).toThrow(/незакрытая/);
  });

  it("запросы сверяются: колонки, язык, тип, часть, повтор id", () => {
    const good = `${HEAD}\nru-001,корзина,ru,object,"Ведро, с крышкой.",work\n`;
    expect(parseQueries(good)).toEqual([
      {
        id: "ru-001",
        query: "корзина",
        lang: "ru",
        type: "object",
        description: "Ведро, с крышкой.",
        split: "work",
      },
    ]);
    expect(() => parseQueries("id,query\nru-001,x\n")).toThrow(/колонки/);
    expect(() => parseQueries(`${HEAD}\nru-001,x,de,object,d,work\n`)).toThrow(
      /язык или тип/,
    );
    expect(() => parseQueries(`${HEAD}\nru-001,x,ru,object,d,test\n`)).toThrow(
      /часть/,
    );
    expect(() =>
      parseQueries(
        `${HEAD}\nru-001,x,ru,object,d,work\nru-001,y,ru,ui,d,work\n`,
      ),
    ).toThrow(/повторяется/);
  });
});

const config = demoConfig("demo");
const docs = setDocs(
  config,
  loadedSet({
    id: "demo",
    icons: [
      { name: "trash", en: ["trash"] },
      { name: "cart", en: ["cart"] },
    ],
    aliases: { bin: "trash" },
  }),
);
const catalog = buildCatalog([{ config, docs }]);
const fp = (id: string) =>
  catalog.docs[catalog.byId.get(id) as number]?.fingerprint as string;
const q: GoldenQuery = {
  id: "ru-001",
  query: "корзина",
  lang: "ru",
  type: "object",
  description: "Мусорное ведро.",
  split: "work",
};
const judge = { model: "test/judge", promptVersion: 1 };

describe("действующая разметка", () => {
  it("вердикты судьи, алиас — к карточке, правки владельца главнее", () => {
    const j: Judgments = {
      judge,
      queries: {
        "ru-001": {
          query: q.query,
          description: q.description,
          icons: {
            "demo:bin": { verdict: "fits", fingerprint: fp("demo:trash") },
            "demo:cart": { verdict: "partial", fingerprint: fp("demo:cart") },
          },
        },
      },
    };
    const labels = currentLabels(
      [q],
      j,
      { "ru-001": { "demo:cart": "no" } },
      catalog,
    );
    expect([...(labels.byQuery.get("ru-001") ?? [])]).toEqual([
      ["demo:trash", "fits"],
      ["demo:cart", "no"],
    ]);
    expect(labels.overridden).toBe(1);
    expect(fitsOf(labels, "ru-001")).toEqual(new Set(["demo:trash"]));
  });

  it("другой рисунок или другой текст запроса — пары размечаются заново", () => {
    const icons = {
      "demo:trash": { verdict: "fits" as const, fingerprint: "000000000000" },
      "demo:gone": { verdict: "fits" as const, fingerprint: fp("demo:cart") },
    };
    const stale = currentLabels(
      [q],
      {
        judge,
        queries: {
          "ru-001": { query: q.query, description: q.description, icons },
        },
      },
      {},
      catalog,
    );
    expect(stale).toMatchObject({ staleIcons: 1, unknown: 1 });
    expect(stale.byQuery.get("ru-001")?.size).toBe(0);
    const changed = currentLabels(
      [q],
      {
        judge,
        queries: {
          "ru-001": { query: "мусорка", description: q.description, icons },
        },
      },
      {},
      catalog,
    );
    expect(changed.staleQueries).toBe(1);
  });
});

describe("файлы разметки", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "iconavo-golden-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("нет файла — пусто; другая модель или промпт — заново", async () => {
    const path = join(root, "judgments.json");
    expect((await readJudgments(path, judge)).judgments.queries).toEqual({});
    await writeFile(
      path,
      JSON.stringify({
        judge: { model: "old", promptVersion: 1 },
        queries: { x: { query: "a", description: "b", icons: {} } },
      }),
    );
    const read = await readJudgments(path, judge);
    expect(read.judgments.queries).toEqual({});
    expect(read.reset).toContain("old");
  });

  it("файл не по формату — ошибка, а не молча пусто", async () => {
    const path = join(root, "overrides.json");
    await writeFile(path, JSON.stringify({ "ru-001": { "demo:x": "maybe" } }));
    await expect(readOverrides(path)).rejects.toThrow(/не по формату/);
    expect(await readOverrides(join(root, "none.json"))).toEqual({});
  });
});
