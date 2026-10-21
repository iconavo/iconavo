import type { SearchEntry } from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import { MODELS } from "./config.js";
import { iconText, queryInput, textHash } from "./text.js";

const cart: SearchEntry = {
  fingerprint: "599cf94729e4",
  tags: ["trolley", "cart", "basket"],
  en: {
    description: "Shows an empty shopping trolley.",
    synonyms: ["basket", "trolley", "store", "buy", "purchase"],
  },
  ru: {
    description: "Изображена пустая тележка для покупок.",
    synonyms: ["корзина", "корзинка", "тележка", "покупки", "магазин"],
  },
  promptVersion: 1,
};

const model = (key: string) => {
  const m = MODELS.find((x) => x.key === key);
  if (!m) throw new Error(`нет модели ${key}`);
  return m;
};

describe("текст иконки", () => {
  it("имя, теги, затем описание и синонимы en и ru — по строке", () => {
    expect(iconText("shopping-cart", cart)).toBe(
      [
        "shopping cart",
        "trolley, cart, basket",
        "Shows an empty shopping trolley.",
        "basket, trolley, store, buy, purchase",
        "Изображена пустая тележка для покупок.",
        "корзина, корзинка, тележка, покупки, магазин",
      ].join("\n"),
    );
  });

  it("без тегов строки тегов нет, лишние пробелы схлопываются", () => {
    const text = iconText("cart", {
      ...cart,
      tags: [],
      en: { ...cart.en, description: "  Shows   a cart. " } as never,
    });
    expect(text?.split("\n")).toEqual([
      "cart",
      "Shows a cart.",
      "basket, trolley, store, buy, purchase",
      "Изображена пустая тележка для покупок.",
      "корзина, корзинка, тележка, покупки, магазин",
    ]);
  });

  it("без описаний текста нет", () => {
    expect(
      iconText("cart", { fingerprint: "599cf94729e4", tags: ["cart"] }),
    ).toBeUndefined();
  });

  it("хэш — 16 символов и меняется от любой части текста", () => {
    const base = iconText("shopping-cart", cart) as string;
    expect(textHash(base)).toMatch(/^[0-9a-f]{16}$/);
    expect(textHash(base)).toBe(textHash(base));
    const changed = [
      iconText("cart", cart),
      iconText("shopping-cart", { ...cart, tags: ["cart"] }),
      iconText("shopping-cart", {
        ...cart,
        ru: { ...cart.ru, synonyms: ["корзина", "a", "b", "c", "d"] } as never,
      }),
    ];
    for (const text of changed) {
      expect(textHash(text as string)).not.toBe(textHash(base));
    }
  });

  it("инструкция — только у запросов Qwen, «Query:» без пробела", () => {
    expect(queryInput(model("openai"), "  корзина ")).toBe("корзина");
    expect(queryInput(model("gemini"), "trash")).toBe("trash");
    expect(queryInput(model("qwen"), "корзина")).toBe(
      `Instruct: ${model("qwen").queryInstruction}\nQuery:корзина`,
    );
    // В текст иконки инструкция не попадает.
    expect(iconText("shopping-cart", cart)).not.toContain("Instruct");
  });
});
