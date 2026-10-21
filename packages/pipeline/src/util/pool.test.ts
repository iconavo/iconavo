import { describe, expect, it } from "vitest";
import { pool } from "./pool.js";

describe("pool", () => {
  it("обрабатывает все элементы, одновременно — не больше limit", async () => {
    const seen: number[] = [];
    let running = 0;
    let peak = 0;
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(n);
      running--;
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it("пустой список и limit больше списка", async () => {
    let calls = 0;
    await pool([], 4, async () => {
      calls++;
    });
    expect(calls).toBe(0);
    await pool([1, 2], 10, async () => {
      calls++;
    });
    expect(calls).toBe(2);
  });
});
