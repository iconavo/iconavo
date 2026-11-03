import { describe, expect, it } from "vitest";
import {
  attributionText,
  bareName,
  iconDetailsUrl,
  iconPagePath,
  isIconName,
  panelIcon,
  parseIconDetails,
} from "./icon";
import {
  DEFAULT_SETTINGS,
  iconProps,
  parseColor,
  readSettings,
  settingsParams,
} from "./icon-settings";
import { queryText } from "./url-query";

const DETAILS = {
  icon: "lucide:circle-alert",
  alias: "lucide:alert-circle",
  set: {
    prefix: "lucide",
    name: "Lucide",
    author: {
      name: "Lucide Contributors",
      url: "https://github.com/lucide-icons/lucide",
    },
    license: {
      title: "ISC License",
      spdx: "ISC",
      url: "https://spdx.org/licenses/ISC.html",
    },
    palette: false,
  },
  card: "lucide:circle-alert",
  style: "outline",
  variants: [{ style: "outline", icons: ["lucide:circle-alert"] }],
  tones: [],
  strokes: true,
  description: { en: "A circle alert", ru: "Круг с восклицательным знаком" },
  synonyms: { en: ["warning"], ru: ["внимание"] },
  tags: ["alert"],
  credits: [
    {
      name: "Feather",
      author: "Cole Bemis",
      license: "MIT",
      url: "https://github.com/feathericons/feather",
    },
  ],
  similar: ["tabler:alert-circle", "ph:warning-circle"],
};

describe("имена и адреса", () => {
  it("имя по правилу; панель — только с верным именем", () => {
    expect(isIconName("lucide:house")).toBe(true);
    expect(isIconName("lucide")).toBe(false);
    expect(isIconName("Lucide:house")).toBe(false);
    expect(panelIcon(new URLSearchParams("icon=lucide:house"))).toBe(
      "lucide:house",
    );
    expect(panelIcon(new URLSearchParams("icon=x"))).toBeUndefined();
  });

  it("адреса API и страницы; двоеточие в адресе страницы не кодируется", () => {
    expect(iconDetailsUrl("https://api.iconavo.dev", "ph:house-bold")).toBe(
      "https://api.iconavo.dev/icon?icon=ph%3Ahouse-bold",
    );
    expect(iconPagePath("ph:house-bold")).toBe("/ph/house-bold");
    expect(bareName("ph:house-bold")).toBe("house-bold");
    expect(queryText(new URLSearchParams({ q: "дом", icon: "ph:house" }))).toBe(
      "q=%D0%B4%D0%BE%D0%BC&icon=ph:house",
    );
  });
});

describe("parseIconDetails", () => {
  it("ответ по форме — сведения; лишнее не теряется", () => {
    expect(parseIconDetails(DETAILS)).toEqual(DETAILS);
  });

  it("без описаний — null; скрытая — hidden", () => {
    const d = parseIconDetails({
      ...DETAILS,
      alias: undefined,
      hidden: true,
      card: null,
      style: null,
      variants: [],
      description: null,
      synonyms: null,
      credits: undefined,
      similar: [],
    });
    expect(d).toMatchObject({ hidden: true, card: null, description: null });
    expect(d?.credits).toBeUndefined();
  });

  it("не по форме — undefined", () => {
    expect(parseIconDetails({ ...DETAILS, icon: "house" })).toBeUndefined();
    expect(parseIconDetails({ ...DETAILS, strokes: "yes" })).toBeUndefined();
    expect(
      parseIconDetails({
        ...DETAILS,
        variants: [{ style: "bold", icons: [] }],
      }),
    ).toBeUndefined();
    expect(
      parseIconDetails({ ...DETAILS, description: { en: "x" } }),
    ).toBeUndefined();
    expect(parseIconDetails(null)).toBeUndefined();
  });
});

describe("attributionText", () => {
  it("один текст на весь набор, по-английски: набор, автор, лицензия и части от других авторов", () => {
    const feather = {
      name: "Feather",
      author: "Cole Bemis",
      license: "MIT",
      url: "https://github.com/feathericons/feather",
    };
    const lucide = parseIconDetails({
      ...DETAILS,
      set: {
        ...DETAILS.set,
        author: {
          name: "Lucide Contributors",
          url: "https://github.com/lucide-icons/lucide",
        },
        license: {
          title: "ISC",
          spdx: "ISC",
          url: "https://spdx.org/licenses/ISC.html",
        },
        credits: [feather],
      },
    });
    if (lucide === undefined) throw new Error("разбор");
    expect(lucide.set.credits).toEqual([feather]);
    expect(attributionText(lucide)).toBe(
      "Icons: Lucide by Lucide Contributors (https://github.com/lucide-icons/lucide), ISC license (https://spdx.org/licenses/ISC.html). Includes icons from Feather by Cole Bemis (https://github.com/feathericons/feather), MIT license.",
    );
    expect(
      attributionText({
        set: {
          prefix: "material-symbols",
          name: "Material Symbols",
          author: { name: "Google" },
          license: { title: "Apache 2.0", spdx: "Apache-2.0" },
          palette: false,
        },
      }),
    ).toBe("Icons: Material Symbols by Google, Apache 2.0 license.");
  });

  it("части набора не по форме — ответ не разбирается", () => {
    expect(
      parseIconDetails({
        ...DETAILS,
        set: { ...DETAILS.set, credits: [{ name: "Feather" }] },
      }),
    ).toBeUndefined();
  });
});

describe("настройки превью", () => {
  it("из адреса и обратно: только отличное от умолчаний", () => {
    const s = readSettings(
      new URLSearchParams(
        "size=64&color=E11D48&stroke=1.5&rotate=90&flip=horizontal,vertical",
      ),
    );
    expect(s).toEqual({
      size: 64,
      color: "#e11d48",
      stroke: 1.5,
      rotate: 1,
      hflip: true,
      vflip: true,
    });
    expect(settingsParams(s).toString()).toBe(
      "size=64&color=e11d48&stroke=1.5&rotate=90&flip=horizontal%2Cvertical",
    );
    expect(settingsParams(DEFAULT_SETTINGS).toString()).toBe("");
  });

  it("неверные значения — по умолчанию", () => {
    expect(
      readSettings(
        new URLSearchParams("size=9999&color=red&stroke=1.3&rotate=45&flip=x"),
      ),
    ).toEqual(DEFAULT_SETTINGS);
    expect(parseColor("#ABCDEF")).toBe("#abcdef");
    expect(parseColor("#abc")).toBeUndefined();
  });

  it("пропсы Icon: цвет — не цветным наборам, толщина — только где есть линии", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      color: "#e11d48",
      stroke: 1.5,
      hflip: true,
    };
    expect(iconProps(s, { palette: false, strokes: true })).toEqual({
      height: 48,
      color: "#e11d48",
      strokeWidth: 1.5,
      flip: "horizontal",
    });
    expect(iconProps(s, { palette: true, strokes: false, size: 24 })).toEqual({
      height: 24,
      flip: "horizontal",
    });
  });
});
