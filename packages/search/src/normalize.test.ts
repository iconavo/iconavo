import { describe, expect, it } from "vitest";
import {
  exactName,
  nameForm,
  normalizeText,
  stripSetPrefix,
} from "./normalize.js";

describe("normalizeText", () => {
  it.each([
    ["  Shopping-Cart ", "shopping cart"],
    ["Ёлка", "елка"],
    ["a_b  c", "a b c"],
    ["Дом\tи\nсад", "дом и сад"],
    ["a\u0000b", "a b"],
    ["éte", "éte"],
    ["ЗНАЧОК ДОМА", "значок дома"],
    ["   ", ""],
  ])("%j → %j", (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe("nameForm и exactName", () => {
  it("запрос как имя иконки", () => {
    expect(nameForm("Shopping Cart")).toBe("shopping-cart");
    expect(nameForm(" Lucide:House ")).toBe("lucide:house");
  });

  it.each([
    ["Shopping Cart", "shopping-cart"],
    ["lucide:house", "lucide:house"],
    ["house", "house"],
    ["дом", undefined],
    ["a:b:c", undefined],
    ["-x", undefined],
    ["", undefined],
    ['house" OR 1', undefined],
  ])("%j → %j", (input, expected) => {
    expect(exactName(input)).toBe(expected);
  });
});

describe("stripSetPrefix", () => {
  const isSet = (id: string) => id === "lucide" || id === "ph";

  it("снимает префикс известного набора", () => {
    expect(stripSetPrefix("lucide:house", isSet)).toBe("house");
    expect(stripSetPrefix("  Lucide:Дом", isSet)).toBe("Дом");
    expect(stripSetPrefix("ph:", isSet)).toBe("");
  });

  it("неизвестный набор — запрос как есть", () => {
    expect(stripSetPrefix("unknown:house", isSet)).toBe("unknown:house");
    expect(stripSetPrefix("время: 5 минут", isSet)).toBe("время: 5 минут");
  });

  it("набор на букву s — не путает префикс с пробелами (ошибка прототипа /^s*/)", () => {
    const withS = (id: string) => id === "sets";
    expect(stripSetPrefix(" sets:star", withS)).toBe("star");
    expect(stripSetPrefix("ssets:star", withS)).toBe("ssets:star");
  });
});
