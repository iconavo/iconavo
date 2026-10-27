// SVG ядра без настроек побайтно равен файлу статики (ADR-0022) — для каждой иконки и каждого
// алиаса data/: edge API отдаёт его по адресу без параметров (ADR-0024), а файлы статики
// неизменяемы. Здесь же — что ни в одном рисунке нет «'» и «\»: на этом держится кодирование
// data-URL в CSS edge API, как у Iconify (двойные кавычки заменяются одинарными). И что уникальные
// ID рендера ядра (ADR-0031) не рвут ни одной ссылки внутри наших рисунков.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  iconData,
  iconToSvg,
  replaceIds,
  svgToString,
} from "@iconavo-ui/core/internal";
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

  it.each(sets)(
    "%s: поворотов и отражений в данных нет — статика их не умеет",
    async (id) => {
      const file = JSON.parse(
        await readFile(join(DATA, id, "icons.json"), "utf8"),
      ) as IconsFile;
      const turned = [
        ...Object.entries(file.icons),
        ...Object.entries(file.aliases ?? {}),
      ]
        .filter(([, item]) => item.rotate || item.hFlip || item.vFlip)
        .map(([name]) => name);
      expect(turned.slice(0, 5)).toEqual([]);
    },
  );

  it.each(sets)(
    "%s: уникальные ID ядра — каждая ссылка ведёт на свой ID, старых ID не осталось",
    async (id) => {
      const file = JSON.parse(
        await readFile(join(DATA, id, "icons.json"), "utf8"),
      ) as IconsFile;
      const ids = (body: string) =>
        [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
      const refs = (body: string) =>
        [...body.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map(
          (m) => (m[1] ?? m[2]) as string,
        );
      const bad: string[] = [];
      for (const [name, icon] of Object.entries(file.icons)) {
        const before = ids(icon.body);
        if (before.length === 0) continue;
        const body = replaceIds(icon.body, () => "t_");
        const after = new Set(ids(body));
        const links = refs(body);
        if (
          links.length !== refs(icon.body).length ||
          links.some((ref) => !after.has(ref)) ||
          before.some((old) => body.includes(old))
        ) {
          bad.push(name);
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
    },
  );
});
