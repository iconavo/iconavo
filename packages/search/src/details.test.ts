import { describe, expect, it } from "vitest";
import {
  cardVariants,
  iconQuery,
  parseAbout,
  parseIconResult,
  shownInStyle,
  similarBody,
  styleOf,
} from "./details.js";

describe("cardVariants", () => {
  it("стили — по шкале, внутри — порядок таблицы набора (Phosphor)", () => {
    const groups = cardVariants(
      {
        icon: "ph:house",
        variants: [
          "house-bold",
          "house-duotone",
          "house-fill",
          "house-light",
          "house-thin",
        ],
        tones: [],
        styles: {
          outline: "house",
          filled: "house-fill",
          duotone: "house-duotone",
        },
      },
      {
        duotone: ["-duotone"],
        filled: ["-fill"],
        outline: ["-thin", "-light", "", "-bold"],
      },
    );
    expect(groups).toEqual([
      {
        style: "outline",
        icons: ["ph:house-thin", "ph:house-light", "ph:house", "ph:house-bold"],
      },
      { style: "filled", icons: ["ph:house-fill"] },
      { style: "duotone", icons: ["ph:house-duotone"] },
    ]);
  });

  it("главное имя стиля — и алиасом, двойники-алиасы не показываются (Material Symbols)", () => {
    const groups = cardVariants(
      {
        icon: "material-symbols:add",
        // add-outline и add-sharp — алиасы add: их нет среди видимых вариантов.
        variants: ["add-rounded", "add-outline-rounded"],
        tones: [],
        styles: { filled: "add", outline: "add-outline" },
      },
      {
        filled: ["", "-rounded", "-sharp"],
        outline: ["-outline", "-outline-rounded", "-outline-sharp"],
      },
    );
    expect(groups).toEqual([
      {
        style: "outline",
        icons: [
          "material-symbols:add-outline",
          "material-symbols:add-outline-rounded",
        ],
      },
      {
        style: "filled",
        icons: ["material-symbols:add", "material-symbols:add-rounded"],
      },
    ]);
    expect(styleOf("material-symbols:add-rounded", groups)).toBe("filled");
    expect(styleOf("material-symbols:other", groups)).toBeNull();
  });

  it("без таблицы стилей — пусто", () => {
    expect(
      cardVariants(
        { icon: "x:a", variants: [], tones: [], styles: {} },
        undefined,
      ),
    ).toEqual([]);
  });
});

describe("shownInStyle", () => {
  const hit = {
    icon: "ph:house",
    variants: [],
    tones: [],
    styles: { outline: "house", filled: "house-fill" },
  };

  it("имя в нужном стиле, если он у карточки есть, иначе база", () => {
    expect(shownInStyle(hit, "filled")).toBe("ph:house-fill");
    expect(shownInStyle(hit, "duotone")).toBe("ph:house");
    expect(shownInStyle(hit, null)).toBe("ph:house");
  });
});

describe("запросы и разбор", () => {
  it("карточка по любому имени: фильтр names и поля с about", () => {
    expect(iconQuery("lucide:home")).toEqual({
      indexUid: "icons",
      q: "",
      filter: ['names = "lucide:home"'],
      limit: 1,
      attributesToRetrieve: ["icon", "variants", "tones", "styles", "about"],
    });
    expect(() => iconQuery('lucide:" OR set = "x')).toThrow(/неверное имя/);
  });

  it("похожие — по id документа и эмбеддеру поиска", () => {
    expect(similarBody("material-symbols:add")).toEqual({
      id: "material-symbols_add",
      embedder: "gemini",
      limit: 12,
      attributesToRetrieve: ["icon", "styles"],
    });
  });

  it("карточка с about; нет карточки — undefined; about не по форме — исключение", () => {
    const about = {
      en: { description: "A house", synonyms: ["home"] },
      ru: { description: "Дом", synonyms: ["жилище"] },
      tags: ["home"],
    };
    expect(
      parseIconResult({
        hits: [{ icon: "lucide:house", variants: [], tones: [], about }],
      }),
    ).toEqual({
      icon: "lucide:house",
      variants: [],
      tones: [],
      styles: {},
      about,
    });
    expect(parseIconResult({ hits: [] })).toBeUndefined();
    expect(() => parseAbout({ tags: "home" }, "x")).toThrow(/about/);
    expect(() =>
      parseAbout({ tags: [], en: { description: 1, synonyms: [] } }, "x"),
    ).toThrow(/описание/);
    // Индекс до шага 4 фазы 4 — about нет.
    expect(parseAbout(undefined, "x")).toEqual({ tags: [] });
  });
});
