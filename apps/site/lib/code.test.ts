import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IconavoIconSet } from "@iconavo-ui/core";
import { hasStrokeWidth, iconData } from "@iconavo-ui/core/internal";
import { describe, expect, it } from "vitest";
import { parseSvgOptions, svgBody } from "../../api/src/svg";
import {
  type Applies,
  commentText,
  cssCode,
  fileComment,
  fileName,
  pngSvg,
  reactCode,
  svgCode,
  svgFile,
  svgLink,
  tagCode,
} from "./code";
import type { IconDetails } from "./icon";
import { DEFAULT_SETTINGS, type IconSettings } from "./icon-settings";
import { installFromReadme } from "./install-readme";

const root = join(import.meta.dirname, "..", "..", "..");
const install = installFromReadme(
  readFileSync(join(root, "packages", "icon", "README.md"), "utf8"),
);
const API = "https://api.iconavo.dev";
const LINE: Applies = { palette: false, strokes: true };
const FILL: Applies = { palette: false, strokes: false };
const ALL: IconSettings = {
  size: 64,
  color: "#e11d48",
  stroke: 1.5,
  rotate: 1,
  hflip: true,
  vflip: false,
};

describe("код тега, React, CSS и ссылки", () => {
  it("без настроек — имя и размер по умолчанию, 24 px", () => {
    const s = DEFAULT_SETTINGS;
    expect(tagCode("lucide:house", s, LINE)).toBe(
      '<iconavo-icon icon="lucide:house" width="24"></iconavo-icon>',
    );
    expect(reactCode("lucide:house", s, LINE, install)).toBe(
      'import { Icon } from "@iconavo-ui/react";\n\n<Icon icon="lucide:house" width={24} />',
    );
    expect(svgLink(API, "lucide:house", s, LINE)).toBe(
      "https://api.iconavo.dev/lucide/house.svg?width=24",
    );
    expect(cssCode(API, "lucide:house", s, LINE)).toBe(
      '<link rel="stylesheet" href="https://api.iconavo.dev/lucide.css?icons=house">\n<span class="icon--lucide icon--lucide--house" style="font-size: 24px"></span>',
    );
  });

  it("все настройки — в постоянном порядке", () => {
    expect(tagCode("lucide:house", ALL, LINE)).toBe(
      '<iconavo-icon icon="lucide:house" width="64" color="#e11d48" stroke-width="1.5" rotate="90deg" flip="horizontal"></iconavo-icon>',
    );
    expect(reactCode("lucide:house", ALL, LINE, install)).toBe(
      'import { Icon } from "@iconavo-ui/react";\n\n<Icon icon="lucide:house" width={64} color="#e11d48" strokeWidth={1.5} rotate="90deg" flip="horizontal" />',
    );
    expect(svgLink(API, "lucide:house", ALL, LINE)).toBe(
      "https://api.iconavo.dev/lucide/house.svg?width=64&color=e11d48&stroke-width=1.5&rotate=90deg&flip=horizontal",
    );
    expect(cssCode(API, "lucide:house", ALL, LINE)).toBe(
      '<link rel="stylesheet" href="https://api.iconavo.dev/lucide.css?icons=house&color=e11d48&stroke-width=1.5">\n<span class="icon--lucide icon--lucide--house" style="font-size: 64px; transform: rotate(90deg) scaleX(-1)"></span>',
    );
  });

  it("цветной набор — без цвета и толщины, заливка — без толщины, оба отражения", () => {
    expect(
      tagCode("fluent-emoji-flat:waving-hand", ALL, {
        palette: true,
        strokes: false,
      }),
    ).toBe(
      '<iconavo-icon icon="fluent-emoji-flat:waving-hand" width="64" rotate="90deg" flip="horizontal"></iconavo-icon>',
    );
    const both = { ...ALL, rotate: 0, vflip: true } as const;
    expect(svgLink(API, "ph:house-bold", both, FILL)).toBe(
      "https://api.iconavo.dev/ph/house-bold.svg?width=64&color=e11d48&flip=horizontal,vertical",
    );
    expect(cssCode(API, "ph:house-bold", both, FILL)).toContain(
      'style="font-size: 64px; transform: scale(-1)"',
    );
  });
});

