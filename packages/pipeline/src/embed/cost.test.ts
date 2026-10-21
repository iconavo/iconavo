import { describe, expect, it } from "vitest";
import { TEST_MODELS } from "./client.testing.js";
import {
  addSpent,
  estimateRub,
  formatRub,
  noSpent,
  rubOfTokens,
} from "./cost.js";

describe("стоимость", () => {
  const model = TEST_MODELS[0];
  if (!model) throw new Error("нет тестовой модели");

  it("оценка — 2,5 символа на токен по цене модели", () => {
    expect(estimateRub(model, 2_500_000)).toBeCloseTo(10, 9);
    expect(rubOfTokens(model, 1_000_000)).toBeCloseTo(10, 9);
  });

  it("сложение расходов и формат рублей", () => {
    const a = {
      ...noSpent(),
      requests: 1,
      texts: 2,
      tokens: 10,
      chars: 20,
      rub: 0.5,
    };
    const sum = addSpent(a, { ...a, rubCalculated: 0.5 });
    expect(sum).toEqual({
      requests: 2,
      texts: 4,
      tokens: 20,
      chars: 40,
      rub: 1,
      rubCalculated: 0.5,
    });
    expect(formatRub(0.01234)).toBe("0,0123 ₽");
    expect(formatRub(12.346)).toBe("12,35 ₽");
  });
});
