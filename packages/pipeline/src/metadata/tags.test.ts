import { describe, expect, it } from "vitest";
import { authorTags, nameTags } from "./tags.js";

describe("теги автора", () => {
  it("строчные, без пробелов по краям, повторов, пустых и служебных пометок", () => {
    expect(
      authorTags([
        "*new*",
        " Home ",
        "home",
        "HOUSE",
        "real  estate",
        "",
        "*updated*",
        "Ø",
      ]),
    ).toEqual(["home", "house", "real estate", "ø"]);
  });

  it("числа — строками, всё остальное пропускается", () => {
    expect(authorTags([911, 0, null, undefined, {}, ["x"], "zero"])).toEqual([
      "911",
      "0",
      "zero",
    ]);
  });

  it("порядок автора сохраняется", () => {
    expect(authorTags(["b", "a", "c"])).toEqual(["b", "a", "c"]);
  });
});

describe("теги из частей имени", () => {
  const SUFFIXES = ["", "-rounded", "-outline", "-outline-rounded"];
  const has = (names: string[]) => (n: string) => names.includes(n);

  it("основа без суффикса варианта, по дефисам", () => {
    expect(
      nameTags(
        "arrow-back-ios-new-outline-rounded",
        SUFFIXES,
        has(["arrow-back-ios-new"]),
      ),
    ).toEqual(["arrow", "back", "ios", "new"]);
  });

  it("если основы нет в наборе, суффикс — часть имени", () => {
    expect(
      nameTags("done-outline-rounded", SUFFIXES, has(["done-outline"])),
    ).toEqual(["done", "outline"]);
  });

  it("без суффиксов — всё имя; повторы убираются", () => {
    expect(nameTags("360", [], has([]))).toEqual(["360"]);
    expect(nameTags("arrow-up-arrow-down", [], has([]))).toEqual([
      "arrow",
      "up",
      "down",
    ]);
  });
});
