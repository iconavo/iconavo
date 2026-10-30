import { describe, expect, it } from "vitest";
import {
  categoriesOf,
  categorySlug,
  orderSets,
  PAGE_SIZE,
  pageCount,
  pageItems,
  pageOf,
  pageParam,
  parseCollection,
  parseReleases,
  parseSets,
  releaseCounts,
  revisionLabel,
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
    const card = setSummary("ru", "lucide", INFO);
    expect({ ...card, total: spaces(card.total) }).toEqual({
      id: "lucide",
      name: "Lucide",
      total: "1 998 иконок",
      author: "Lucide Contributors",
      license: "ISC",
      licenseId: "ISC",
      palette: false,
      samples: ["house", "heart"],
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
