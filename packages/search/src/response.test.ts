import { describe, expect, it } from "vitest";
import { EXACT_LIMIT } from "./config.js";
import { mainWindow } from "./request.js";
import {
  pageResults,
  parseMultiSearch,
  type SearchHit,
  searchResponse,
} from "./response.js";

const hit = (icon: string): SearchHit => ({ icon, variants: [], tones: [] });

describe("parseMultiSearch", () => {
  it("по списку карточек на запрос", () => {
    const json = {
      results: [
        { hits: [{ icon: "lucide:house", variants: ["house-plus"] }] },
        { hits: [] },
      ],
    };
    expect(parseMultiSearch(json, 2)).toEqual([
      [{ icon: "lucide:house", variants: ["house-plus"], tones: [] }],
      [],
    ]);
  });

  it.each([
    [{}, /без results/],
    [{ results: [] }, /ответов Meilisearch 0, запросов 1/],
    [{ results: [{}] }, /без hits/],
    [{ results: [{ hits: [{ icon: "house" }] }] }, /неверное имя/],
    [
      { results: [{ hits: [{ icon: "a:b", variants: ["X"] }] }] },
      /неверное имя X/,
    ],
  ])("ответ не по форме — ошибка: %j", (json, message) => {
    expect(() => parseMultiSearch(json, 1)).toThrow(message);
  });
});

describe("pageResults", () => {
  /** Общая выдача: точные, затем основная без них. */
  function page(exact: string[], all: string[], start: number, limit: number) {
    const rest = all.filter((icon) => !exact.includes(icon));
    const { offset, limit: count } = mainWindow(start, limit);
    return pageResults(
      exact.map(hit),
      rest.slice(offset, offset + count).map(hit),
      start,
      limit,
    ).map((r) => (r.exact ? `!${r.icon}` : r.icon));
  }

  const all = Array.from({ length: 200 }, (_, i) => `s:i${i}`);

  it("точные совпадения впереди и помечены", () => {
    expect(page(["s:i5", "s:i9"], all, 0, 4)).toEqual([
      "!s:i5",
      "!s:i9",
      "s:i0",
      "s:i1",
    ]);
  });

  it("страницы подряд — без пропусков и повторов", () => {
    const exact = ["s:i5", "s:i9", "s:i150"];
    const merged = [...exact, ...all.filter((i) => !exact.includes(i))];
    for (const limit of [1, 3, 64]) {
      const seen: string[] = [];
      for (let start = 0; start < merged.length; start += limit) {
        seen.push(
          ...page(exact, all, start, limit).map((i) => i.replace("!", "")),
        );
      }
      expect(seen).toEqual(merged);
    }
  });

  it("точных больше лимита — берутся первые EXACT_LIMIT", () => {
    const exact = all.slice(0, EXACT_LIMIT + 5);
    expect(page(exact, all, 0, EXACT_LIMIT + 10)).toHaveLength(
      EXACT_LIMIT + 10,
    );
  });

  it("основная выдача кончилась — страница короче", () => {
    expect(page([], all.slice(0, 3), 0, 64)).toEqual(["s:i0", "s:i1", "s:i2"]);
  });
});

describe("searchResponse", () => {
  it("поля Iconify и наши", () => {
    expect(
      searchResponse(
        [{ ...hit("lucide:house"), exact: true }],
        { start: 0, limit: 64 },
        "pending",
      ),
    ).toEqual({
      icons: ["lucide:house"],
      total: 1,
      limit: 64,
      start: 0,
      results: [{ icon: "lucide:house", variants: [], tones: [], exact: true }],
      semantic: "pending",
    });
  });
});
