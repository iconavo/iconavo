import { describe, expect, it } from "vitest";
import { CHECKS, catalogExpectOf } from "./check.js";

describe("ожидания сценария «Каталог»", () => {
  it("имена набора — без повторов, по кодам символов; категории — так же; цветные наборы", () => {
    const e = catalogExpectOf(
      {
        lucide: { palette: false },
        "fluent-emoji-flat": { palette: true },
        ph: {},
      },
      {
        categories: { arrows: ["arrow-up", "a-2", "arrow-up"], b: ["Z", "a"] },
        uncategorized: ["house", "a"],
      },
      "8d1ee623",
    );
    expect(e).toEqual({
      version: "8d1ee623",
      names: ["Z", "a", "a-2", "arrow-up", "house"],
      categories: { arrows: ["a-2", "arrow-up"], b: ["Z", "a"] },
      sets: 3,
      colorSets: 1,
    });
  });

  it("строка «Каталог» — перед контрольным запуском", () => {
    const ids = CHECKS.map(([id]) => id);
    expect(ids.indexOf("catalog")).toBe(ids.indexOf("canary") - 1);
  });
});
