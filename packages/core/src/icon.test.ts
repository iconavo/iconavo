import { describe, expect, it } from "vitest";
import { type IconifySet, iconData } from "./icon.js";

const SET: IconifySet = {
  prefix: "demo",
  width: 24,
  height: 24,
  icons: {
    house: { body: "<g/>" },
    swan: { body: "<path/>", height: 33 },
  },
  aliases: {
    home: { parent: "house" },
    "home-wide": { parent: "home", width: 30 },
    "home-wide-tall": { parent: "home-wide", height: 40, width: 32 },
  },
};

describe("iconData", () => {
  it("иконка — размеры набора, свои размеры главнее", () => {
    expect(iconData(SET, "house")).toEqual({
      body: "<g/>",
      left: 0,
      top: 0,
      width: 24,
      height: 24,
    });
    expect(iconData(SET, "swan")).toMatchObject({ width: 24, height: 33 });
  });

  it("цепочка алиасов: ближний к имени алиас главнее", () => {
    expect(iconData(SET, "home")).toMatchObject({ width: 24, height: 24 });
    expect(iconData(SET, "home-wide")).toMatchObject({
      width: 30,
      height: 24,
    });
    expect(iconData(SET, "home-wide-tall")).toMatchObject({
      body: "<g/>",
      width: 32,
      height: 40,
    });
  });

  it("без размеров набора — 16, как в IconifyJSON", () => {
    expect(
      iconData({ prefix: "x", icons: { a: { body: "" } } }, "a"),
    ).toMatchObject({ width: 16, height: 16 });
  });

  it("имени нет — null, в том числе имён из прототипа объекта", () => {
    expect(iconData(SET, "missing")).toBeNull();
    expect(iconData(SET, "constructor")).toBeNull();
    expect(iconData(SET, "toString")).toBeNull();
  });

  it("сломанная цепочка — ошибка", () => {
    expect(() =>
      iconData(
        { prefix: "x", icons: {}, aliases: { a: { parent: "b" } } },
        "a",
      ),
    ).toThrow(/does not lead to an icon/);
    expect(() =>
      iconData(
        {
          prefix: "x",
          icons: {},
          aliases: { a: { parent: "b" }, b: { parent: "a" } },
        },
        "a",
      ),
    ).toThrow(/loops/);
  });

  it("поворот или отражение в данных — ошибка, а не тихо неверная картинка", () => {
    expect(() =>
      iconData(
        {
          prefix: "x",
          icons: { a: { body: "" } },
          aliases: { b: { parent: "a", hFlip: true } },
        },
        "b",
      ),
    ).toThrow(/rotate or flip/);
    expect(() =>
      iconData({ prefix: "x", icons: { a: { body: "", rotate: 1 } } }, "a"),
    ).toThrow(/rotate or flip/);
  });
});
