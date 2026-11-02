import { describe, expect, it } from "vitest";
import { baseName, groupCards, TONE_SUFFIXES } from "./cards.js";
import { isStyle, STYLES, styleCandidates } from "./styles.js";

const cardsOf = (input: Parameters<typeof groupCards>[0]) =>
  Object.fromEntries(groupCards(input).cards.map((c) => [c.base, c]));

describe("шкала стилей", () => {
  it("четыре стиля в порядке показа", () => {
    expect(STYLES).toEqual(["outline", "filled", "duotone", "color"]);
    expect(isStyle("filled")).toBe(true);
    expect(isStyle("fill")).toBe(false);
    expect(isStyle(undefined)).toBe(false);
  });

  it("главный вариант стиля — без суффикса, если он в стиле, затем порядок таблицы", () => {
    expect(styleCandidates(["-thin", "-light", "", "-bold"])).toEqual([
      "",
      "-thin",
      "-light",
      "-bold",
    ]);
    expect(styleCandidates(["-outline", "-outline-rounded"])).toEqual([
      "-outline",
      "-outline-rounded",
    ]);
  });
});

describe("baseName", () => {
  const names = new Set(["home", "home-outline", "done-outline"]);
  const has = (n: string) => names.has(n);

  it("снимает суффикс, если основа есть в наборе", () => {
    expect(baseName("home-outline", ["", "-outline"], has)).toBe("home");
    expect(baseName("done-outline", ["", "-outline"], has)).toBe(
      "done-outline",
    );
  });
});

describe("groupCards", () => {
  it("Phosphor: шесть начертаний — одна карточка, у стилей главные имена", () => {
    const weights = ["", "-thin", "-light", "-bold", "-fill", "-duotone"];
    const cards = cardsOf({
      names: weights.map((s) => `house${s}`),
      suffixes: weights,
      styles: {
        outline: ["-thin", "-light", "", "-bold"],
        filled: ["-fill"],
        duotone: ["-duotone"],
      },
    });
    expect(Object.keys(cards)).toEqual(["house"]);
    expect(cards.house?.variants).toEqual([
      "house-bold",
      "house-duotone",
      "house-fill",
      "house-light",
      "house-thin",
    ]);
    expect(cards.house?.styles).toEqual({
      outline: "house",
      filled: "house-fill",
      duotone: "house-duotone",
    });
    // Стили — в порядке шкалы, а не в порядке таблицы набора.
    expect(Object.keys(cards.house?.styles ?? {})).toEqual([
      "outline",
      "filled",
      "duotone",
    ]);
  });

  it("Material Symbols: контур бывает алиасом того же рисунка", () => {
    const set = groupCards({
      names: ["add", "add-rounded", "home", "home-outline"],
      aliases: [
        ["add-outline", "add"],
        ["add-outline-rounded", "add-rounded"],
      ],
      suffixes: ["", "-rounded", "-outline", "-outline-rounded"],
      styles: {
        filled: ["", "-rounded"],
        outline: ["-outline", "-outline-rounded"],
      },
    });
    const cards = Object.fromEntries(set.cards.map((c) => [c.base, c]));
    expect(cards.add?.styles).toEqual({
      outline: "add-outline",
      filled: "add",
    });
    expect(cards.add?.variants).toEqual(["add-rounded"]);
    expect(cards.home?.styles).toEqual({
      outline: "home-outline",
      filled: "home",
    });
    expect(set.cardOf.get("add-outline")).toBe("add");
    expect(set.cardOf.get("add-outline-rounded")).toBe("add");
  });

  it("основы нет — имя с суффиксом само становится карточкой своего основного стиля", () => {
    // Как done-outline у Material Symbols: иконки done нет.
    const cards = cardsOf({
      names: ["done-outline", "done-outline-rounded"],
      aliases: [["done-outline-outline", "done-outline"]],
      suffixes: ["", "-rounded", "-outline", "-outline-rounded"],
      styles: {
        filled: ["", "-rounded"],
        outline: ["-outline", "-outline-rounded"],
      },
    });
    expect(Object.keys(cards)).toEqual(["done-outline"]);
    expect(cards["done-outline"]?.styles).toEqual({
      outline: "done-outline-outline",
      filled: "done-outline",
    });
  });

  it("Tabler: заливка есть не у всех — у остальных только контур", () => {
    const cards = cardsOf({
      names: ["heart", "heart-filled", "arrow"],
      suffixes: ["", "-filled"],
      styles: { outline: [""], filled: ["-filled"] },
    });
    expect(cards.heart?.styles).toEqual({
      outline: "heart",
      filled: "heart-filled",
    });
    expect(cards.arrow?.styles).toEqual({ outline: "arrow" });
  });

  it("набор без карты вариантов: каждая иконка — своя карточка", () => {
    const cards = cardsOf({
      names: ["house", "house-plus"],
      suffixes: [],
      styles: { outline: [""] },
    });
    expect(Object.keys(cards)).toEqual(["house", "house-plus"]);
    expect(cards["house-plus"]?.styles).toEqual({ outline: "house-plus" });
  });

  it("оттенки кожи — в карточке основы, только если есть все пять", () => {
    const cards = cardsOf({
      names: [
        "waving-hand",
        ...TONE_SUFFIXES.map((t) => `waving-hand${t}`),
        "police-car",
        "police-car-light",
      ],
      suffixes: [],
      styles: { color: [""] },
    });
    expect(Object.keys(cards)).toEqual([
      "police-car",
      "police-car-light",
      "waving-hand",
    ]);
    expect(cards["waving-hand"]?.tones).toEqual(
      TONE_SUFFIXES.map((t) => `waving-hand${t}`),
    );
    expect(cards["waving-hand"]?.variants).toEqual([]);
    expect(cards["waving-hand"]?.styles).toEqual({ color: "waving-hand" });
    expect(cards["police-car"]?.tones).toEqual([]);
  });

  it("алиас из чужой карточки стилем не считается", () => {
    const cards = cardsOf({
      names: ["a", "b"],
      aliases: [["a-outline", "b"]],
      suffixes: ["", "-outline"],
      styles: { filled: [""], outline: ["-outline"] },
    });
    expect(cards.a?.styles).toEqual({ filled: "a" });
  });

  it("алиас скрытой иконки в карточки не попадает", () => {
    const set = groupCards({
      names: ["a"],
      aliases: [["old", "gone"]],
      suffixes: [],
    });
    expect(set.cardOf.has("old")).toBe(false);
  });

  it("без таблицы стилей у карточек нет стилей", () => {
    expect(cardsOf({ names: ["a"], suffixes: [] }).a?.styles).toEqual({});
  });
});
