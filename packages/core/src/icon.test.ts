import { describe, expect, it } from "vitest";
import { type IconavoIconSet, iconData } from "./icon.js";

const SET: IconavoIconSet = {
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

  it("размеры не числа, нулевые или рисунок не строка — ошибка, а не рисунок с NaN", () => {
    const broken = [
      { prefix: "x", width: "24", icons: { a: { body: "<g/>" } } },
      { prefix: "x", icons: { a: { body: "<g/>", height: 0 } } },
      { prefix: "x", icons: { a: { body: "<g/>", left: Number.NaN } } },
      { prefix: "x", icons: { a: { body: 42 } } },
    ];
    for (const set of broken) {
      expect(() => iconData(set as never, "a")).toThrow(/invalid body or size/);
    }
  });
});

describe("iconData: повороты и отражения в данных, как у Iconify", () => {
  // Широкая иконка 32×16: поворот на 90° меняет стороны холста.
  const TURNS: IconavoIconSet = {
    prefix: "x",
    width: 32,
    height: 16,
    icons: {
      wide: { body: "<path/>" },
      turned: { body: "<path/>", rotate: 1 },
    },
    aliases: {
      down: { parent: "wide", rotate: 1 },
      up: { parent: "down", rotate: 2 },
      left: { parent: "wide", hFlip: true },
      right: { parent: "left", hFlip: true },
      both: { parent: "left", vFlip: true },
      odd: { parent: "wide", rotate: 1.5 },
      back: { parent: "turned", rotate: -1 },
      full: { parent: "turned", rotate: 7 },
      "down-tall": { parent: "down", height: 20 },
    },
  };
  const WIDE = { body: "<path/>", left: 0, top: 0, width: 32, height: 16 };

  it("поворот сразу в рисунке и холсте: стороны меняются местами", () => {
    const down = {
      body: '<g transform="rotate(90 8 8)"><path/></g>',
      left: 0,
      top: 0,
      width: 16,
      height: 32,
    };
    expect(iconData(TURNS, "down")).toEqual(down);
    expect(iconData(TURNS, "turned")).toEqual(down);
  });

  it("повороты по цепочке складываются по модулю 4", () => {
    expect(iconData(TURNS, "up")).toEqual({
      body: '<g transform="rotate(-90 16 16)"><path/></g>',
      left: 0,
      top: 0,
      width: 16,
      height: 32,
    });
    expect(iconData(TURNS, "back")).toEqual(WIDE);
    expect(iconData(TURNS, "full")).toEqual(WIDE);
  });

  it("отражения гасят друг друга; оба сразу — поворот на 180°", () => {
    expect(iconData(TURNS, "left")).toEqual({
      ...WIDE,
      body: '<g transform="translate(32 0) scale(-1 1)"><path/></g>',
    });
    expect(iconData(TURNS, "right")).toEqual(WIDE);
    expect(iconData(TURNS, "both")).toEqual({
      ...WIDE,
      body: '<g transform="rotate(180 16 8)"><path/></g>',
    });
  });

  it("нецелый поворот в чужих данных не учитывается", () => {
    expect(iconData(TURNS, "odd")).toEqual(WIDE);
  });

  it("размеры алиаса — до поворота: поворачивается уже его холст", () => {
    expect(iconData(TURNS, "down-tall")).toEqual({
      body: '<g transform="rotate(90 10 10)"><path/></g>',
      left: 0,
      top: 0,
      width: 20,
      height: 32,
    });
  });
});
