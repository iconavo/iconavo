import { describe, expect, it } from "vitest";
import { type IconData, iconData } from "./icon.js";
import {
  calculateSize,
  iconToSvg,
  type SvgCustomisations,
  svgToString,
  transformIcon,
} from "./svg.js";

// Ожидания — живые ответы api.iconify.design для fa-solid:home (холст 576×512), 23 октября 2026.
const HOME: IconData = {
  body: "<path/>",
  left: 0,
  top: 0,
  width: 576,
  height: 512,
};

const svg = (icon: IconData, c?: SvgCustomisations) =>
  svgToString(iconToSvg(icon, c));

describe("calculateSize", () => {
  it("вверх до сотых, единица та же", () => {
    expect(calculateSize("1em", 576 / 512)).toBe("1.13em");
    expect(calculateSize("24", 512 / 576)).toBe("21.34");
    expect(calculateSize("50%", 512 / 576)).toBe("44.45%");
    expect(calculateSize("1em", 1)).toBe("1em");
    expect(calculateSize("unset", 2)).toBe("unset");
  });

  it("без шума плавающей точки, как ширина файла статики", () => {
    expect(calculateSize("1em", 11 / 10)).toBe("1.1em");
  });
});

describe("iconToSvg: размеры", () => {
  it("по умолчанию высота 1em, ширина по пропорции", () => {
    expect(svg(HOME)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1.13em" height="1em" viewBox="0 0 576 512"><path/></svg>',
    );
  });

  it("одна сторона задана — вторая по пропорции", () => {
    expect(iconToSvg(HOME, { height: "24" }).attributes).toMatchObject({
      width: "27",
      height: "24",
    });
    expect(iconToSvg(HOME, { width: "24" }).attributes).toMatchObject({
      width: "24",
      height: "21.34",
    });
    expect(iconToSvg(HOME, { width: "50%" }).attributes).toMatchObject({
      width: "50%",
      height: "44.45%",
    });
  });

  it("auto — размер холста, unset и none — без атрибута", () => {
    expect(iconToSvg(HOME, { width: "auto" }).attributes).toMatchObject({
      width: "576",
      height: "512",
    });
    expect(iconToSvg(HOME, { width: "unset" }).attributes).toEqual({
      viewBox: "0 0 576 512",
    });
    expect(iconToSvg(HOME, { height: "none" }).attributes).toEqual({
      viewBox: "0 0 576 512",
    });
    expect(
      iconToSvg(HOME, { width: "unset", height: "64" }).attributes,
    ).toEqual({ height: "64", viewBox: "0 0 576 512" });
  });
});

describe("iconToSvg: повороты и отражения, как у Iconify", () => {
  const transform = (c: SvgCustomisations) => {
    const parts = iconToSvg(HOME, c);
    return {
      viewBox: parts.attributes.viewBox,
      g: /^<g transform="([^"]+)">/.exec(parts.body)?.[1],
    };
  };

  it("повороты на 90°, 180° и 270° меняют холст", () => {
    expect(transform({ rotate: 1 })).toEqual({
      viewBox: "0 0 512 576",
      g: "rotate(90 256 256)",
    });
    expect(transform({ rotate: 2 })).toEqual({
      viewBox: "0 0 576 512",
      g: "rotate(180 288 256)",
    });
    expect(transform({ rotate: 3 })).toEqual({
      viewBox: "0 0 512 576",
      g: "rotate(-90 288 288)",
    });
  });

  it("отражения; оба сразу — поворот на 180°", () => {
    expect(transform({ hFlip: true }).g).toBe("translate(576 0) scale(-1 1)");
    expect(transform({ vFlip: true }).g).toBe("translate(0 512) scale(1 -1)");
    expect(transform({ hFlip: true, vFlip: true }).g).toBe(
      "rotate(180 288 256)",
    );
  });

  it("сначала отражение, потом поворот", () => {
    expect(transform({ hFlip: true, rotate: 1 })).toEqual({
      viewBox: "0 0 512 576",
      g: "rotate(90 256 256) translate(576 0) scale(-1 1)",
    });
  });

  it("неквадратная иконка с поворотом: стороны и ширина меняются местами", () => {
    // fluent-emoji-flat:swan и keycap-5 — 32×33.
    const swan: IconData = { ...HOME, width: 32, height: 33 };
    const parts = iconToSvg(swan, { rotate: 1 });
    expect(parts.attributes).toEqual({
      width: "1.04em",
      height: "1em",
      viewBox: "0 0 33 32",
    });
    expect(parts.body).toBe('<g transform="rotate(90 16.5 16.5)"><path/></g>');
  });

  it("без настроек обёртки нет", () => {
    expect(iconToSvg(HOME).body).toBe("<path/>");
    expect(iconToSvg(HOME, { rotate: 0, hFlip: false }).body).toBe("<path/>");
  });

  it("поворот в данных и в настройках — две обёртки, как два прохода iconToSVG у Iconify", () => {
    const turned = iconData(
      {
        prefix: "x",
        width: 576,
        height: 512,
        icons: { home: { body: "<path/>" } },
        aliases: { "home-down": { parent: "home", rotate: 1 } },
      },
      "home-down",
    ) as IconData;
    expect(svg(turned, { rotate: 1 })).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1.13em" height="1em" viewBox="0 0 576 512"><g transform="rotate(90 288 288)"><g transform="rotate(90 256 256)"><path/></g></g></svg>',
    );
  });
});

describe("transformIcon", () => {
  it("без поворота и отражения — та же иконка", () => {
    expect(transformIcon(HOME, 0, false, false)).toEqual(HOME);
  });
});

describe("svgToString", () => {
  it("xmlns:xlink — только если рисунок им пользуется", () => {
    expect(svg({ ...HOME, body: '<use xlink:href="#a"/>' })).toContain(
      'xmlns:xlink="http://www.w3.org/1999/xlink"',
    );
    expect(svg(HOME)).not.toContain("xlink");
  });

  it("атрибуты — по порядку, значения экранируются", () => {
    const parts = iconToSvg(HOME, { height: "24" });
    parts.attributes.color = "red";
    parts.attributes.role = "img";
    parts.attributes["aria-label"] = 'Tom & "Jerry" <3';
    expect(svgToString(parts)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="27" height="24" viewBox="0 0 576 512" color="red" role="img" aria-label="Tom &amp; &quot;Jerry&quot; &lt;3"><path/></svg>',
    );
  });
});
