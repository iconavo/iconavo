// SVG ядра без настроек побайтно равен файлу статики (ADR-0022) — для каждой иконки и каждого
// алиаса data/: edge API отдаёт его по адресу без параметров (ADR-0024), а файлы статики
// неизменяемы. Здесь же — что ни в одном рисунке нет «'» и «\»: на этом держится кодирование
// data-URL в CSS edge API, как у Iconify (двойные кавычки заменяются одинарными).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { iconData, iconToSvg, svgToString } from "@iconavo-ui/core";
import type { IconsFile } from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import { effectiveIcon } from "./files.js";
import { svgOf } from "./svg.js";

const DATA = fileURLToPath(new URL("../../../../data/", import.meta.url));

const sets = (await readdir(DATA, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("SVG ядра и файлы статики", () => {
  it("в data/ все пять наборов", () => {
    expect(sets.length).toBeGreaterThanOrEqual(5);
  });

  it.each(sets)("%s: без настроек — побайтно тот же SVG", async (id) => {
    const file = JSON.parse(
      await readFile(join(DATA, id, "icons.json"), "utf8"),
    ) as IconsFile;
    const names = [
      ...Object.keys(file.icons),
      ...Object.keys(file.aliases ?? {}),
    ];
    const differ: string[] = [];
    for (const name of names) {
      const icon = iconData(file, name);
      const fromCore =
        icon === null ? "нет иконки" : svgToString(iconToSvg(icon));
      if (fromCore !== svgOf(effectiveIcon(file, name))) differ.push(name);
    }
    expect(differ.slice(0, 5)).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(sets)("%s: в рисунках нет «'» и «\\»", async (id) => {
    const file = JSON.parse(
      await readFile(join(DATA, id, "icons.json"), "utf8"),
    ) as IconsFile;
    const bad = Object.entries(file.icons)
      .filter(([, icon]) => /['\\]/.test(icon.body))
      .map(([name]) => name);
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
