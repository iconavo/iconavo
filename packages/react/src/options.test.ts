import { describe, expect, it } from "vitest";
import { iconOptions } from "./options.js";

describe("пропсы компонента", () => {
  it("числа — как строки: размеры, поворот четвертью, толщина линии", () => {
    const o = iconOptions({ width: 32, rotate: 1, strokeWidth: 1.5 });
    expect(o.render).toMatchObject({
      width: "32",
      rotate: 1,
      strokeWidth: 1.5,
    });
    expect(o.warnings).toEqual([]);
  });

  it("неверное значение пропускается, а текст предупреждения — с именем пропа и допустимыми значениями", () => {
    const o = iconOptions({
      width: "50%",
      height: "none",
      rotate: 90,
      strokeWidth: "0",
      flip: "diagonal",
      placeholder: "big" as "none",
    });
    expect(o.render).toEqual({
      width: undefined,
      height: undefined,
      rotate: undefined,
      strokeWidth: undefined,
    });
    expect(o.warnings).toEqual([
      'invalid width "50%", use a number, a CSS length or auto',
      'invalid height "none", use a number, a CSS length or auto',
      'invalid rotate "90", use 90deg, 180deg, 270deg or 1, 2, 3',
      'invalid strokeWidth "0", use a positive number',
      'invalid flip "diagonal", use horizontal, vertical or both',
      'invalid placeholder "big", use skeleton, spinner or none',
    ]);
    expect(o.placeholder).toBe("iconavo-loading");
  });

  it("место до загрузки — как у тега; класс заглушки — из пропа или iconavo-loading", () => {
    expect(iconOptions({})).toMatchObject({
      width: "1em",
      height: "1em",
      placeholder: "iconavo-loading",
    });
    expect(iconOptions({ height: 24, width: "auto" })).toMatchObject({
      width: "24",
      height: "24",
    });
    expect(iconOptions({ placeholder: "spinner" }).placeholder).toBe(
      "iconavo-spinner",
    );
    expect(iconOptions({ placeholder: "none" }).placeholder).toBeUndefined();
    expect(iconOptions({ flip: "horizontal,vertical" }).render).toMatchObject({
      hFlip: true,
      vFlip: true,
    });
  });
});
