import { describe, expect, it } from "vitest";
import { buildCatalog, setDocs } from "./catalog.js";
import { demoConfig, loadedSet } from "./fixture.testing.js";
import {
  exactDocs,
  nameForm,
  prepare,
  rankPrepared,
  textQuery,
} from "./hybrid.js";
import { buildTextIndex, searchText } from "./text.js";

const lucide = demoConfig("lucide");
const tabler = demoConfig("tabler");
const catalog = buildCatalog([
  {
    config: lucide,
    docs: setDocs(
      lucide,
      loadedSet({
        id: "lucide",
        icons: [
          { name: "shopping-cart", en: ["cart"], ru: ["корзина"] },
          { name: "trash", en: ["trash"], ru: ["корзина", "мусор"] },
          { name: "house", en: ["home"], ru: ["дом"] },
          { name: "calendar", en: ["date"], ru: ["календарь"] },
        ],
        aliases: { home: "house" },
      }),
    ),
  },
  {
    config: tabler,
    docs: setDocs(
      tabler,
      loadedSet({
        id: "tabler",
        suffixes: { "": "Outline", "-filled": "Filled" },
        icons: [
          { name: "trash", en: ["trash"], ru: ["корзина"] },
          { name: "trash-filled" },
          { name: "basket", en: ["basket"], ru: ["корзинка"] },
        ],
      }),
    ),
  },
]);
const index = buildTextIndex(catalog.docs.map((d) => d.words));
const id = (n: number) => catalog.docs[n]?.id;
/** Номера документов: lucide 0–3, tabler 4–5. */
const doc = (name: string) => catalog.byId.get(name) as number;

/** Косинусы по номерам документов. */
const cosOf = (values: Record<string, number>) => {
  const out = new Float32Array(catalog.docs.length).fill(0);
  for (const [name, c] of Object.entries(values)) out[doc(name)] = c;
  return out;
};

describe("точное имя", () => {
  it("запрос в виде имени: пробелы → дефисы, регистр не важен", () => {
    expect(nameForm("  Shopping   Cart ")).toBe("shopping-cart");
    expect(exactDocs(catalog, "Shopping Cart").map(id)).toEqual([
      "lucide:shopping-cart",
    ]);
  });

  it("имя во всех наборах; с префиксом — только в этом наборе", () => {
    expect(exactDocs(catalog, "trash").map(id)).toEqual([
      "lucide:trash",
      "tabler:trash",
    ]);
    expect(exactDocs(catalog, "tabler:trash").map(id)).toEqual([
      "tabler:trash",
    ]);
  });

  it("алиас и вариант ведут к карточке; русский запрос — ни к чему", () => {
    expect(exactDocs(catalog, "home").map(id)).toEqual(["lucide:house"]);
    expect(exactDocs(catalog, "trash-filled").map(id)).toEqual([
      "tabler:trash",
    ]);
    expect(exactDocs(catalog, "корзина")).toEqual([]);
  });

  it("у `набор:имя` текстовая часть ищет только имя", () => {
    expect(textQuery(catalog, "lucide:house")).toBe("house");
    expect(textQuery(catalog, "unknown:house")).toBe("unknown:house");
  });
});

describe("слияние", () => {
  const run = (
    query: string,
    mode: "hybrid" | "vector" | "text",
    alpha: number,
    cos?: Float32Array,
    set?: string,
  ) => {
    const text = searchText(index, textQuery(catalog, query));
    return rankPrepared(
      prepare(catalog, query, text, cos, set),
      mode,
      alpha,
      10,
    );
  };

  it("точное имя — первым даже при слабом смысле", () => {
    const cos = cosOf({ "lucide:calendar": 0.9, "lucide:trash": 0.1 });
    const top = run("trash", "hybrid", 0.9, cos);
    expect(top.slice(0, 2).map((r) => id(r.doc))).toEqual([
      "lucide:trash",
      "tabler:trash",
    ]);
    expect(top[0]?.exact).toBe(true);
  });

  it("текст без совпадений — порядок даёт смысл", () => {
    const cos = cosOf({ "lucide:calendar": 0.8, "lucide:house": 0.4 });
    const top = run("клиентоориентированность", "hybrid", 0.5, cos);
    expect(id(top[0]?.doc as number)).toBe("lucide:calendar");
    expect(top[0]?.text).toBe(0);
  });

  it("равные текстовые оценки разбивает смысл", () => {
    const cos = cosOf({ "tabler:trash": 0.7, "lucide:shopping-cart": 0.2 });
    const top = run("корзина", "hybrid", 0.3, cos);
    // У трёх карточек «корзина» в синонимах — текст равный, порядок по косинусу.
    const order = top
      .filter((r) => Math.abs(r.text - 0.7) < 1e-9)
      .map((r) => id(r.doc));
    expect(order).toEqual([
      "tabler:trash",
      "lucide:shopping-cart",
      "lucide:trash",
    ]);
  });

  it("одна опечатка не становится «идеальным» текстом", () => {
    const top = run("корзинв", "text", 0);
    expect(top.length).toBeGreaterThan(0);
    for (const r of top) expect(r.text).toBeLessThan(0.6);
  });

  it("«Смысл» — только векторы, без правила точного имени", () => {
    const cos = cosOf({ "lucide:calendar": 0.9 });
    const top = run("trash", "vector", 1, cos);
    expect(id(top[0]?.doc as number)).toBe("lucide:calendar");
    expect(top.every((r) => !r.exact)).toBe(true);
  });

  it("гибрид без векторов — как «Текст»: поиск не падает", () => {
    const top = run("trash", "hybrid", 0.5);
    expect(top.map((r) => id(r.doc))).toEqual(
      run("trash", "text", 0).map((r) => id(r.doc)),
    );
  });

  it("фильтр по набору", () => {
    const cos = cosOf({
      "lucide:trash": 0.9,
      "tabler:trash": 0.6,
      "tabler:basket": 0.5,
    });
    const top = run("корзина", "hybrid", 0.5, cos, "tabler");
    expect(top.every((r) => catalog.docs[r.doc]?.set === "tabler")).toBe(true);
    expect(id(top[0]?.doc as number)).toBe("tabler:trash");
  });

  it("α = 0 — порядок текста, α = 1 — порядок смысла", () => {
    const cos = cosOf({
      "lucide:shopping-cart": 0.1,
      "lucide:trash": 0.5,
      "tabler:trash": 0.9,
    });
    const text0 = run("cart", "hybrid", 0, cos).map((r) => id(r.doc));
    expect(text0[0]).toBe("lucide:shopping-cart");
    const vec1 = run("корзина", "hybrid", 1, cos).map((r) => id(r.doc));
    expect(vec1[0]).toBe("tabler:trash");
  });
});
