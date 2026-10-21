import { describe, expect, it } from "vitest";
import {
  hitAt,
  paired,
  pickAlpha,
  pickLength,
  precisionAt,
  reciprocalRank,
  summarize,
  wilson,
} from "./metrics.js";

const fits = new Set(["x", "y"]);

describe("метрики запроса", () => {
  it("Hit@5, MRR@10 и P@5", () => {
    const ranked = ["a", "b", "x", "c", "y", "d"];
    expect(hitAt(ranked, fits)).toBe(true);
    expect(hitAt(["a", "b", "c", "d", "e", "x"], fits)).toBe(false);
    expect(reciprocalRank(ranked, fits)).toBeCloseTo(1 / 3, 9);
    expect(
      reciprocalRank(
        ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "x"],
        fits,
      ),
    ).toBe(0);
    expect(precisionAt(ranked, fits)).toBeCloseTo(2 / 5, 9);
    // Мест меньше пяти — пустые не подходят.
    expect(precisionAt(["x"], fits)).toBeCloseTo(1 / 5, 9);
  });

  it("сводка: доля, интервал, MRR и P@5 по запросам", () => {
    const s = summarize([
      { ranked: ["x"], fits },
      { ranked: ["a", "y"], fits },
      { ranked: ["a"], fits },
      { ranked: [], fits },
    ]);
    expect(s).toMatchObject({ n: 4, hits: 2, hit: 0.5 });
    expect(s.mrr).toBeCloseTo((1 + 0.5) / 4, 9);
    expect(s.low).toBeLessThan(0.5);
    expect(s.high).toBeGreaterThan(0.5);
  });
});

describe("погрешность и сравнение", () => {
  it("интервал Уилсона — известные значения", () => {
    const { low, high } = wilson(80, 100);
    expect(low).toBeCloseTo(0.7112, 3);
    expect(high).toBeCloseTo(0.8667, 3);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 0 });
  });

  it("Мак-Немар: считаются только запросы, где нашёл один из двух", () => {
    const a = [true, true, true, true, true, true, true, false, true, true];
    const b = [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ];
    const r = paired(a, b);
    expect(r).toMatchObject({ onlyA: 7, onlyB: 0 });
    // 7 из 7 в одну сторону: 2 × 0,5⁷.
    expect(r.p).toBeCloseTo(2 / 128, 9);
    expect(paired([true, false], [false, true]).p).toBe(1);
    expect(paired([true], [true]).p).toBe(1);
  });
});

describe("правила выбора", () => {
  const point = (alpha: number, hit: number, mrr = 0.5) => ({
    alpha,
    hit,
    mrr,
  });

  it("α — середина лучшего плато", () => {
    expect(
      pickAlpha([
        point(0, 0.5),
        point(0.1, 0.7),
        point(0.2, 0.7),
        point(0.3, 0.7),
        point(0.4, 0.6),
      ]),
    ).toBe(0.2);
  });

  it("два плато — с лучшим средним MRR; чётное плато — середина с лучшим MRR", () => {
    expect(
      pickAlpha([
        point(0, 0.7, 0.4),
        point(0.1, 0.6),
        point(0.5, 0.7, 0.6),
        point(0.6, 0.7, 0.7),
      ]),
    ).toBe(0.6);
    expect(pickAlpha([point(0.3, 0.7, 0.5), point(0.4, 0.7, 0.5)])).toBe(0.3);
  });

  it("длина — самая короткая в пределах допуска от полной", () => {
    const points = [
      { length: 256, hit: 0.7, mrr: 0.5 },
      { length: 512, hit: 0.795, mrr: 0.595 },
      { length: 1024, hit: 0.8, mrr: 0.6 },
      { length: 3072, hit: 0.8, mrr: 0.6 },
    ];
    expect(pickLength(points, { hit: 0.01, mrr: 0.01 })).toBe(512);
    expect(pickLength(points, { hit: 0, mrr: 0 })).toBe(1024);
  });
});
