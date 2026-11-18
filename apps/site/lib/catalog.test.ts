import { describe, expect, it } from "vitest";
import {
  cardsInStyle,
  categoriesOf,
  categoryCards,
  categorySlug,
  FIRST_PAGE_MAX,
  filterCards,
  groupSets,
  nameQuery,
  orderSets,
  PAGE_SIZE,
  pageCount,
  pageItems,
  pageOf,
  pageParam,
  pageSizeFor,
  panelSet,
  parseCollection,
  parseReleases,
  parseSets,
  releaseCounts,
  revisionLabel,
  setCards,
  setStyles,
  showcase,
  shownName,
  visibleNames,
} from "./catalog";
import { releaseSummary, releaseView, setSummary } from "./catalog-view";
import { countOf, formatDate, formatNumber, ICON_FORMS } from "./format";

const INFO = {
  name: "Lucide",
  total: 1998,
  version: "81875c8",
  author: { name: "Lucide Contributors", url: "https://lucide.dev" },
  license: { title: "ISC", spdx: "ISC" },
  samples: ["house", "heart"],
  height: 24,
  palette: false,
};

describe("разбор ответов edge API", () => {
  it("наборы, имена и выпуски по формату — как есть", () => {
    expect(parseSets({ lucide: INFO })).toEqual({ lucide: INFO });
    const collection = {
      prefix: "lucide",
      title: "Lucide",
      total: 2,
      categories: { arrows: ["arrow-up"] },
      uncategorized: ["house"],
      hidden: ["old"],
      aliases: { home: "house" },
    };
    expect(parseCollection(collection)).toEqual(collection);
    const releases = [
      {
        prefix: "lucide",
        version: "8d1ee623",
        date: "2026-10-30T11:28:10Z",
        revision: "81875c8c42d2320fa5123b37fee3554f4ca2bddc",
        total: 1998,
      },
    ];
    expect(parseReleases({ releases })).toEqual(releases);
  });

  it("не тот формат — СТОП с понятным текстом", () => {
    expect(() => parseSets({ lucide: { name: "Lucide" } })).toThrow(
      /СТОП: каталог наборов — сведения о наборе «lucide»/,
    );
    expect(() =>
      parseCollection({ prefix: "x", title: "X", total: 1, aliases: { a: 1 } }),
    ).toThrow(/collection не по формату/);
    expect(() => parseReleases({ releases: [{ prefix: "x" }] })).toThrow(
      /выпуск в \/changelog не по формату/,
    );
  });
});

describe("имена, категории и страницы", () => {
  const collection = {
    prefix: "demo",
    title: "Demo",
    total: 4,
    categories: {
      "Animals & Nature": ["cat", "dog"],
      arrows: ["arrow-up", "cat"],
    },
    uncategorized: ["123", "house"],
  };

  it("видимые имена — без повторов, по кодам символов", () => {
    expect(visibleNames(collection)).toEqual([
      "123",
      "arrow-up",
      "cat",
      "dog",
      "house",
    ]);
  });

  it("категории по алфавиту, адрес — строчные слова через дефис", () => {
    expect(
      categoriesOf(collection).map((c) => [c.title, c.slug, c.names]),
    ).toEqual([
      ["Animals & Nature", "animals-nature", ["cat", "dog"]],
      ["arrows", "arrows", ["arrow-up", "cat"]],
    ]);
    expect(categorySlug("Smileys & Emotion")).toBe("smileys-emotion");
    // Одинаковые адреса двух категорий — у второй номер.
    expect(
      categoriesOf({
        ...collection,
        categories: { "A & B": ["a"], "A-B": ["b"] },
      }).map((c) => c.slug),
    ).toEqual(["a-b", "a-b-1"]);
  });

  it("страница — целые ряды, ближе всего к 96 (решение владельца 13 ноября 2026)", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14].map(pageSizeFor)).toEqual([
      96, 96, 96, 96, 95, 96, 98, 96, 99, 100, 98,
    ]);
    for (let columns = 1; columns <= 32; columns++) {
      expect(pageSizeFor(columns) % columns).toBe(0);
      expect(pageSizeFor(columns)).toBeLessThanOrEqual(FIRST_PAGE_MAX);
    }
    expect(FIRST_PAGE_MAX).toBe(108);
  });

  it("страницы по 96, номера — первая, соседние и последняя", () => {
    const names = Array.from({ length: 200 }, (_, i) => `n${i}`);
    expect(PAGE_SIZE).toBe(96);
    expect(pageCount(200)).toBe(3);
    expect(pageCount(0)).toBe(1);
    expect(pageOf(names, 3)).toEqual([
      "n192",
      "n193",
      "n194",
      "n195",
      "n196",
      "n197",
      "n198",
      "n199",
    ]);
    expect(pageCount(2029, 98)).toBe(21);
    expect(pageOf(names, 2, 98)).toEqual(names.slice(98, 196));
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(10, 165)).toEqual([1, "gap", 9, 10, 11, "gap", 165]);
    expect(pageItems(2, 165)).toEqual([1, 2, 3, "gap", 165]);
    expect(pageParam("2", 3)).toBe(2);
    expect(pageParam("4", 3)).toBe(1);
    expect(pageParam("1.5", 3)).toBe(1);
    expect(pageParam(null, 3)).toBe(1);
  });

  it("наборы витрины — первыми, новые — по алфавиту", () => {
    expect(
      orderSets(["zeta", "fluent-emoji-flat", "alpha", "lucide", "tabler"]),
    ).toEqual(["lucide", "tabler", "fluent-emoji-flat", "alpha", "zeta"]);
  });
});

