import { describe, expect, it } from "vitest";
import { pageSizeFor } from "./catalog";
import { PER_PAGE_CHOICES } from "./grid-settings";
import {
  activeFilters,
  allCommercial,
  filtersOf,
  hasFilters,
  knownPages,
  maxPage,
  pageWindow,
  parseSearchAnswer,
  readSearchState,
  retryAfterSeconds,
  SEARCH_MAX_PAGE,
  SEARCH_MIN_PAGE_SIZE,
  searchApiUrl,
  stateParams,
  withFilters,
} from "./search";
import { queryText } from "./url-query";

describe("предел номера страницы поиска (ревизия фазы 5, С-8)", () => {
  it("самая мелкая страница — при меньшем числе из настроек и любых колонках до 32", () => {
    const smallest = Math.min(...PER_PAGE_CHOICES);
    const sizes = Array.from({ length: 32 }, (_, i) =>
      pageSizeFor(i + 1, smallest),
    );
    expect(Math.min(...sizes)).toBe(SEARCH_MIN_PAGE_SIZE);
    // 48 на странице: страницы с 13-й по 21-ю при 48 карточках тоже открываются.
    expect(
      readSearchState(new URLSearchParams("q=a&page=21"), KNOWN).page,
    ).toBe(21);
    expect(
      readSearchState(new URLSearchParams("q=a&page=26"), KNOWN).page,
    ).toBe(1);
  });
});

const KNOWN = { sets: ["lucide", "ph"], licenses: ["ISC", "MIT"] };
const read = (query: string) =>
  readSearchState(new URLSearchParams(query), KNOWN);

describe("состояние страницы поиска в адресе", () => {
  it("читает запрос и фильтры, незнакомое отбрасывает", () => {
    expect(read("q=%20дом%20&style=filled&set=ph&license=MIT&page=2")).toEqual({
      q: "дом",
      style: "filled",
      sets: ["ph"],
      licenses: ["MIT"],
      page: 2,
    });
    expect(read("q=a&style=bold&set=mdi&license=GPL-3.0&page=99")).toEqual({
      q: "a",
      sets: [],
      licenses: [],
      page: 1,
    });
    expect(read("page=0").page).toBe(1);
    expect(read("page=1.5").page).toBe(1);
    expect(read("page=12").page).toBe(12);
    expect(read("page=13").page).toBe(13);
    expect(read("page=26").page).toBe(1);
  });

  it("наборов и лицензий несколько: повторы параметра и списки через запятую, порядок — каталога", () => {
    expect(read("set=ph&set=lucide&set=ph").sets).toEqual(["lucide", "ph"]);
    expect(read("set=ph,lucide,mdi").sets).toEqual(["lucide", "ph"]);
    expect(read("license=MIT&license=ISC").licenses).toEqual(["ISC", "MIT"]);
  });

  it("параметры — в постоянном порядке, пустые и страница 1 не пишутся", () => {
    expect(
      stateParams({
        q: "дом",
        page: 1,
        sets: ["lucide", "ph"],
        licenses: [],
        style: "outline",
      }).toString(),
    ).toBe("q=%D0%B4%D0%BE%D0%BC&style=outline&set=lucide%2Cph");
    expect(
      stateParams({ q: "", sets: [], licenses: ["MIT"], page: 3 }).toString(),
    ).toBe("license=MIT&page=3");
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
      searchApiUrl("https://api.test", {
        q: "a",
        sets: [],
        licenses: [],
        page: 1,
        commercial: true,
      }),
    ).toContain("license=Apache-2.0%2CISC%2CMIT");
  });

  it("фильтры есть или нет и сколько выбрано", () => {
    const none = { q: "a", sets: [], licenses: [], page: 2 };
    expect(hasFilters(none)).toBe(false);
    expect(activeFilters(none)).toBe(0);
    expect(hasFilters({ ...none, style: "color" })).toBe(true);
    expect(
      activeFilters({
        ...none,
        style: "color",
        sets: ["lucide", "ph"],
        licenses: ["MIT"],
      }),
    ).toBe(4);
  });
});

describe("адрес edge API и страницы", () => {
  const base = { sets: [], licenses: [] };
  it("наборы — prefixes списком, стиль и лицензии — как есть; начало — только со второй страницы", () => {
    expect(
      searchApiUrl("https://api.test", {
        q: "дом",
        page: 1,
        sets: ["lucide", "ph"],
        licenses: ["ISC", "MIT"],
        style: "filled",
      }),
    ).toBe(
      "https://api.test/search?query=%D0%B4%D0%BE%D0%BC&limit=96&prefixes=lucide%2Cph&style=filled&license=ISC%2CMIT",
    );
    expect(searchApiUrl("https://api.test", { ...base, q: "a", page: 2 })).toBe(
      "https://api.test/search?query=a&limit=96&start=96",
    );
    expect(
      searchApiUrl("https://api.test", { ...base, q: "a", page: 3 }, 98, 24),
    ).toBe("https://api.test/search?query=a&limit=24");
  });

  it("окно — от размера страницы целыми рядами: 98 карточек — вторая с 98-й", () => {
    expect(
      searchApiUrl("https://api.test", { ...base, q: "a", page: 2 }, 98),
    ).toBe("https://api.test/search?query=a&limit=98&start=98");
  });

  it("у последней страницы — остаток: не дальше 1000-й", () => {
    expect(maxPage()).toBe(11);
    expect(maxPage(98)).toBe(11);
    expect(maxPage(84)).toBe(12);
    expect(SEARCH_MAX_PAGE).toBe(25);
    expect(pageWindow(1)).toEqual({ start: 0, limit: 96 });
    expect(pageWindow(11)).toEqual({ start: 960, limit: 40 });
    expect(pageWindow(11, 98)).toEqual({ start: 980, limit: 20 });
    expect(pageWindow(12, 98)).toEqual({ start: 1078, limit: 0 });
  });

  it("номеров — до следующей, пока страница полная", () => {
    expect(knownPages(1, true)).toBe(2);
    expect(knownPages(3, false)).toBe(3);
    expect(knownPages(11, true)).toBe(11);
    expect(knownPages(11, true, 84)).toBe(12);
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

describe("фильтры левой панели и шторки", () => {
  it("адрес с фильтрами: запрос и иконка остаются, страница — первая, списки — через запятую", () => {
    const query = new URLSearchParams(
      "q=home&icon=lucide:house&set=ph&page=3&timing=1",
    );
    const next = withFilters(query, {
      sets: ["lucide", "ph"],
      licenses: ["MIT"],
      style: "filled",
    });
    expect(queryText(next)).toBe(
      "q=home&icon=lucide:house&timing=1&style=filled&set=lucide,ph&license=MIT",
    );
    expect(read(queryText(next)).sets).toEqual(["lucide", "ph"]);
    expect(queryText(withFilters(next, { sets: [], licenses: [] }))).toBe(
      "q=home&icon=lucide:house&timing=1",
    );
  });

  it("фильтры из состояния — без пустых полей", () => {
    expect(filtersOf(read("q=a&set=ph&style=color"))).toEqual({
      sets: ["ph"],
      licenses: [],
      style: "color",
    });
  });
});
