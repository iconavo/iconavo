import { describe, expect, it } from "vitest";
import { FIELD_WEIGHTS, MATCH_QUALITY } from "./config.js";
import {
  buildTextIndex,
  type DocWords,
  expansions,
  normalizeWord,
  queryWords,
  searchText,
  typoDistance,
  words,
} from "./text.js";

const doc = (
  name: string[],
  tags: string[] = [],
  synonyms: string[] = [],
): DocWords => ({ name, tags, synonyms });

describe("слова", () => {
  it("строчные, ё → е, диакритика снимается только у латиницы, «й» остаётся", () => {
    expect(normalizeWord("Шестерёнка")).toBe("шестеренка");
    expect(normalizeWord("ЙОГУРТ")).toBe("йогурт");
    expect(normalizeWord("Café")).toBe("cafe");
    // Ударение над кириллицей — тоже знак, слово остаётся целым.
    expect(normalizeWord("сто́л")).toBe("стол");
    // ё, набранная двумя знаками.
    expect(normalizeWord("ёлка")).toBe("елка");
  });

  it("разделители — всё, что не буква и не цифра", () => {
    expect(words("shopping-cart, Корзина 2")).toEqual([
      "shopping",
      "cart",
      "корзина",
      "2",
    ]);
  });

  it("служебные слова не ищутся", () => {
    expect(queryWords("добавить в корзину")).toEqual(["добавить", "корзину"]);
    expect(queryWords("eye icon")).toEqual(["eye"]);
    expect(queryWords("в для the")).toEqual([]);
  });
});

describe("опечатки", () => {
  it("перестановка соседних букв — одна опечатка", () => {
    expect(typoDistance("каледнарь", "календарь", 2)).toBe(1);
  });

  it("опечатка в первой букве считается за две", () => {
    expect(typoDistance("корзина", "торзина", 2)).toBe(2);
    expect(typoDistance("корзина", "торзина", 1)).toBe(2);
  });

  it("дальше порога — max + 1, не досчитывая", () => {
    expect(typoDistance("календарь", "кадр", 2)).toBe(3);
    expect(typoDistance("abcdef", "abcxyz", 1)).toBe(2);
  });

  it("одна опечатка от 5 букв, две — от 9; короче 5 — без опечаток", () => {
    const index = buildTextIndex([
      doc(["корзина"]),
      doc(["корзинка"]),
      doc(["календарь"]),
      doc(["кот"]),
    ]);
    expect([...expansions(index, "корзину", false)]).toEqual([
      ["корзина", "typo1"],
    ]);
    // «каледнарьь»: 10 букв — две опечатки можно.
    expect(expansions(index, "каледнарьь", false).get("календарь")).toBe(
      "typo2",
    );
    expect(expansions(index, "кит", false).size).toBe(0);
  });
});

describe("начало слова", () => {
  const index = buildTextIndex([
    doc(["calendar"]),
    doc(["calendars"]),
    doc(["cat"]),
  ]);

  it("только у последнего слова запроса и от 2 букв", () => {
    expect(expansions(index, "cal", true).get("calendar")).toBe("prefix");
    expect(expansions(index, "cal", false).has("calendar")).toBe(false);
    expect(expansions(index, "c", true).size).toBe(0);
  });

  it("точное слово лучше начала слова", () => {
    expect(expansions(index, "calendar", true).get("calendar")).toBe("exact");
    expect(expansions(index, "calendar", true).get("calendars")).toBe("prefix");
  });
});

describe("оценка", () => {
  it("лучшее поле, а не сумма: слово в имени и в тегах не считается дважды", () => {
    const index = buildTextIndex([
      doc(["home"], ["home"]),
      doc(["house"], [], ["home"]),
    ]);
    const r = searchText(index, "home");
    const idf = index.idf.get("home") as number;
    expect(r.scores[0]).toBeCloseTo(idf * FIELD_WEIGHTS.name, 9);
    expect(r.scores[1]).toBeCloseTo(idf * FIELD_WEIGHTS.synonyms, 9);
    expect(r.best).toBeCloseTo(idf * FIELD_WEIGHTS.name, 9);
    expect(r.matches.get(1)).toEqual([
      { query: "home", word: "home", field: "synonyms", kind: "exact" },
    ]);
  });

  it("редкая опечатка не весит больше точного слова: редкость — одна на слово запроса", () => {
    const docs = [
      ...Array.from({ length: 20 }, () => doc(["calendar"])),
      doc(["calendr"]),
    ];
    const index = buildTextIndex(docs);
    const r = searchText(index, "calendar");
    expect(r.scores[0]).toBeGreaterThan(r.scores[20] as number);
    expect((r.scores[20] as number) / r.best).toBeCloseTo(
      MATCH_QUALITY.typo1,
      9,
    );
  });

  it("слова без похожих в словаре в лучшую оценку не входят", () => {
    const index = buildTextIndex([doc(["trash"]), doc(["cart"])]);
    const r = searchText(index, "trash клиентоориентированность");
    expect(r.scores[0]).toBeCloseTo(r.best, 9);
  });

  it("запрос из одних служебных слов ничего не находит", () => {
    const index = buildTextIndex([doc(["in"], ["for"])]);
    const r = searchText(index, "в для in");
    expect(r.words).toEqual([]);
    expect(r.best).toBe(0);
    expect([...r.scores].every((s) => s === 0)).toBe(true);
  });
});
