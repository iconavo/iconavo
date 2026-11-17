import { iconData } from "@iconavo-ui/core/internal";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./icon-settings";
import {
  backgroundCode,
  cssClassCode,
  cssClassName,
  cssSpanCode,
  DEFAULT_SVG_OPTIONS,
  formatOf,
  imgCode,
  prettySvg,
  readSvgOptions,
  svgDataUrl,
  svgOptionsValue,
  svgView,
  urlView,
  withEmptyRect,
} from "./panel-code";

// Иконка как в IconifyJSON набора: монохромная, с currentColor и толщиной линии.
const set = {
  prefix: "lucide",
  width: 24,
  height: 24,
  icons: {
    house: {
      body: '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l9-7l9 7v10H3z"/><path d="M9 21v-6h6v6"/></g>',
    },
  },
};
const icon = iconData(set, "house");
const mono = { palette: false, strokes: true };

describe("код панели иконки (макет Icon Panel)", () => {
  it("SVG с отступами: элемент — строкой, вложенные глубже", () => {
    expect(prettySvg('<svg a="1"><g><path d="M0"/></g></svg>')).toBe(
      ['<svg a="1">', "  <g>", '    <path d="M0" />', "  </g>", "</svg>"].join(
        "\n",
      ),
    );
  });

  it("пустой прямоугольник — во весь холст, первым внутри <svg>", () => {
    expect(withEmptyRect('<svg viewBox="0 0 24 24"><path d="M1"/></svg>')).toBe(
      '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M1"/></svg>',
    );
  });

  it("вид SVG по умолчанию — с отступами и прямоугольником, комментарий — по выбору", () => {
    const options = readSvgOptions(DEFAULT_SVG_OPTIONS);
    expect(options).toEqual({ pretty: true, rect: true, comment: false });
    const svg = svgView("lucide:house", icon, DEFAULT_SETTINGS, mono, options);
    expect(svg.split("\n")[0]).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="24" height="24" viewBox="0 0 24 24">$/,
    );
    expect(svg.split("\n")[1]).toBe('  <path d="M0 0h24v24H0z" fill="none" />');
    expect(svg.endsWith("</svg>")).toBe(true);
    const commented = svgView("lucide:house", icon, DEFAULT_SETTINGS, mono, {
      pretty: false,
      rect: false,
      comment: true,
    });
    expect(commented.startsWith("<!-- lucide:house -->\n<svg")).toBe(true);
    expect(svgOptionsValue({ pretty: true, rect: false, comment: true })).toBe(
      "pretty,comment",
    );
  });

  it("data URL — как у Iconify: одинарные кавычки, кодируются только опасные символы", () => {
    expect(svgDataUrl('<svg fill="#f00">  <g/></svg>')).toBe(
      "data:image/svg+xml,%3Csvg fill='%23f00'%3E %3Cg/%3E%3C/svg%3E",
    );
  });

  it("CSS-класс: монохромная — маска с цветом текста, свой цвет — background-color", () => {
    const css = cssClassCode("lucide:house", icon, DEFAULT_SETTINGS, mono);
    expect(
      css.startsWith(
        '.lucide--house {\n  display: inline-block;\n  width: 24px;\n  height: 24px;\n  --svg: url("data:image/svg+xml,',
      ),
    ).toBe(true);
    expect(css).toContain("stroke='black'");
    expect(css).toContain("background-color: currentColor;");
    expect(css).toContain("mask-image: var(--svg);");
    const red = cssClassCode(
      "lucide:house",
      icon,
      { ...DEFAULT_SETTINGS, color: "#e11d48", size: 48 },
      mono,
    );
    expect(red).toContain("width: 48px;");
    expect(red).toContain("background-color: #e11d48;");
    expect(cssSpanCode("lucide:house")).toBe(
      '<span class="lucide--house"></span>',
    );
    expect(cssClassName("material-symbols-light:table-lamp")).toBe(
      "material-symbols-light--table-lamp",
    );
  });

  it("цветная иконка — картинкой фона, без маски", () => {
    const css = cssClassCode("x:y", icon, DEFAULT_SETTINGS, {
      palette: true,
      strokes: false,
    });
    expect(css).toContain("background: no-repeat center / 100% 100% url(");
    expect(css).not.toContain("mask-image");
  });

  it("вид URL: адрес edge API, картинка и фон; поворот панель не применяет", () => {
    const s = { ...DEFAULT_SETTINGS, rotate: 1 as const, color: "#e11d48" };
    const url = urlView("https://api.iconavo.dev", "lucide:house", s, mono);
    expect(url).toBe(
      "https://api.iconavo.dev/lucide/house.svg?width=24&color=e11d48",
    );
    expect(imgCode(url, "lucide:house", icon, 24)).toBe(
      `<img src="${url}" width="24" height="24" alt="house" />`,
    );
    expect(backgroundCode(url)).toBe(`background-image: url("${url}");`);
  });

  it("формат вида — выбранная пилюля", () => {
    expect(formatOf("css-url")).toBe("css");
    expect(formatOf("html-script")).toBe("html");
    expect(formatOf("react")).toBe("react");
  });
});
