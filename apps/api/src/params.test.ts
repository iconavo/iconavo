import { describe, expect, it } from "vitest";
import { ApiError } from "./http.js";
import { parseBool, parseColor, parseNames, single } from "./params.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ApiError ? e.code : "не ApiError";
  }
  return "без ошибки";
};

describe("parseColor", () => {
  it("hex с # и без, имена и функции rgb/hsl", () => {
    expect(parseColor("FF0000")).toBe("#ff0000");
    expect(parseColor("#abc")).toBe("#abc");
    expect(parseColor("#11223344")).toBe("#11223344");
    expect(parseColor("Red")).toBe("red");
    expect(parseColor("rebeccapurple")).toBe("rebeccapurple");
    expect(parseColor("rgb(255, 0, 0)")).toBe("rgb(255, 0, 0)");
    expect(parseColor("rgba(255,0,0,.5)")).toBe("rgba(255,0,0,.5)");
    expect(parseColor("rgb(255 0 0 / 50%)")).toBe("rgb(255 0 0 / 50%)");
    expect(parseColor("hsl(120deg, 100%, 50%)")).toBe("hsl(120deg, 100%, 50%)");
  });

  it("всё остальное — 400: в разметку не попадёт ничего чужого", () => {
    for (const value of [
      "#12",
      "#12345",
      "red'",
      'red"',
      "red;",
      "url(x)",
      "var(--x)",
      "rgb(1,2)",
      "rgb(1,2,3,4,5)",
      "rgb(1,2,3",
      "hsl(a,b,c)",
      "red blue",
      "<b>",
      "rgb(1\u000b2\u000c3)",
      "rgb(1\t2\t3)",
    ]) {
      expect(
        code(() => parseColor(value)),
        value,
      ).toBe("invalid_color");
    }
  });
});

describe("parseNames", () => {
  it("по запятой, без пустых и повторов, по кодам символов", () => {
    const q = new URLSearchParams("icons=home,heart,,home,9,10");
    expect(parseNames(q)).toEqual(["10", "9", "heart", "home"]);
  });

  it("+ — пробел, %2C — запятая", () => {
    expect(parseNames(new URLSearchParams("icons=a+b%2Cc"))).toEqual([
      "a b",
      "c",
    ]);
  });

  it("нет имён, повтор параметра, больше 100 — 400", () => {
    expect(code(() => parseNames(new URLSearchParams("")))).toBe(
      "icons_required",
    );
    expect(code(() => parseNames(new URLSearchParams("icons=,")))).toBe(
      "icons_required",
    );
    expect(code(() => parseNames(new URLSearchParams("icons=a&icons=b")))).toBe(
      "duplicate_parameter",
    );
    const many = Array.from({ length: 101 }, (_, i) => `i${i}`).join(",");
    expect(code(() => parseNames(new URLSearchParams(`icons=${many}`)))).toBe(
      "too_many_icons",
    );
    const hundred = Array.from({ length: 100 }, (_, i) => `i${i}`).join(",");
    expect(parseNames(new URLSearchParams(`icons=${hundred}`))).toHaveLength(
      100,
    );
  });
});

describe("single и parseBool", () => {
  it("пустое — как нет, слишком длинное и повтор — 400", () => {
    expect(single(new URLSearchParams("a="), "a")).toBeUndefined();
    expect(
      code(() => single(new URLSearchParams(`a=${"x".repeat(65)}`), "a")),
    ).toBe("invalid_parameter");
    expect(code(() => single(new URLSearchParams("a=1&a=2"), "a"))).toBe(
      "duplicate_parameter",
    );
  });

  it("флажки 1/true/yes и 0/false/no", () => {
    expect(parseBool("box", "1")).toBe(true);
    expect(parseBool("box", "yes")).toBe(true);
    expect(parseBool("box", "false")).toBe(false);
    expect(parseBool("box", undefined)).toBe(false);
    expect(code(() => parseBool("box", "2"))).toBe("invalid_parameter");
  });
});
