import { describe, expect, it } from "vitest";
import {
  convexSum,
  distributionOf,
  GOOD_ENOUGH,
  meiliMerge,
  shiftScore,
  type TieOf,
} from "./simulate.js";

const hits = (...pairs: [string, number][]) =>
  pairs.map(([icon, score]) => ({ icon, score }));

/** Ничьи: parts — по числу дефисов, порядок набора — по алфавиту набора. */
const tie: TieOf = (icon) => ({
  parts: icon.split(":")[1]?.split("-").length ?? 1,
  setOrder: icon.startsWith("a:") ? 0 : 1,
});

describe("shiftScore и distributionOf", () => {
  it("среднее → 0,5, среднее + разброс → 0,9, итог — в (0, 1]", () => {
    const d = { mean: 0.6, sigma: 0.05 };
    expect(shiftScore(0.6, d)).toBeCloseTo(0.5, 6);
    expect(shiftScore(0.65, d)).toBeCloseTo(0.9, 5);
    expect(shiftScore(0.9, d)).toBe(1);
    expect(shiftScore(0.1, d)).toBeGreaterThan(0);
    expect(shiftScore(0.1, d)).toBeLessThan(1e-6);
  });

  it("среднее и разброс с точностью до 3 знаков", () => {
    expect(distributionOf([0.6, 0.7, 0.8])).toEqual({
      mean: 0.7,
      sigma: 0.082,
    });
    expect(() => distributionOf([])).toThrow(/нет оценок/);
  });
});

describe("meiliMerge — копия слияния Meilisearch", () => {
  const words = hits(["a:trash", 1], ["b:bin", 0.9], ["a:cart", 0.5]);
  const meaning = hits(["b:can", 0.8], ["a:trash", 0.75], ["a:basket", 0.7]);

  it("доля 0,8: слова с весом 0,2 не обгоняют смысл — порядок смысла, повтор пропущен", () => {
    expect(meiliMerge(words, meaning, tie, { ratio: 0.8, limit: 10 })).toEqual([
      "b:can",
      "a:trash",
      "a:basket",
      "b:bin",
      "a:cart",
    ]);
  });

  it("доля 0 — только слова, без добора по смыслу; доля 1 — только смысл", () => {
    expect(meiliMerge(words, meaning, tie, { ratio: 0, limit: 10 })).toEqual([
      "a:trash",
      "b:bin",
      "a:cart",
    ]);
    expect(meiliMerge([], meaning, tie, { ratio: 0, limit: 10 })).toEqual([]);
    expect(meiliMerge(words, meaning, tie, { ratio: 1, limit: 10 })).toEqual([
      "b:can",
      "a:trash",
      "a:basket",
    ]);
  });

  it("доля 0,2: слова впереди, пока их взвешенная оценка выше", () => {
    expect(meiliMerge(words, meaning, tie, { ratio: 0.2, limit: 3 })).toEqual([
      "a:trash",
      "b:bin",
      "a:cart",
    ]);
  });

  it("равные взвешенные оценки — короткое имя, порядок набора, имя; потом смысл первым", () => {
    const w = hits(["b:x", 1]);
    const m = hits(["a:y-z", 1]);
    // 1 · 0,5 = 1 · 0,5: у b:x одна часть имени — она первая, хотя смысл обычно первый.
    expect(meiliMerge(w, m, tie, { ratio: 0.5, limit: 2 })).toEqual([
      "b:x",
      "a:y-z",
    ]);
    const same = hits(["a:x", 1]);
    expect(
      meiliMerge(same, hits(["a:x", 1]), tie, { ratio: 0.5, limit: 2 }),
    ).toEqual(["a:x"]);
  });

  it("короткий путь: слов хватает на страницу и все «достаточно хороши» — только слова", () => {
    const strong = hits(["a:one", 1], ["a:two", 1]);
    const m = hits(["b:far", 0.99]);
    expect(1 * 0.5).toBeGreaterThanOrEqual(GOOD_ENOUGH);
    expect(meiliMerge(strong, m, tie, { ratio: 0.5, limit: 2 })).toEqual([
      "a:one",
      "a:two",
    ]);
    // Слов меньше страницы — короткого пути нет.
    expect(meiliMerge(strong, m, tie, { ratio: 0.5, limit: 3 })).toContain(
      "b:far",
    );
  });

  it("калибровка поднимает смысл над словами", () => {
    const w = hits(["a:word", 1]);
    const m = hits(["b:meaning", 0.62]);
    // Без калибровки: 0,62 · 0,6 = 0,372 < 1 · 0,4. С калибровкой 0,62 → 1: 0,6 > 0,4.
    expect(meiliMerge(w, m, tie, { ratio: 0.6, limit: 2 })[0]).toBe("a:word");
    expect(
      meiliMerge(w, m, tie, {
        ratio: 0.6,
        limit: 2,
        distribution: { mean: 0.55, sigma: 0.04 },
      })[0],
    ).toBe("b:meaning");
  });
});

describe("convexSum — сумма слов и смысла, как у прототипа", () => {
  const words = hits(["a:trash", 0.5], ["b:bin", 0.4]);
  const meaning = hits(
    ["b:can", 0.9],
    ["a:trash", 0.8],
    ["a:basket", 0.7],
    ["b:bin", 0.6],
  );

  it("α = 1 — порядок смысла; α = 0 — порядок слов, без слов — по смыслу", () => {
    const o = { text: "abs" as const, limit: 10, normRank: 4 };
    expect(convexSum(words, meaning, tie, { ...o, alpha: 1 })).toEqual([
      "b:can",
      "a:trash",
      "a:basket",
      "b:bin",
    ]);
    expect(convexSum(words, meaning, tie, { ...o, alpha: 0 })).toEqual([
      "a:trash",
      "b:bin",
      "b:can",
      "a:basket",
    ]);
  });

  it("смысл нормирован между 1-м и normRank-м местом; ниже — ноль", () => {
    // normRank 2: b:can → 1, a:trash → 0, остальные ниже — 0. Слова решают между ними.
    expect(
      convexSum(words, meaning, tie, {
        alpha: 0.5,
        text: "abs",
        limit: 2,
        normRank: 2,
      }),
    ).toEqual(["b:can", "a:trash"]);
  });

  it("слова относительно лучшей в запросе: слабое совпадение становится полным", () => {
    const weak = hits(["a:typo", 0.3]);
    const m = hits(["b:can", 0.9], ["a:x", 0.8], ["a:typo", 0.7]);
    const o = { alpha: 0.5, limit: 1, normRank: 3 };
    expect(convexSum(weak, m, tie, { ...o, text: "abs" })).toEqual(["b:can"]);
    expect(convexSum(weak, m, tie, { ...o, text: "rel" })).toEqual(["b:can"]);
    expect(convexSum(weak, m, tie, { ...o, alpha: 0.4, text: "rel" })).toEqual([
      "a:typo",
    ]);
  });
});
