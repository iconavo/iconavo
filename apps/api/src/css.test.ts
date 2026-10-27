import type { IconavoIconSet } from "@iconavo-ui/core";
import { describe, expect, it } from "vitest";
import { type CssOptions, cssBody, svgToUrl } from "./css.js";

const MDI_HOME =
  '<path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8z"/>';
const files = (
  set: string,
  icons: IconavoIconSet["icons"],
  size = 24,
): Map<string, IconavoIconSet> =>
  new Map(
    Object.entries(icons).map(([name, icon]) => [
      name,
      { prefix: set, icons: { [name]: icon }, width: size, height: size },
    ]),
  );
const DEFAULTS: CssOptions = {
  square: false,
  format: "expanded",
  download: false,
};

describe("cssBody", () => {
  it("совпадает с живым ответом Iconify для mdi:home (23 октября 2026)", () => {
    const css = cssBody(
      "mdi",
      ["home"],
      files("mdi", { home: { body: MDI_HOME } }),
      DEFAULTS,
    );
    expect(css).toBe(`.icon--mdi {
  display: inline-block;
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask-image: var(--svg);
  mask-image: var(--svg);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}

.icon--mdi--home {
  --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='24' height='24'%3E%3Cpath fill='black' d='M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8z'/%3E%3C/svg%3E");
}
`);
  });

  it("цветная иконка — фон; неквадратная — своя ширина и правило с двумя классами", () => {
    const css = cssBody(
      "color",
      ["swan"],
      files("color", { swan: { body: '<path fill="#fff"/>', height: 33 } }, 32),
      DEFAULTS,
    );
    expect(css).toContain("background-repeat: no-repeat;");
    expect(css).not.toContain("mask-image");
    expect(css).toContain(
      ".icon--color.icon--color--swan {\n  width: 0.97em;\n  background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 33' width='32' height='33'%3E%3Cpath fill='%23fff'/%3E%3C/svg%3E\");\n}",
    );
  });

  it("square — квадратный холст вокруг рисунка, без своей ширины", () => {
    const css = cssBody(
      "color",
      ["swan"],
      files("color", { swan: { body: "<g/>", height: 33 } }, 32),
      { ...DEFAULTS, square: true },
    );
    expect(css).toContain(".icon--color--swan {");
    expect(css).toContain("viewBox='-0.5 0 33 33' width='33' height='33'");
    expect(css).not.toContain("0.97em");
  });

  it("цвет — фоном и вместо currentColor; mode побеждает", () => {
    const icons = files("mdi", { home: { body: MDI_HOME } });
    const colored = cssBody("mdi", ["home"], icons, {
      ...DEFAULTS,
      color: "#ff0000",
    });
    expect(colored).toContain("background-image:");
    expect(colored).toContain("fill='%23ff0000'");
    const mask = cssBody("mdi", ["home"], icons, {
      ...DEFAULTS,
      color: "#ff0000",
      mode: "mask",
    });
    expect(mask).toContain("--svg: url(");
  });

  it("форматы compact и compressed", () => {
    const icons = files("mdi", { home: { body: MDI_HOME } });
    const compact = cssBody("mdi", ["home"], icons, {
      ...DEFAULTS,
      format: "compact",
    });
    expect(compact.startsWith(".icon--mdi { display: inline-block;")).toBe(
      true,
    );
    expect(compact).toContain("; }\n\n.icon--mdi--home { --svg: url(");
    const compressed = cssBody("mdi", ["home"], icons, {
      ...DEFAULTS,
      format: "compressed",
    });
    expect(compressed.startsWith(".icon--mdi{display:inline-block;")).toBe(
      true,
    );
    expect(compressed).toContain("}.icon--mdi--home{--svg:url(");
    expect(compressed).not.toContain("\n");
  });

  it("ненайденные — комментарием, но только имена по правилу", () => {
    const css = cssBody(
      "mdi",
      ["*/x", "home", "nope"],
      files("mdi", { home: { body: "<g/>" } }),
      DEFAULTS,
    );
    expect(css.endsWith("}\n\n/* Could not find icon: nope */\n")).toBe(true);
    expect(css).not.toContain("*/x");
  });
});

describe("svgToUrl", () => {
  it("кавычки, проценты, решётки и угловые скобки — как у Iconify", () => {
    expect(svgToUrl('<svg a="1%#">\n  </svg>')).toBe(
      "url(\"data:image/svg+xml,%3Csvg a='1%25%23'%3E %3C/svg%3E\")",
    );
  });
});
