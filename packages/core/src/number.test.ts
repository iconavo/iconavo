import { describe, expect, it } from "vitest";
import { cleanNumber, formatNumber } from "./number.js";

describe("formatNumber", () => {
  it("без шума плавающей точки, без минус нуля и без экспоненты у малых чисел", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(-0)).toBe("0");
    expect(cleanNumber(-0)).toBe(0);
    expect(formatNumber(1e-7)).toBe("0.0000001");
    expect(formatNumber(32 / 33)).toBe("0.969696969697");
  });

  it("огромные числа сохраняют показатель степени (ревизия фазы 5, П-4)", () => {
    expect(formatNumber(1e30)).toBe("1e+30");
    expect(formatNumber(1e21)).toBe("1e+21");
    expect(formatNumber(-2e40)).toBe("-2e+40");
    expect(Number(formatNumber(1e30))).toBe(1e30);
  });

  it("крошечное отрицательное — 0, а не «-0»", () => {
    expect(formatNumber(-1e-25)).toBe("0");
    expect(formatNumber(1e-25)).toBe("0");
  });
});
