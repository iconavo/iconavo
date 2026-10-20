import { describe, expect, it } from "vitest";
import type { NormalizedIcon } from "../normalize/normalize.js";
import { baseName, variantAliases } from "./aliases.js";

const ORDER = [
  "",
  "-sharp",
  "-rounded",
  "-outline",
  "-outline-sharp",
  "-outline-rounded",
];

const icon = (body: string, width = 24, height = 24): NormalizedIcon => ({
  body,
  width,
  height,
});
const set = (entries: Record<string, NormalizedIcon>) =>
  new Map(Object.entries(entries));
const aliasesOf = (entries: Record<string, NormalizedIcon>) =>
  Object.fromEntries(variantAliases(set(entries), ORDER));

describe("алиасы одинаковых вариантов", () => {
  it("контур, нарисованный как заливка, — алиас заливки", () => {
    expect(
      aliasesOf({
        add: icon("A"),
        "add-outline": icon("A"),
        home: icon("H"),
        "home-outline": icon("h"),
      }),
    ).toEqual({ "add-outline": "add" });
  });

  it("другое тело или другой размер — остаётся иконкой", () => {
    expect(
      aliasesOf({
        a: icon("A"),
        "a-sharp": icon("B"),
        "a-rounded": icon("A", 24, 25),
      }),
    ).toEqual({});
  });

  it("родитель — самый старший одинаковый вариант, а не обязательно заливка", () => {
    expect(
      aliasesOf({
        x: icon("F"),
        "x-sharp": icon("S"),
        "x-rounded": icon("S"),
        "x-outline": icon("O"),
        "x-outline-sharp": icon("O"),
        "x-outline-rounded": icon("S"),
      }),
    ).toEqual({
      "x-rounded": "x-sharp",
      "x-outline-sharp": "x-outline",
      "x-outline-rounded": "x-sharp",
    });
  });

  it("все шесть одинаковы — пять алиасов одной заливки, без цепочек", () => {
    const names = ORDER.map((suffix) => `360${suffix}`);
    const result = variantAliases(
      new Map(names.map((name) => [name, icon("Z")])),
      ORDER,
    );
    expect([...result.keys()].sort()).toEqual(names.slice(1).sort());
    for (const parent of result.values()) {
      expect(parent).toBe("360");
      expect(result.has(parent)).toBe(false);
    }
  });

  it("недостающие варианты не мешают", () => {
    expect(aliasesOf({ x: icon("A"), "x-outline-rounded": icon("A") })).toEqual(
      { "x-outline-rounded": "x" },
    );
  });

  it("основа — самая короткая существующая: done-outline не попадает в группу done", () => {
    // В Material Symbols есть иконка done_outline, а done — нет.
    expect(
      aliasesOf({
        "done-outline": icon("D"),
        "done-outline-outline": icon("D"),
        "done-outline-rounded": icon("R"),
        "done-outline-outline-rounded": icon("R"),
        "done-outline-sharp": icon("D"),
      }),
    ).toEqual({
      "done-outline-outline": "done-outline",
      "done-outline-outline-rounded": "done-outline-rounded",
      "done-outline-sharp": "done-outline",
    });
  });

  it("одинаковые иконки с разными основами алиасами не становятся", () => {
    expect(aliasesOf({ cat: icon("A"), dog: icon("A") })).toEqual({});
  });

  it("без суффиксов вариантов алиасов нет", () => {
    expect(
      Object.fromEntries(
        variantAliases(set({ a: icon("A"), "a-outline": icon("A") }), [""]),
      ),
    ).toEqual({});
  });
});

describe("основа имени варианта", () => {
  const names = new Set([
    "home",
    "home-outline",
    "home-outline-rounded",
    "done-outline",
    "done-outline-rounded",
    "traffic-light",
  ]);
  const base = (name: string, suffixes: readonly string[] = ORDER) =>
    baseName(name, suffixes, (n) => names.has(n));

  it("снимает самый длинный суффикс, после которого основа есть в наборе", () => {
    expect(base("home-outline-rounded")).toBe("home");
    expect(base("home-outline")).toBe("home");
    expect(base("home")).toBe("home");
  });

  it("основы нет в наборе — суффикс остаётся частью имени", () => {
    expect(base("done-outline-rounded")).toBe("done-outline");
    expect(base("done-outline")).toBe("done-outline");
  });

  it("суффикс-совпадение без основы не снимается: traffic-light — не light", () => {
    expect(base("traffic-light", ["", "-light"])).toBe("traffic-light");
  });
});
