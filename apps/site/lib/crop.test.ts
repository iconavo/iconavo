import { describe, expect, it } from "vitest";
import {
  baseScale,
  CROP,
  changedAgo,
  clampCrop,
  imageRect,
  photoFileProblem,
  sourceSquare,
} from "./crop";

describe("обрезка фото", () => {
  it("масштаб 1 — короткая сторона ровно по кругу; посередине квадрат — середина картинки", () => {
    expect(baseScale(800, 400)).toBe(0.5);
    expect(sourceSquare({ zoom: 1, x: 0, y: 0 }, 800, 400)).toEqual({
      x: 200,
      y: 0,
      size: 400,
    });
    // Вдвое ближе — вдвое меньший квадрат, всё так же посередине.
    expect(sourceSquare({ zoom: 2, x: 0, y: 0 }, 800, 400)).toEqual({
      x: 300,
      y: 100,
      size: 200,
    });
  });

  it("сдвиг — в пределах: круг всегда закрыт картинкой", () => {
    // 800 × 400 при масштабе 0,5 — 400 × 200: вбок можно на 100 px, вверх и вниз — нисколько.
    expect(clampCrop({ zoom: 1, x: 500, y: -50 }, 800, 400)).toEqual({
      zoom: 1,
      x: 100,
      y: 0,
    });
    expect(clampCrop({ zoom: 9, x: 0, y: 0 }, 800, 400).zoom).toBe(
      CROP.maxZoom,
    );
    expect(clampCrop({ zoom: 0.1, x: 0, y: 0 }, 800, 400).zoom).toBe(
      CROP.minZoom,
    );
    // Сдвинули до края — квадрат касается края картинки.
    const edge = sourceSquare({ zoom: 1, x: 100, y: 0 }, 800, 400);
    expect(edge.x).toBe(0);
  });

  it("картинка в области: центр со сдвигом", () => {
    expect(imageRect({ zoom: 1, x: 10, y: -5 }, 800, 400, 392, 280)).toEqual({
      left: 392 / 2 + 10 - 200,
      top: 280 / 2 - 5 - 100,
      width: 400,
      height: 200,
    });
  });

  it("файл: только PNG и JPEG, до 15 МБ, не меньше 200 × 200", () => {
    expect(photoFileProblem({ type: "image/png", size: 1000 }, 200, 300)).toBe(
      undefined,
    );
    expect(photoFileProblem({ type: "image/webp", size: 1000 })).toBe("file");
    expect(
      photoFileProblem({ type: "image/jpeg", size: CROP.maxBytes + 1 }),
    ).toBe("file");
    expect(photoFileProblem({ type: "image/jpeg", size: 10 }, 199, 500)).toBe(
      "file",
    );
  });

  it("«Changed 3 months ago» — словами языка", () => {
    const now = Date.UTC(2026, 10, 27);
    const iso = (days: number) =>
      new Date(now - days * 86_400_000).toISOString();
    expect(changedAgo(iso(0), now, "en")).toBe("today");
    expect(changedAgo(iso(2), now, "en")).toBe("2 days ago");
    expect(changedAgo(iso(95), now, "en")).toBe("3 months ago");
    expect(changedAgo(iso(800), now, "en")).toBe("2 years ago");
    expect(changedAgo(iso(95), now, "ru")).toBe("3 месяца назад");
    expect(changedAgo(null, now, "en")).toBe("");
    expect(changedAgo("not a date", now, "en")).toBe("");
  });
});
