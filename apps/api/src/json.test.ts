import { describe, expect, it } from "vitest";
import { compactJson } from "./json.js";

describe("compactJson", () => {
  it("ключи по кодам символов, и ключи-числа тоже — в отличие от JSON.stringify", () => {
    const value = { b: 1, "10": 2, "9": 3, a: { y: [1, "x"], x: null } };
    expect(JSON.stringify(value)).toBe(
      '{"9":3,"10":2,"b":1,"a":{"y":[1,"x"],"x":null}}',
    );
    expect(compactJson(value)).toBe(
      '{"10":2,"9":3,"a":{"x":null,"y":[1,"x"]},"b":1}',
    );
  });

  it("строки экранируются, нечисла — ошибка", () => {
    expect(compactJson({ s: '"</svg>' })).toBe('{"s":"\\"</svg>"}');
    expect(() => compactJson({ n: Number.NaN })).toThrow();
  });
});
