import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IconavoIconSet } from "@iconavo-ui/core";
import { iconData } from "@iconavo-ui/core/internal";
import { describe, expect, it } from "vitest";
import {
  type BagIcon,
  type BagSet,
  bagArchive,
  bagFile,
  pickIcons,
  spriteSvg,
  symbolId,
} from "./bag-files";

const root = join(import.meta.dirname, "..", "..", "..");
const sets = new Map<string, IconavoIconSet>();
const setOf = (prefix: string): IconavoIconSet => {
  let set = sets.get(prefix);
  if (set === undefined) {
    set = JSON.parse(
      readFileSync(join(root, "data", prefix, "icons.json"), "utf8"),
    ) as IconavoIconSet;
    sets.set(prefix, set);
  }
  return set;
};
const bagIcon = (name: string): BagIcon => {
  const [prefix, bare] = name.split(":") as [string, string];
  const icon = iconData(setOf(prefix), bare);
  if (icon === null) throw new Error(`нет ${name} в data/`);
  return { name, icon };
};

const LUCIDE: BagSet = {
  prefix: "lucide",
  name: "Lucide",
  attribution:
    "Icons: Lucide by Lucide Contributors (https://lucide.dev), ISC license.",
  license: "ISC License\n\nCopyright (c) Lucide Contributors\n",
};
const FLUENT: BagSet = {
  prefix: "fluent-emoji-flat",
  name: "Fluent Emoji Flat",
  attribution:
    "Icons: Fluent Emoji Flat by Microsoft Corporation, MIT license.",
  license: "MIT License",
  notice: "Notice text",
};

describe("файлы сумки (шаг 5 фазы 4)", () => {
  it("SVG — родной размер, общий цвет и толщина только у линий", () => {
    const house = bagIcon("lucide:house");
    const plain = bagFile(house.icon, {});
    expect(plain).toContain('width="24" height="24"');
    expect(plain).toContain("currentColor");
    const look = bagFile(house.icon, { color: "#e11d48", stroke: 1.5 });
    expect(look).toContain('stroke="#e11d48"');
    expect(look).toContain('stroke-width="1.5"');
    const hand = bagIcon("fluent-emoji-flat:waving-hand");
    expect(bagFile(hand.icon, { color: "#e11d48", stroke: 1.5 })).toBe(
      bagFile(hand.icon, {}),
    );
  });

  it("спрайт: символ на иконку, ID внутри рисунков свои, комментарий без «--»", () => {
    const icons = [
      bagIcon("lucide:house"),
      bagIcon("fluent-emoji-flat:phoenix-bird"),
      bagIcon("fluent-emoji-flat:swan"),
    ];
    const sprite = spriteSvg(icons, [LUCIDE, FLUENT], {});
    const [comment = "", ...rest] = sprite.split("\n-->\n");
    expect(comment.startsWith("<!--\nIcons from Iconavo")).toBe(true);
    expect(comment.slice(4)).not.toContain("--");
    expect(comment).toContain("Icons: Lucide by Lucide Contributors");
    expect(comment).toContain(
      'Usage: <svg width="24" height="24"><use href="iconavo-sprite.svg#lucide-house"/></svg>',
    );
    const body = rest.join("");
    expect(body.match(/<symbol /g)).toHaveLength(3);
    expect(body).toContain('<symbol id="lucide-house" viewBox="0 0 24 24">');
    const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      ids.some((id) => id?.startsWith("fluent-emoji-flat-phoenix-bird-")),
    ).toBe(true);
  });

  it("иконки, которых нет в загруженных наборах, — списком, а не молча (ревизия фазы 5, С-11)", () => {
    const { icons, missing } = pickIcons(
      ["lucide:house", "lucide:no-such-icon", "ph:house", "lucide:heart"],
      [setOf("lucide")],
    );
    expect(icons.map((i) => i.name)).toEqual(["lucide:house", "lucide:heart"]);
    expect(missing).toEqual(["lucide:no-such-icon", "ph:house"]);
  });

  it("ID внутри рисунков не совпадают с ID символа соседней иконки «имя-N» (ревизия фазы 5, С-26)", () => {
    const set: IconavoIconSet = {
      prefix: "test",
      width: 24,
      height: 24,
      icons: {
        a: { body: '<path id="p" d="M0 0h1v1z"/><use href="#p"/>' },
        "a-0": { body: '<path d="M0 0h2v2z"/>' },
      },
    };
    const icons = ["a", "a-0"].map((bare): BagIcon => {
      const icon = iconData(set, bare);
      if (icon === null) throw new Error(`нет test:${bare}`);
      return { name: `test:${bare}`, icon };
    });
    const sprite = spriteSvg(icons, [], {});
    const ids = [...sprite.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toContain("test-a-0");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ID символов не совпадают ни у одной пары имён data/", () => {
    const seen = new Map<string, string>();
    const prefixes = readdirSync(join(root, "data"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const prefix of prefixes) {
      const set = setOf(prefix);
      for (const name of [
        ...Object.keys(set.icons),
        ...Object.keys(set.aliases ?? {}),
      ]) {
        const full = `${prefix}:${name}`;
        const id = symbolId(full);
        expect(seen.get(id) ?? full, id).toBe(full);
        seen.set(id, full);
      }
    }
    expect(seen.size).toBeGreaterThan(40_000);
  });

  it("ZIP: README, полные тексты лицензий с NOTICE, иконки по наборам", () => {
    const icons = [bagIcon("lucide:house"), bagIcon("fluent-emoji-flat:swan")];
    const files = bagArchive(
      icons,
      [LUCIDE, FLUENT],
      {},
      new Date("2026-11-03T12:00:00Z"),
    );
    expect(files.map((f) => f.path)).toEqual([
      "README.txt",
      "LICENSES/lucide.txt",
      "LICENSES/fluent-emoji-flat.txt",
      "lucide/house.svg",
      "fluent-emoji-flat/swan.svg",
    ]);
    const text = (path: string) =>
      String(files.find((f) => f.path === path)?.data);
    expect(text("README.txt")).toBe(
      [
        "Icons from Iconavo (https://iconavo.dev), downloaded on 2026-11-03.",
        "",
        "Lucide",
        LUCIDE.attribution,
        "License text: LICENSES/lucide.txt",
        "  lucide/house.svg",
        "",
        "Fluent Emoji Flat",
        FLUENT.attribution,
        "License text: LICENSES/fluent-emoji-flat.txt",
        "  fluent-emoji-flat/swan.svg",
        "",
      ].join("\n"),
    );
    expect(text("LICENSES/lucide.txt")).toBe(
      "ISC License\n\nCopyright (c) Lucide Contributors\n",
    );
    expect(text("LICENSES/fluent-emoji-flat.txt")).toBe(
      "MIT License\n\nNOTICE\n\nNotice text\n",
    );
  });
});
