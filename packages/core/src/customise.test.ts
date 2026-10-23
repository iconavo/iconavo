import { describe, expect, it } from "vitest";
import { parseFlip, parseRotate, parseSize } from "./customise.js";

describe("parseRotate", () => {
  it("четверти, градусы и проценты — как у Iconify", () => {
    expect(parseRotate("0")).toBe(0);
    expect(parseRotate("1")).toBe(1);
    expect(parseRotate("3")).toBe(3);
    expect(parseRotate("-1")).toBe(3);
    expect(parseRotate("90deg")).toBe(1);
    expect(parseRotate("180deg")).toBe(2);
    expect(parseRotate("270deg")).toBe(3);
    expect(parseRotate("-90deg")).toBe(3);
    expect(parseRotate("360deg")).toBe(0);
    expect(parseRotate("450deg")).toBe(1);
    expect(parseRotate("25%")).toBe(1);
    expect(parseRotate("75%")).toBe(3);
  });

  it("строже Iconify: «90» без единицы, дробные доли и чужие единицы — ошибка", () => {
    expect(parseRotate("90")).toBeNull();
    expect(parseRotate("4")).toBeNull();
    expect(parseRotate("45deg")).toBeNull();
    expect(parseRotate("1.5")).toBeNull();
    expect(parseRotate("10%")).toBeNull();
    expect(parseRotate("1turn")).toBeNull();
    expect(parseRotate("+1")).toBeNull();
    expect(parseRotate(" 1")).toBeNull();
    expect(parseRotate("")).toBeNull();
  });
});

describe("parseFlip", () => {
  it("horizontal, vertical и оба — через запятую или пробел", () => {
    expect(parseFlip("horizontal")).toEqual({ hFlip: true, vFlip: false });
    expect(parseFlip("vertical")).toEqual({ hFlip: false, vFlip: true });
    expect(parseFlip("horizontal,vertical")).toEqual({
      hFlip: true,
      vFlip: true,
    });
    expect(parseFlip("vertical horizontal")).toEqual({
      hFlip: true,
      vFlip: true,
    });
    expect(parseFlip("horizontal,horizontal")).toEqual({
      hFlip: true,
      vFlip: false,
    });
  });

  it("неизвестное слово — ошибка, а не тихо пропущено", () => {
    expect(parseFlip("h")).toBeNull();
    expect(parseFlip("Horizontal")).toBeNull();
    expect(parseFlip("horizontal,diagonal")).toBeNull();
  });
});

describe("parseSize", () => {
  it("число с единицей CSS или без и ключевые слова", () => {
    for (const value of ["24", "1.5em", ".5rem", "50%", "64px", "auto"]) {
      expect(parseSize(value)).toBe(value);
    }
    expect(parseSize("unset")).toBe("unset");
    expect(parseSize("none")).toBe("none");
  });

  it("всё остальное — ошибка: в атрибут SVG не попадёт ничего лишнего", () => {
    for (const value of ["", "-1", "1e3", "abc", "10px 1px", '1"', "1em;"]) {
      expect(parseSize(value)).toBeNull();
    }
  });
});
