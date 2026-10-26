import { describe, expect, it } from "vitest";
import { EXACT_LIMIT, SEMANTIC_RATIO } from "./config.js";
import {
  exactQuery,
  filterConditions,
  mainQuery,
  mainWindow,
} from "./request.js";

describe("filterConditions", () => {
  it("наборы, цветность и лицензии — через «и»", () => {
    expect(
      filterConditions({
        sets: ["lucide", "tabler"],
        palette: false,
        licenses: ["MIT", "Apache-2.0"],
      }),
    ).toEqual([
      'set IN ["lucide", "tabler"]',
      "palette = false",
      'license IN ["MIT", "Apache-2.0"]',
    ]);
    expect(filterConditions({})).toEqual([]);
    expect(filterConditions({ sets: [], licenses: [] })).toEqual([]);
  });

  it.each([
    [{ sets: ['lucide" OR set = "x'] }],
    [{ sets: ["Lucide"] }],
    [{ licenses: ['MIT"]'] }],
    [{ licenses: ["MIT OR 1"] }],
  ])("подстановка в выражение — ошибка: %j", (filters) => {
    expect(() => filterConditions(filters)).toThrow(/неверн/);
  });
});

describe("exactQuery", () => {
  it("фильтр по полю names, без слов", () => {
    expect(exactQuery("house", { sets: ["lucide"] })).toEqual({
      indexUid: "icons",
      q: "",
      filter: ['set IN ["lucide"]', 'names = "house"'],
      limit: EXACT_LIMIT,
      attributesToRetrieve: ["icon", "variants", "tones"],
    });
    expect(exactQuery("lucide:house", {}).filter).toEqual([
      'names = "lucide:house"',
    ]);
  });

  it("неверное имя — ошибка", () => {
    expect(() => exactQuery('house" OR 1', {})).toThrow(/неверное имя/);
  });
});

describe("mainWindow", () => {
  it.each([
    [0, 64, { offset: 0, limit: 64 }],
    [10, 64, { offset: 0, limit: 74 }],
    [64, 64, { offset: 64 - EXACT_LIMIT, limit: 64 + EXACT_LIMIT }],
  ])("start %i, limit %i → %j", (start, limit, expected) => {
    expect(mainWindow(start, limit)).toEqual(expected);
  });
});

describe("mainQuery", () => {
  it("только слова, без вектора", () => {
    expect(mainQuery({ q: "дом", filters: {}, start: 0, limit: 64 })).toEqual({
      indexUid: "icons",
      q: "дом",
      limit: 64,
      offset: 0,
      attributesToRetrieve: ["icon", "variants", "tones"],
    });
  });

  it("гибрид с вектором и исключением точного имени", () => {
    const q = mainQuery({
      q: "house",
      filters: { palette: true },
      exclude: "house",
      start: 0,
      limit: 10,
      vector: Float32Array.from([0.5, 0.25]),
    });
    expect(q.filter).toEqual(["palette = true", 'NOT names = "house"']);
    expect(q.vector).toEqual([0.5, 0.25]);
    expect(
      mainQuery({
        q: "x",
        filters: {},
        start: 0,
        limit: 1,
        vector: Float32Array.from([0.012345678]),
      }).vector,
    ).toEqual([0.0123457]);
    expect(q.hybrid).toEqual({
      embedder: "gemini",
      semanticRatio: SEMANTIC_RATIO,
    });
    expect(
      mainQuery({
        q: "house",
        filters: {},
        start: 0,
        limit: 10,
        vector: [1],
        semanticRatio: 0.3,
      }).hybrid?.semanticRatio,
    ).toBe(0.3);
  });
});