describe("строки на языке страницы", () => {
  // Пробелы — обычные: неразрывный или обычный — зависит от версии данных Intl в Node.
  const spaces = (text: string) => text.replace(/\s/g, " ");

  it("числа, даты по UTC и формы слова", () => {
    expect(formatNumber("en", 1998)).toBe("1,998");
    expect(spaces(formatNumber("ru", 1998))).toBe("1 998");
    expect(formatDate("en", "2026-10-30T23:28:10Z")).toBe("October 30, 2026");
    expect(spaces(formatDate("ru", "2026-10-30T23:28:10Z"))).toBe(
      "30 октября 2026 г.",
    );
    expect(countOf("en", 1, ICON_FORMS.en)).toBe("1 icon");
    expect(spaces(countOf("ru", 1998, ICON_FORMS.ru))).toBe("1 998 иконок");
    expect(countOf("ru", 3, ICON_FORMS.ru)).toBe("3 иконки");
    expect(countOf("ru", 21, ICON_FORMS.ru)).toBe("21 иконка");
  });

  it("карточка набора и выпуск", () => {
    const card = setSummary("ru", "lucide", INFO, ["outline", "filled"]);
    expect({ ...card, total: spaces(card.total) }).toEqual({
      id: "lucide",
      name: "Lucide",
      total: "1 998 иконок",
      author: "Lucide Contributors",
      license: "ISC",
      licenseId: "ISC",
      palette: false,
      samples: ["house", "heart"],
      styles: ["outline", "filled"],
      stylesLine: "Контур · Заливка",
    });
    const release = {
      prefix: "lucide",
      version: "8d1ee623",
      previous: "c3b3f7a7",
      date: "2026-10-30T11:28:10Z",
      revision: "81875c8c42d2320fa5123b37fee3554f4ca2bddc",
      total: 1998,
      added: ["a", "b"],
      renamed: { bold: "letter-b" },
    };
    const view = releaseView("en", release, "Lucide");
    expect(view).toMatchObject({
      id: "lucide-8d1ee623",
      revision: "81875c8",
      total: "1,998",
      first: false,
      preview: ["a", "b"],
    });
    expect(view.lists).toEqual([
      { kind: "added", label: "Added", count: "2", names: ["a", "b"] },
      {
        kind: "renamed",
        label: "Renamed",
        count: "1",
        names: ["bold → letter-b"],
      },
    ]);
    expect(releaseSummary("en", view)).toBe("Added: 2 · Renamed: 1");
    const first = releaseView(
      "ru",
      { ...release, previous: undefined, added: undefined, renamed: undefined },
      "Lucide",
    );
    expect(releaseSummary("ru", first)).toBe("Набор добавлен в каталог");
    expect(releaseCounts(release)).toMatchObject({ added: 2, renamed: 1 });
    expect(revisionLabel("3.50.0")).toBe("3.50.0");
  });
});

