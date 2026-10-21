import { describe, expect, it } from "vitest";
import { parseEmbeddings, unitVector } from "./parse.js";

const answer = (
  data: { index?: number; embedding: unknown }[],
  usage: unknown = { prompt_tokens: 12, cost_rub: 0.5 },
) => ({ object: "list", model: "x", data, usage });

describe("разбор ответа /embeddings", () => {
  it("векторы — по index, длины 1, токены и рубли из usage", () => {
    const parsed = parseEmbeddings(
      answer([
        { index: 1, embedding: [0, 0, 3, 4] },
        { index: 0, embedding: [2, 0, 0, 0] },
      ]),
      2,
      4,
    );
    expect(Array.from(parsed.vectors[0] ?? [])).toEqual([1, 0, 0, 0]);
    expect(Array.from(parsed.vectors[1] ?? [])).toEqual([
      0,
      0,
      Math.fround(0.6),
      Math.fround(0.8),
    ]);
    expect(parsed.tokens).toBe(12);
    expect(parsed.rub).toBe(0.5);
  });

  it("без index — по порядку; без cost_rub — cost; без usage — пусто", () => {
    const p = parseEmbeddings(
      answer([{ embedding: [1, 0] }, { embedding: [0, 1] }], { cost: 0.2 }),
      2,
      2,
    );
    expect(Array.from(p.vectors[1] ?? [])).toEqual([0, 1]);
    expect(p.rub).toBe(0.2);
    expect(p.tokens).toBeUndefined();
    const none = parseEmbeddings(answer([{ embedding: [1, 0] }], null), 1, 2);
    expect(none.rub).toBeUndefined();
    expect(none.tokens).toBeUndefined();
  });

  it("ошибки: число векторов, номера, длина, строка base64, нечисла, нулевой вектор", () => {
    const ok = [1, 0];
    expect(() => parseEmbeddings(answer([{ embedding: ok }]), 2, 2)).toThrow(
      /векторов в ответе 1, а текстов 2/,
    );
    expect(() =>
      parseEmbeddings(
        answer([
          { index: 0, embedding: ok },
          { index: 0, embedding: ok },
        ]),
        2,
        2,
      ),
    ).toThrow(/повторяются/);
    expect(() =>
      parseEmbeddings(answer([{ index: 5, embedding: ok }]), 1, 2),
    ).toThrow(/выходят/);
    expect(() =>
      parseEmbeddings(answer([{ embedding: [1, 0, 0] }]), 1, 2),
    ).toThrow(/3 чисел вместо 2/);
    expect(() =>
      parseEmbeddings(answer([{ embedding: "AAAAAA==" }]), 1, 2),
    ).toThrow(/base64/);
    expect(() =>
      parseEmbeddings(answer([{ embedding: [1, "x"] }]), 1, 2),
    ).toThrow(/не числа/);
    expect(() =>
      parseEmbeddings(answer([{ embedding: [0, 0] }]), 1, 2),
    ).toThrow(/нулевой/);
    expect(() => parseEmbeddings({ data: "x" }, 1, 2)).toThrow(/не по формату/);
  });

  it("вектор длины 1 считается в float64", () => {
    const v = unitVector([3, 4]);
    expect(Array.from(v ?? [])).toEqual([Math.fround(0.6), Math.fround(0.8)]);
    expect(unitVector([Number.NaN, 1])).toBeUndefined();
    expect(unitVector([Number.POSITIVE_INFINITY])).toBeUndefined();
  });
});
