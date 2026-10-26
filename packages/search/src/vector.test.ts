import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SEARCH_MODEL } from "./config.js";
import {
  bytesVector,
  truncateUnit,
  vectorBytes,
  vectorHash,
} from "./vector.js";

describe("vectorHash", () => {
  it("эталон: одинаков в Node и в Workers", async () => {
    // Зафиксирован 26 октября 2026: функция и робот индекса считают один и тот же ключ.
    expect(await vectorHash(SEARCH_MODEL.id, "дом")).toBe(
      "69d20b78d8ca6e35ca8f2e72fe229f37",
    );
  });

  it("та же формула, что у кэша запросов прототипа (search/query-vectors.ts)", async () => {
    const text = "shopping cart";
    const expected = createHash("sha256")
      .update(`${SEARCH_MODEL.id}\n${text}`)
      .digest("hex")
      .slice(0, 32);
    expect(await vectorHash(SEARCH_MODEL.id, text)).toBe(expected);
  });
});

describe("truncateUnit", () => {
  it("первые числа, снова длины 1", () => {
    const v = truncateUnit([3, 4, 12], 2);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
    expect(v.length).toBe(2);
  });

  it("короткий и нулевой вектор — ошибка", () => {
    expect(() => truncateUnit([1], 2)).toThrow(/нужно не меньше 2/);
    expect(() => truncateUnit([0, 0, 1], 2)).toThrow(/нулевая/);
  });
});

describe("vectorBytes и bytesVector", () => {
  it("float32 little-endian туда и обратно", () => {
    const v = Float32Array.from([1, -0.5, 0.25]);
    const bytes = vectorBytes(v);
    expect([...bytes.slice(0, 4)]).toEqual([0, 0, 128, 63]);
    expect(bytesVector(bytes, 3)).toEqual(v);
    expect(bytesVector(bytes.buffer as ArrayBuffer, 3)).toEqual(v);
  });

  it("не та длина — undefined", () => {
    expect(bytesVector(new Uint8Array(8), 3)).toBeUndefined();
  });

  it("читает и из середины буфера", () => {
    const bytes = vectorBytes(Float32Array.from([2, 3]));
    const padded = new Uint8Array(12);
    padded.set(bytes, 4);
    expect(bytesVector(padded.subarray(4), 2)).toEqual(
      Float32Array.from([2, 3]),
    );
  });
});