describe("группы наборов и витрина карточки (редизайн по макету Figma)", () => {
  it("наборы по группам макета, новый — по признаку цветного", () => {
    const sets = {
      lucide: { palette: false },
      "material-symbols": { palette: false },
      "fluent-emoji-flat": { palette: true },
      noto: { palette: true },
      zzz: { palette: false },
    };
    expect(groupSets(sets)).toEqual([
      { id: "material", ids: ["material-symbols"] },
      { id: "ui-24", ids: ["lucide", "zzz"] },
      { id: "emoji", ids: ["fluent-emoji-flat", "noto"] },
    ]);
  });

  it("витрина — 9 иконок: свои шесть, затем знакомые имена набора", () => {
    const c = parseCollection({
      prefix: "x",
      title: "X",
      total: 12,
      uncategorized: ["a", "b", "c", "d", "e", "f", "star", "heart", "g", "h"],
    });
    expect(showcase(["a", "b", "zz"], c)).toEqual([
      "a",
      "b",
      "star",
      "heart",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
  });
});

describe("карточки набора (шаг 3 фазы 4, ADR-0052)", () => {
  // Как /collection у Phosphor: суффиксы и стили — без дефиса, алиас-переименование.
  const ph = parseCollection({
    prefix: "ph",
    title: "Phosphor",
    total: 7,
    categories: {
      Buildings: ["house", "house-fill", "house-bold"],
      Health: ["heart", "heart-fill"],
    },
    uncategorized: ["acorn"],
    aliases: { home: "house" },
    suffixes: { "": "Regular", bold: "Bold", fill: "Fill" },
    styles: { outline: ["", "bold"], filled: ["fill"] },
  });

  it("поиск по набору — по имени базы и вариантов, пробелы и дефисы — одно", () => {
    const { cards } = setCards(ph);
    expect(filterCards(cards, "").map((c) => c.base)).toEqual([
      "acorn",
      "heart",
      "house",
    ]);
    expect(filterCards(cards, "  HOU ").map((c) => c.base)).toEqual(["house"]);
    expect(filterCards(cards, "house fill").map((c) => c.base)).toEqual([
      "house",
    ]);
    expect(filterCards(cards, "bold").map((c) => c.base)).toEqual(["house"]);
    expect(filterCards(cards, "zebra")).toEqual([]);
    expect(nameQuery(" Arrow  Up_Right- ")).toBe("arrow-up-right");
  });

  it("варианты сворачиваются в карточку, у карточки — главное имя стиля", () => {
    const set = setCards(ph);
    expect(set.cards.map((c) => c.base)).toEqual(["acorn", "heart", "house"]);
    expect(set.cards.find((c) => c.base === "house")?.styles).toEqual({
      outline: "house",
      filled: "house-fill",
    });
    expect(set.cardOf.get("home")).toBe("house");
    expect(setStyles(ph)).toEqual(["outline", "filled"]);
  });

  it("категории и стиль — по карточкам; имя для показа — по стилю", () => {
    const set = setCards(ph);
    const buildings = categoryCards(["house", "house-fill", "house-bold"], set);
    expect(buildings.map((c) => c.base)).toEqual(["house"]);
    const filled = cardsInStyle(set.cards, "filled");
    expect(filled.map((c) => shownName(c, "filled"))).toEqual([
      "heart-fill",
      "house-fill",
    ]);
    expect(cardsInStyle(set.cards).map((c) => shownName(c))).toEqual([
      "acorn",
      "heart",
      "house",
    ]);
  });

  it("стили — дополнение Iconavo: не по формату — ошибка, нет — карточки без стилей", () => {
    expect(() =>
      parseCollection({ ...ph, styles: { outline: "house" } }),
    ).toThrow(/СТОП/);
    const bare = parseCollection({
      prefix: "x",
      title: "X",
      total: 1,
      uncategorized: ["a"],
    });
    expect(setStyles(bare)).toEqual([]);
    expect(setCards(bare).cards[0]?.styles).toEqual({});
  });
});

describe("сведения о наборе для панели иконки", () => {
  it("только название, автор, лицензия без текста и цветность", () => {
    const full = {
      ...INFO,
      license: {
        title: "ISC",
        spdx: "ISC",
        url: "https://example.com/license",
        text: "ISC License. Copyright …",
        source: "LICENSE",
        revision: "81875c8",
      },
    };
    expect(panelSet(full)).toEqual({
      name: "Lucide",
      author: { name: "Lucide Contributors", url: "https://lucide.dev" },
      license: {
        title: "ISC",
        spdx: "ISC",
        url: "https://example.com/license",
      },
      palette: false,
    });
  });

  it("нет адресов автора и лицензии — нет и полей", () => {
    expect(
      panelSet({ ...INFO, author: { name: "Someone" }, palette: true }),
    ).toEqual({
      name: "Lucide",
      author: { name: "Someone" },
      license: { title: "ISC", spdx: "ISC" },
      palette: true,
    });
  });
});
