import { describe, expect, it } from "vitest";
import {
  allCommercial,
  hasFilters,
  knownPages,
  pageWindow,
  parseSearchAnswer,
  readSearchState,
  retryAfterSeconds,
  SEARCH_MAX_PAGE,
  searchApiUrl,
  stateParams,
} from "./search";

const KNOWN = { sets: ["lucide", "ph"], licenses: ["ISC", "MIT"] };
const read = (query: string) =>
  readSearchState(new URLSearchParams(query), KNOWN);

describe("состояние страницы поиска в адресе", () => {
  it("читает запрос и фильтры, незнакомое отбрасывает", () => {
    expect(read("q=%20дом%20&style=filled&set=ph&license=MIT&page=2")).toEqual({
      q: "дом",
      style: "filled",
      set: "ph",
      license: "MIT",
      page: 2,
    });
    expect(read("q=a&style=bold&set=mdi&license=GPL-3.0&page=99")).toEqual({
      q: "a",
      page: 1,
    });
    expect(read("page=0").page).toBe(1);
    expect(read("page=1.5").page).toBe(1);
  });

  it("параметры — в постоянном порядке, пустые и страница 1 не пишутся", () => {
    expect(
      stateParams({
        q: "дом",
        page: 1,
        set: "ph",
        style: "outline",
      }).toString(),
    ).toBe("q=%D0%B4%D0%BE%D0%BC&style=outline&set=ph");
    expect(stateParams({ q: "", page: 3 }).toString()).toBe("page=3");
  });

  it("«можно в коммерческих» — только если в каталоге есть набор с ограничениями", () => {
    expect(read("q=a&commercial=1").commercial).toBeUndefined();
    const restricted = readSearchState(
      new URLSearchParams("q=a&commercial=1"),
      {
        sets: [],
        licenses: ["MIT", "CC-BY-NC-4.0"],
      },
    );
    expect(restricted.commercial).toBe(true);
    expect(allCommercial(["MIT", "ISC", "Apache-2.0"])).toBe(true);
    expect(allCommercial(["MIT", "CC-BY-NC-4.0"])).toBe(false);
    expect(
      searchApiUrl("https://api.test", { q: "a", page: 1, commercial: true }),
    ).toContain("license=Apache-2.0%2CISC%2CMIT");
  });

  it("фильтры есть или нет", () => {
    expect(hasFilters({ q: "a", page: 2 })).toBe(false);
    expect(hasFilters({ q: "a", page: 1, style: "color" })).toBe(true);
  });
});

describe("адрес edge API и страницы", () => {
  it("набор — prefix, стиль и лицензия — как есть; начало — только со второй страницы", () => {
    expect(
      searchApiUrl("https://api.test", {
        q: "дом",
        page: 1,
        set: "ph",
        style: "filled",
      }),
    ).toBe(
      "https://api.test/search?query=%D0%B4%D0%BE%D0%BC&limit=96&prefix=ph&style=filled",
    );
    expect(searchApiUrl("https://api.test", { q: "a", page: 2 })).toBe(
      "https://api.test/search?query=a&limit=96&start=96",
    );
    expect(searchApiUrl("https://api.test", { q: "a", page: 3 }, 24)).toBe(
      "https://api.test/search?query=a&limit=24",
    );
  });

  it("страниц не больше 11, у последней — 40 карточек: не дальше 1000-й", () => {
    expect(SEARCH_MAX_PAGE).toBe(11);
    expect(pageWindow(1)).toEqual({ start: 0, limit: 96 });
    expect(pageWindow(11)).toEqual({ start: 960, limit: 40 });
  });

  it("номеров — до следующей, пока страница полная", () => {
    expect(knownPages(1, true)).toBe(2);
    expect(knownPages(3, false)).toBe(3);
    expect(knownPages(11, true)).toBe(11);
  });
});

describe("ответ /search", () => {
  const answer = {
    icons: ["ph:house-fill", "lucide:house"],
    total: 2,
    limit: 2,
    start: 0,
    results: [
      { icon: "ph:house", exact: true, variants: [], tones: [], styles: {} },
      { icon: "lucide:house", variants: [], tones: [], styles: {} },
    ],
    semantic: "full",
    matched: true,
  };

  it("клетка — карточка как ключ и то, что показать", () => {
    expect(parseSearchAnswer(answer)).toEqual({
      cards: [
        {
          card: "ph:house",
          icon: "ph:house-fill",
          set: "ph",
          name: "house-fill",
          exact: true,
        },
        {
          card: "lucide:house",
          icon: "lucide:house",
          set: "lucide",
          name: "house",
          exact: false,
        },
      ],
      semantic: "full",
      matched: true,
      hasNext: true,
    });
  });

  it("следующая страница — только если эта полная и не дальше 1000-й", () => {
    expect(parseSearchAnswer({ ...answer, limit: 64 })?.hasNext).toBe(false);
    expect(
      parseSearchAnswer({ ...answer, start: 998, limit: 2 })?.hasNext,
    ).toBe(false);
  });

  it("без matched (API до шага 3) — по тому, пуста ли выдача", () => {
    const { matched: _, ...old } = answer;
    expect(parseSearchAnswer(old)?.matched).toBe(true);
  });

  it.each([
    [{ ...answer, semantic: "maybe" }],
    [{ ...answer, icons: ["ph:house"] }],
    [{ ...answer, icons: ["house", "lucide:house"] }],
    [null],
  ])("не по форме — нет ответа: %j", (value) => {
    expect(parseSearchAnswer(value)).toBeUndefined();
  });
});

describe("ожидание после 429", () => {
  it("секунды из Retry-After, иначе минута; не больше 10 минут", () => {
    expect(retryAfterSeconds("2")).toBe(2);
    expect(retryAfterSeconds(null)).toBe(60);
    expect(retryAfterSeconds("soon")).toBe(60);
    expect(retryAfterSeconds("100000")).toBe(600);
  });
});
