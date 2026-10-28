import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPECTED_WARNINGS } from "./check.js";
import { MANY_PER_SET } from "./config.js";
import { manySets } from "./many-page.js";
import { NET_NAMES } from "./net-page.js";
import { visibleNames } from "./server.js";
import {
  ATTRIBUTE_CELLS,
  MISSING_CELLS,
  renderTagPage,
  tagData,
} from "./tag-page.js";

const DATA = fileURLToPath(new URL("../../../../data/", import.meta.url));
const SETS = [
  "lucide",
  "tabler",
  "material-symbols",
  "ph",
  "fluent-emoji-flat",
];

/** Иконки, которых нет нарочно: раздел «Иконки нет». */
const ABSENT = ["lucide:no-such-icon", "nope:house", "Lucide:House"];

describe("страница тега", () => {
  it("иконки каталога на странице — видимые иконки data/, кроме нарочно отсутствующих", async () => {
    const html = renderTagPage(tagData("https://api.iconavo.dev"));
    const icons = [...html.matchAll(/<iconavo-icon icon="([^"]+)"/g)].map(
      (m) => m[1] as string,
    );
    expect(icons.length).toBeGreaterThan(20);
    const names = new Map<string, string[]>();
    const unknown: string[] = [];
    for (const icon of new Set(icons)) {
      if (ABSENT.includes(icon)) continue;
      const [prefix, name] = icon.split(":") as [string, string];
      if (!names.has(prefix))
        names.set(prefix, await visibleNames(DATA, prefix));
      if (!names.get(prefix)?.includes(name)) unknown.push(icon);
    }
    expect(unknown).toEqual([]);
    expect(MISSING_CELLS.map((c) => c.attributes.icon)).toEqual([
      ...ABSENT,
      "lucide:house",
    ]);
  });

  it("неверные значения и иконки, которых нет, — ровно предупреждения, которых ждёт проверка", () => {
    const invalid = ATTRIBUTE_CELLS.filter((c) =>
      c.caption.includes("неверно"),
    );
    expect(invalid).toHaveLength(3);
    const fromCells = invalid.map((c) => {
      const [name, value] = Object.entries(c.attributes).find(
        ([key]) => key !== "icon",
      ) as [string, string];
      return `Iconavo: invalid ${name} "${value}"`;
    });
    const fromMissing = [
      'Iconavo: icon "lucide:no-such-icon" not found',
      'Iconavo: icon "nope:house" not found',
      'Iconavo: invalid icon name "Lucide:House"',
    ];
    expect(EXPECTED_WARNINGS.map((w) => w.split(", use")[0])).toEqual([
      ...fromCells,
      ...fromMissing,
    ]);
  });
});

describe("страница сбоев сети", () => {
  it("иконки и алиас есть в data/, последняя — нарочно отсутствующая", async () => {
    const file = JSON.parse(
      await readFile(`${DATA}lucide/icons.json`, "utf8"),
    ) as { icons: Record<string, unknown>; aliases: Record<string, unknown> };
    const present = NET_NAMES.slice(0, -1).map((name) => name.split(":")[1]);
    expect(
      present.filter((n) => !(n in file.icons) && !(n in file.aliases)),
    ).toEqual([]);
    expect(present.filter((n) => n in file.aliases)).toEqual(["home"]);
    expect(NET_NAMES.at(-1)).toBe("lucide:no-such-icon");
  });
});

describe("страница 5000 иконок", () => {
  it("по 1000 первых видимых имён каждого из пяти наборов — 5000", async () => {
    const names: Record<string, string[]> = {};
    for (const id of SETS) names[id] = await visibleNames(DATA, id);
    const sets = manySets(names);
    expect(sets.map(([set]) => set)).toEqual(SETS);
    expect(sets.map(([, list]) => list.length)).toEqual(
      SETS.map(() => MANY_PER_SET),
    );
    expect(sets[0]?.[1].slice(0, 2)).toEqual(names.lucide?.slice(0, 2));
  });
});
