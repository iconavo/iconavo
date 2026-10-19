import { describe, expect, it } from "vitest";
import { canonicalJson, type Json } from "./json.js";

describe("запись JSON", () => {
  it("ключи по кодам символов, ключи-числа не прыгают вперёд", () => {
    const text = canonicalJson({ a: 1, "360": 2, "1k": 3, "123": 4, "10k": 5 });
    const keys = [...text.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
    expect(keys).toEqual(["10k", "123", "1k", "360", "a"]);
  });

  it("порядок добавления ключей не влияет на результат", () => {
    const a: Json = {
      icons: { b: { body: "x" }, a: { body: "y" } },
      prefix: "p",
    };
    const b: Json = {
      prefix: "p",
      icons: { a: { body: "y" }, b: { body: "x" } },
    };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("сортирует вложенные объекты, массивы оставляет как есть", () => {
    expect(canonicalJson({ z: [3, { y: 1, x: 2 }], a: {} })).toBe(
      `{\n  "a": {},\n  "z": [\n    3,\n    {\n      "x": 2,\n      "y": 1\n    }\n  ]\n}\n`,
    );
  });

  it("если ключи уже по порядку, совпадает с JSON.stringify с отступом 2", () => {
    const data = {
      flag: true,
      height: 24,
      icons: {
        add: { body: '<path d="M0 0"/>' },
        home: { body: "x", width: 33.5 },
      },
      list: [],
      none: null,
      prefix: "demo",
    };
    expect(canonicalJson(data)).toBe(`${JSON.stringify(data, null, 2)}\n`);
  });

  it("строки экранируются, перевод строки — LF, в конце один перевод строки", () => {
    const text = canonicalJson({ body: '<g fill="none">\n</g>', ключ: "ё" });
    expect(text).toContain('"body": "<g fill=\\"none\\">\\n</g>"');
    expect(text).toContain('"ключ": "ё"');
    expect(text).not.toContain("\r");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("пустые объект и массив, простые значения", () => {
    expect(canonicalJson({})).toBe("{}\n");
    expect(canonicalJson([])).toBe("[]\n");
    expect(canonicalJson("a")).toBe('"a"\n');
    expect(canonicalJson(-0)).toBe("0\n");
  });

  it("не записывает undefined, NaN и бесконечность", () => {
    expect(() => canonicalJson({ a: undefined } as unknown as Json)).toThrow();
    expect(() => canonicalJson([Number.NaN])).toThrow(/NaN/);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
  });
});
