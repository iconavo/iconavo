import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tagOptions } from "./options.js";

const from =
  (attributes: Record<string, string>) =>
  (name: string): string | null =>
    attributes[name] ?? null;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("CSS", {
    supports: (_property: string, value: string) => !value.startsWith("bogus"),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("настройки тега из атрибутов", () => {
  it("без атрибутов: ничего не меняется, место 1em × 1em, заглушка из configure", () => {
    const o = tagOptions(from({}));
    expect(o.render).toEqual({
      width: undefined,
      height: undefined,
      rotate: undefined,
      strokeWidth: undefined,
    });
    expect(o).toMatchObject({
      color: undefined,
      placeholder: "skeleton",
      width: "1em",
      height: "1em",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("верные значения разбирают функции ядра, как у edge API", () => {
    const o = tagOptions(
      from({
        width: "32",
        height: "2em",
        rotate: "270deg",
        flip: "horizontal,vertical",
        "stroke-width": "1.5",
        color: "var(--brand)",
        placeholder: "none",
      }),
    );
    expect(o.render).toEqual({
      width: "32",
      height: "2em",
      rotate: 3,
      strokeWidth: 1.5,
      hFlip: true,
      vFlip: true,
    });
    expect(o).toMatchObject({
      color: "var(--brand)",
      placeholder: "none",
      width: "32",
      height: "2em",
    });
    expect(tagOptions(from({ rotate: "1" })).render.rotate).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("место до загрузки: одна сторона — квадрат, auto — 1em, пока свой размер неизвестен", () => {
    const place = (attributes: Record<string, string>) => {
      const o = tagOptions(from(attributes));
      return `${o.width} × ${o.height}`;
    };
    expect(place({ width: "24" })).toBe("24 × 24");
    expect(place({ height: "1.5rem" })).toBe("1.5rem × 1.5rem");
    expect(place({ width: "auto" })).toBe("1em × 1em");
    expect(place({ width: "auto", height: "40" })).toBe("40 × 40");
    expect(place({ width: "auto", height: "auto" })).toBe("1em × 1em");
  });

  it("неверное значение пропускается — одно предупреждение с допустимыми значениями на текст", () => {
    const bad = {
      width: "50%",
      height: "unset",
      rotate: "90",
      flip: "diagonal",
      "stroke-width": "0",
      color: "bogus",
      placeholder: "dots",
    };
    const o = tagOptions(from(bad));
    tagOptions(from(bad));
    expect(o.render).toEqual({
      width: undefined,
      height: undefined,
      rotate: undefined,
      strokeWidth: undefined,
    });
    expect(o).toMatchObject({
      color: undefined,
      placeholder: "skeleton",
      width: "1em",
      height: "1em",
    });
    expect(warn.mock.calls.map(([text]) => text)).toEqual([
      'Iconavo: invalid width "50%", use a number, a CSS length or auto',
      'Iconavo: invalid height "unset", use a number, a CSS length or auto',
      'Iconavo: invalid rotate "90", use 90deg, 180deg, 270deg or 1, 2, 3',
      'Iconavo: invalid stroke-width "0", use a positive number',
      'Iconavo: invalid flip "diagonal", use horizontal, vertical or both',
      'Iconavo: invalid color "bogus", use a CSS color',
      'Iconavo: invalid placeholder "dots", use skeleton, spinner or none',
    ]);
    tagOptions(from({ width: "none" }));
    expect(warn).toHaveBeenLastCalledWith(
      'Iconavo: invalid width "none", use a number, a CSS length or auto',
    );
  });

  it("строка значений меняется вместе с любым атрибутом рисунка", () => {
    const keys = [
      {},
      { width: "32" },
      { rotate: "1" },
      { flip: "vertical" },
      { "stroke-width": "3" },
      { color: "red" },
      { placeholder: "spinner" },
    ].map((attributes) => tagOptions(from(attributes)).key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
