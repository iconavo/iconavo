import { describe, expect, it } from "vitest";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import { listAfter, readCredits } from "./credits.js";

const ANCHOR =
  "The following Lucide icons are derived from the Feather project:";
const LICENSE = `ISC License

Copyright (c) Lucide Contributors

---

${ANCHOR}

airplay, alert-circle, trash-2, trash, x

The MIT License (MIT) (for the icons listed above)
`;

const base: SourceConfigInput = {
  id: "demo",
  name: "Demo",
  author: { name: "Demo" },
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  license: { spdx: "ISC", file: "LICENSE" },
  credits: [
    {
      name: "Feather",
      author: "Cole Bemis",
      url: "https://github.com/feathericons/feather",
      license: "MIT",
      list: ANCHOR,
    },
  ],
};
const config = (extra: Partial<SourceConfigInput> = {}) =>
  sourceConfigSchema.parse({ ...base, ...extra });

// Нынешние имена и алиасы, как в icons.json Lucide: старое имя ведёт к новому.
const ALIASES = new Map([
  ["alert-circle", "circle-alert"],
  ["trash-2", "trash"],
]);
const ICONS = new Set(["airplay", "circle-alert", "trash", "x"]);
const resolve = (name: string) => (ICONS.has(name) ? name : ALIASES.get(name));

describe("listAfter", () => {
  it("берёт первую непустую строку после фразы", () => {
    expect(listAfter(LICENSE, ANCHOR)).toBe(
      "airplay, alert-circle, trash-2, trash, x",
    );
  });

  it("без фразы или без строки после неё — undefined", () => {
    expect(listAfter(LICENSE, "Другая фраза:")).toBeUndefined();
    expect(listAfter(`текст\n${ANCHOR}\n\n`, ANCHOR)).toBeUndefined();
  });
});

describe("readCredits", () => {
  it("переводит старые имена в нынешние и убирает повторы", () => {
    const { credits, stop } = readCredits(config(), LICENSE, resolve);
    expect(stop).toEqual([]);
    expect(credits).toEqual([
      {
        name: "Feather",
        author: "Cole Bemis",
        url: "https://github.com/feathericons/feather",
        license: "MIT",
        icons: ["airplay", "circle-alert", "trash", "x"],
      },
    ]);
  });

  it("без credits в конфиге — пусто", () => {
    const { credits, stop } = readCredits(
      config({ credits: undefined }),
      LICENSE,
      resolve,
    );
    expect(credits).toEqual([]);
    expect(stop).toEqual([]);
  });

  it("незнакомое имя — «СТОП»", () => {
    const { credits, stop } = readCredits(
      config(),
      LICENSE.replace("airplay", "airplay, no-such-icon"),
      resolve,
    );
    expect(credits).toEqual([]);
    expect(stop).toEqual([
      "Feather: в наборе нет иконок из списка LICENSE: no-such-icon",
    ]);
  });

  it("автор поменял текст: нет фразы — «СТОП» с подсказкой", () => {
    const { stop } = readCredits(
      config(),
      LICENSE.replace(ANCHOR, "Icons from Feather:"),
      resolve,
    );
    expect(stop).toHaveLength(1);
    expect(stop[0]).toContain("поправьте credits в sources/demo.ts");
  });

  it("список не из имён — «СТОП»", () => {
    const { stop } = readCredits(
      config(),
      LICENSE.replace("airplay, ", "Airplay; "),
      resolve,
    );
    expect(stop).toHaveLength(1);
    expect(stop[0]).toContain("список иконок в LICENSE не разобран");
  });
});

describe("credits в конфиге", () => {
  it("лицензия — только из разрешённых", () => {
    const credits = base.credits?.map((c) => ({ ...c, license: "GPL-3.0" }));
    expect(sourceConfigSchema.safeParse({ ...base, credits }).success).toBe(
      false,
    );
  });

  it("адрес — только https", () => {
    const credits = base.credits?.map((c) => ({
      ...c,
      url: "http://example.com",
    }));
    expect(sourceConfigSchema.safeParse({ ...base, credits }).success).toBe(
      false,
    );
  });
});
