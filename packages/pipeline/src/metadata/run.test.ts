import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validate } from "@iconavo-ui/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedIcon } from "../normalize/normalize.js";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import { licenseHash } from "./license.js";
import { type MetadataIcon, pickSamples, setMetadata } from "./run.js";

const TEXT = "MIT License\n\nCopyright (c) Demo\n";
const base: SourceConfigInput = {
  id: "demo",
  name: "Demo",
  author: { name: "Demo", url: "https://example.com/demo" },
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [{ path: "icons/outline" }, { path: "icons/filled" }],
  palette: "monochrome",
  grid: 24,
  license: {
    spdx: "MIT",
    file: "LICENSE",
    confirmed: licenseHash("MIT", TEXT),
  },
  metadata: "tabler",
  suffixes: { "": "Outline", "-filled": "Filled" },
};
const config = (extra: Partial<SourceConfigInput> = {}) =>
  sourceConfigSchema.parse({ ...base, ...extra });
const ENTRY: LockEntry = {
  type: "npm",
  version: "1.0.0",
  integrity: "sha512-AAAA",
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-metadata-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeSource(files: Record<string, unknown> = {}) {
  const all: Record<string, unknown> = {
    LICENSE: TEXT,
    "package.json": { name: "demo-icons", license: "MIT" },
    "icons.json": {
      heart: { category: "Health", tags: ["Love", "heart", "*new*"] },
      arrow: { category: "Arrows", tags: ["direction"] },
    },
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(
      join(dir, path),
      typeof content === "string" ? content : JSON.stringify(content),
      "utf8",
    );
  }
}

const icon = (body = `<path d="M0 0h24v24H0z"/>`): NormalizedIcon => ({
  body,
  width: 24,
  height: 24,
});
const ICONS: MetadataIcon[] = [
  { name: "arrow", file: "icons/outline/arrow.svg", icon: icon() },
  { name: "heart", file: "icons/outline/heart.svg", icon: icon("<circle/>") },
  { name: "heart-filled", file: "icons/filled/heart.svg", icon: icon("<g/>") },
];
const names = (list: readonly MetadataIcon[] = ICONS) =>
  new Set(list.map((i) => i.name));
const run = (cfg = config(), icons = ICONS) =>
  setMetadata(cfg, dir, ENTRY, icons, names(icons));

const fileOf = (r: Awaited<ReturnType<typeof run>>, name: string) =>
  r.files?.find((f) => f.name === name)?.text;
const jsonOf = (r: Awaited<ReturnType<typeof run>>, name: string) =>
  JSON.parse(fileOf(r, name) ?? "null");

describe("метаданные набора", () => {
  it("три JSON проходят схему; теги автора у вариантов общие; категории по алфавиту", async () => {
    await makeSource();
    const r = await run();
    expect(r.stop).toEqual([]);
    expect(r.files?.map((f) => f.name)).toEqual([
      "info.json",
      "metadata.json",
      "search.json",
      "LICENSE",
    ]);
    for (const kind of ["info", "metadata", "search"] as const) {
      expect(validate(kind, jsonOf(r, `${kind}.json`))).toEqual([]);
    }
    expect(jsonOf(r, "metadata.json")).toEqual({
      categories: { Arrows: ["arrow"], Health: ["heart", "heart-filled"] },
      suffixes: { "": "Outline", "-filled": "Filled" },
    });
    const search = jsonOf(r, "search.json");
    expect(search.prefix).toBe("demo");
    expect(search.icons["heart-filled"].tags).toEqual(["love", "heart"]);
    expect(search.icons.heart.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(r.icons.get("heart")?.from).toBe("author");
    expect(r.categories).toEqual([
      ["Arrows", ["arrow"]],
      ["Health", ["heart", "heart-filled"]],
    ]);
    expect(fileOf(r, "LICENSE")).toBe(TEXT);
  });

  it("две сборки подряд дают одинаковые тексты", async () => {
    await makeSource();
    expect((await run()).files).toEqual((await run()).files);
  });

  it("без формата метаданных — теги из частей имени, категорий нет", async () => {
    await makeSource();
    const r = await run(config({ metadata: undefined }));
    expect(r.stop).toEqual([]);
    expect(r.icons.get("heart-filled")).toMatchObject({
      tags: ["heart"],
      from: "name",
      categories: [],
    });
    expect(r.withoutAuthor).toEqual([]);
    expect(jsonOf(r, "metadata.json")).toEqual({
      suffixes: { "": "Outline", "-filled": "Filled" },
    });
  });

  it("теги автора нашлись не у всех: больше 1% — «СТОП», ровно 1% — можно", async () => {
    const many = (count: number, missing: number) =>
      Array.from({ length: count }, (_, i) => {
        const name = `${i < missing ? "nometa" : "icon"}${i}`;
        return { name, file: `icons/outline/${name}.svg`, icon: icon() };
      });
    const json = (list: MetadataIcon[]) =>
      Object.fromEntries(
        list
          .filter((i) => i.name.startsWith("icon"))
          .map((i) => [i.name, { tags: ["x"] }]),
      );
    const ok = many(100, 1);
    await makeSource({ "icons.json": json(ok) });
    const fine = await run(config(), ok);
    expect(fine.stop).toEqual([]);
    expect(fine.withoutAuthor).toEqual(["nometa0"]);
    expect(fine.icons.get("nometa0")?.tags).toEqual(["nometa0"]);

    const bad = many(100, 2);
    await makeSource({ "icons.json": json(bad) });
    expect((await run(config(), bad)).stop).toEqual([
      "теги автора нашлись не у всех иконок: без них 2 из 100 (2,0%) — больше 1%, проверьте формат метаданных (tabler)",
    ]);
  });

  it("метаданные не читаются — «СТОП», но лицензия для отчёта есть", async () => {
    await makeSource({ "icons.json": "{" });
    const r = await run();
    expect(r.stop).toHaveLength(1);
    expect(r.stop[0]).toMatch(
      /^формат метаданных автора изменился \(tabler\): icons\.json — не JSON/,
    );
    expect(r.files).toBeUndefined();
    expect(r.license?.status).toBe("confirmed");
  });

  it("лицензия не подтверждена — файлов нет, метаданные для отчёта есть", async () => {
    await makeSource();
    const r = await run(config({ license: { spdx: "MIT", file: "LICENSE" } }));
    expect(r.stop[0]).toMatch(/^лицензия не подтверждена/);
    expect(r.files).toBeUndefined();
    expect(r.icons.get("heart")?.tags).toEqual(["love", "heart"]);
  });
});

describe("витрина", () => {
  it("первое найденное имя каждого понятия", () => {
    expect(
      pickSamples([
        "user",
        "star",
        "magnifying-glass",
        "house",
        "gear",
        "heart",
        "zebra",
      ]),
    ).toEqual(["house", "magnifying-glass", "gear", "user", "heart", "star"]);
    expect(pickSamples(["home", "house", "search"])[0]).toBe("home");
  });

  it("понятий не хватило — добор в постоянном порядке", () => {
    const names = ["home", "a", "b", "c", "d", "e", "f", "g"];
    const picked = pickSamples(names);
    expect(picked).toHaveLength(6);
    expect(picked[0]).toBe("home");
    expect(pickSamples([...names].reverse())).toEqual(picked);
  });

  it("витрина из конфига; неизвестное имя — «СТОП»", async () => {
    await makeSource();
    const own = await run(config({ samples: ["heart-filled", "arrow"] }));
    expect(own.stop).toEqual([]);
    expect(jsonOf(own, "info.json").samples).toEqual(["heart-filled", "arrow"]);
    const wrong = await run(config({ samples: ["nope"] }));
    expect(wrong.stop).toEqual([
      "витрина: в наборе нет иконок nope — поправьте samples в sources/demo.ts (алиасы не подходят)",
    ]);
  });
});
