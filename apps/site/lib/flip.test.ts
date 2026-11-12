import { describe, expect, it } from "vitest";
import {
  type Box,
  easeOut,
  FLIP_STEPS,
  flipFrames,
  nearViewport,
} from "./flip";

// Карточка сетки до открытия панели (7 колонок по 152 px) и после (6 по 115,5 px).
const WIDE: Box = { left: 728, top: 415, width: 152, height: 101 };
const NARROW: Box = { left: 391.5, top: 528, width: 115.5, height: 101 };

/** Числа из transform кадра: translate(x, y) scale(a, b) → [x, y, a, b]. */
const numbers = (frame: Keyframe) =>
  String(frame.transform)
    .match(/-?\d+(\.\d+)?/g)
    ?.map(Number) ?? [];

describe("переход раскладки (FLIP)", () => {
  it("первый кадр — старое место и ширина, последний — новое, без сдвига и сжатия", () => {
    const frames = flipFrames(WIDE, NARROW);
    expect(frames?.box).toHaveLength(FLIP_STEPS + 1);
    const [x0, y0, sx0, sy0] = numbers(frames?.box[0] as Keyframe);
    // центр старого прямоугольника минус центр нового
    expect(x0).toBeCloseTo(728 + 76 - (391.5 + 57.75), 1);
    expect(y0).toBeCloseTo(415 - 528, 1);
    expect(sx0).toBeCloseTo(152 / 115.5, 3);
    expect(sy0).toBe(1);
    expect(numbers(frames?.box.at(-1) as Keyframe)).toEqual([0, 0, 1, 1]);
    expect(frames?.box.map((f) => f.offset)).toEqual(
      Array.from({ length: FLIP_STEPS + 1 }, (_, i) => i / FLIP_STEPS),
    );
  });

  it("содержимое сжимается обратно: в каждом кадре произведение сжатий — единица", () => {
    const frames = flipFrames(WIDE, NARROW);
    expect(frames?.content).toHaveLength(FLIP_STEPS + 1);
    frames?.box.forEach((frame, i) => {
      const [, , sx] = numbers(frame);
      const [cx] = numbers(frames.content?.[i] as Keyframe);
      expect(sx * cx).toBeCloseTo(1, 3);
    });
  });

  it("только сдвиг — без кадров содержимого; ничего не изменилось — перехода нет", () => {
    const moved = flipFrames({ ...NARROW, left: 300 }, NARROW);
    expect(moved?.box).toHaveLength(FLIP_STEPS + 1);
    expect(moved?.content).toBeUndefined();
    expect(
      flipFrames(NARROW, { ...NARROW, left: NARROW.left + 0.2 }),
    ).toBeUndefined();
  });

  it("замедление к концу: быстро в начале, у конца почти стоит", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.9);
    expect(easeOut(0.9)).toBeGreaterThan(0.999);
  });

  it("видимость: экран и запас 200 px сверху и снизу", () => {
    expect(
      nearViewport({ left: 0, top: 500, width: 10, height: 100 }, 1100),
    ).toBe(true);
    expect(
      nearViewport({ left: 0, top: 1250, width: 10, height: 100 }, 1100),
    ).toBe(true);
    expect(
      nearViewport({ left: 0, top: 1350, width: 10, height: 100 }, 1100),
    ).toBe(false);
    expect(
      nearViewport({ left: 0, top: -350, width: 10, height: 100 }, 1100),
    ).toBe(false);
  });
});
