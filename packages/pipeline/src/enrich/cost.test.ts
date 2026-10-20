import { describe, expect, it } from "vitest";
import { BATCH_PRICES, EST_INPUT_TOKENS, EST_OUTPUT_TOKENS } from "./config.js";
import { estimateCost, formatUsd, sumCost } from "./cost.js";

describe("стоимость", () => {
  it("оценка — по константам на запрос", () => {
    expect(estimateCost(0)).toBe(0);
    expect(estimateCost(50)).toBeCloseTo(
      (50 *
        (EST_INPUT_TOKENS * BATCH_PRICES.input +
          EST_OUTPUT_TOKENS * BATCH_PRICES.output)) /
        1e6,
      9,
    );
  });

  it("факт — по usage ответов, включая кэш промпта", () => {
    const c = sumCost([
      { input_tokens: 1000, output_tokens: 2000 },
      { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 1000 },
    ]);
    expect(c).toMatchObject({
      requests: 2,
      input: 2000,
      output: 2000,
      cacheWrite: 0,
      cacheRead: 1000,
    });
    expect(c.usd).toBeCloseTo(
      (2000 * 0.05 + 2000 * 0.25 + 1000 * 0.005) / 1e6,
      12,
    );
  });

  it("доллары с запятой: мелкие суммы с четырьмя знаками", () => {
    expect(formatUsd(0.000605)).toBe("$0,0006");
    expect(formatUsd(5.7)).toBe("$5,70");
    expect(formatUsd(1)).toBe("$1,00");
  });
});