/** Набор из data/ и признак цветного набора. */
function loadSet(set: string): { file: IconavoIconSet; palette: boolean } {
  const read = (file: string) =>
    JSON.parse(readFileSync(join(root, "data", set, file), "utf8"));
  return {
    file: read("icons.json") as IconavoIconSet,
    palette: (read("info.json") as { palette: boolean }).palette,
  };
}

describe("SVG сайта — побайтно ответ edge API по адресу из «Ссылки»", () => {
  const names = [
    "lucide:house",
    "tabler:home",
    "tabler:home-filled",
    "ph:house-bold",
    "material-symbols:home-outline-rounded",
    "fluent-emoji-flat:waving-hand",
    "fluent-emoji-flat:phoenix-bird",
  ];
  const settings: IconSettings[] = [
    DEFAULT_SETTINGS,
    ALL,
    { ...DEFAULT_SETTINGS, color: "#0a84ff", stroke: 0.75 },
    { size: 24, rotate: 2, hflip: true, vflip: true },
    { size: 256, stroke: 3, rotate: 3, hflip: false, vflip: true },
  ];

  for (const name of names) {
    it(name, () => {
      const [set, bare] = name.split(":") as [string, string];
      const { file, palette } = loadSet(set);
      const icon = iconData(file, bare);
      if (icon === null) throw new Error(`нет ${name} в data/`);
      const applies = { palette, strokes: hasStrokeWidth(icon.body) };
      for (const s of settings) {
        const url = new URL(svgLink(API, name, s, applies));
        expect(svgCode(icon, s, applies), url.search).toBe(
          svgBody(file, bare, parseSvgOptions(url.searchParams)),
        );
      }
    });
  }
});

describe("файлы", () => {
  const details: Pick<IconDetails, "set" | "credits"> = {
    set: {
      prefix: "lucide",
      name: "Lucide",
      author: { name: "Lucide Contributors", url: "https://lucide.dev" },
      license: { title: "ISC", spdx: "ISC", url: "https://x.test/isc" },
      palette: false,
      credits: [
        {
          name: "Feather",
          author: "Cole Bemis",
          license: "MIT",
          url: "https://feathericons.com",
        },
      ],
    },
    credits: [
      {
        name: "Feather",
        author: "Cole Bemis",
        license: "MIT",
        url: "https://feathericons.com",
      },
    ],
  };
  const { file } = loadSet("lucide");
  const icon = iconData(file, "house");
  if (icon === null) throw new Error("нет lucide:house в data/");

  it("комментарий — авторство, Feather и ссылка на текст лицензии, без «--»", () => {
    const comment = fileComment("lucide:house", details);
    expect(comment).toBe(
      "<!-- lucide:house. Icons: Lucide by Lucide Contributors (https://lucide.dev), ISC license (https://x.test/isc). Includes icons from Feather by Cole Bemis (https://feathericons.com), MIT license. Based on Feather by Cole Bemis, MIT license. License text: https://iconavo.dev/licenses#lucide -->",
    );
    expect(commentText("a--b---c-")).toBe("a- -b- - -c- ");
  });

  it("SVG — родной размер сетки, если размер не меняли; иначе заданный", () => {
    const plain = svgFile(icon, DEFAULT_SETTINGS, LINE, "<!-- c -->");
    expect(plain.startsWith("<!-- c -->\n<svg ")).toBe(true);
    expect(plain).toContain('width="24" height="24" viewBox="0 0 24 24"');
    expect(svgFile(icon, ALL, LINE, "")).toContain('width="64" height="64"');
    expect(fileName("lucide:house", "svg")).toBe("lucide-house.svg");
    expect(fileName("lucide:house", "png", 512)).toBe("lucide-house-512.png");
  });

  it("SVG для PNG — размер в пикселях, без цвета — чёрный", () => {
    const png = pngSvg(icon, DEFAULT_SETTINGS, LINE, 512);
    expect([png.width, png.height]).toEqual([512, 512]);
    expect(png.svg).not.toContain("currentColor");
    expect(png.svg).toContain('stroke="#000"');
    expect(pngSvg(icon, ALL, LINE, 16).svg).toContain('stroke="#e11d48"');
  });
});
