import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READERS } from "./formats.js";
import { PHOSPHOR_MODULE } from "./phosphor.testing.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-formats-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeSource(files: Record<string, unknown>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(
      join(dir, path),
      typeof content === "string" ? content : JSON.stringify(content),
      "utf8",
    );
  }
}

const read = async (format: keyof typeof READERS, svgFiles: string[]) =>
  Object.fromEntries(await READERS[format](dir, svgFiles));

describe("Lucide", () => {
  it("JSON рядом с иконкой; слаги категорий — названиями из categories/", async () => {
    await makeSource({
      "icons/a.json": {
        $schema: "../icon.schema.json",
        tags: ["Arrow", "left"],
        categories: ["arrows", "text"],
        aliases: [{ name: "old-a", deprecated: true }],
      },
      "categories/arrows.json": { title: "Arrows", icon: "arrow-left" },
      "categories/text.json": { title: "Text formatting" },
    });
    expect(await read("lucide", ["icons/a.svg", "icons/b.svg"])).toEqual({
      "icons/a.svg": {
        tags: ["Arrow", "left"],
        categories: ["Arrows", "Text formatting"],
      },
    });
  });

  it.each([
    [
      "нет файла категории",
      { tags: [], categories: ["nope"] },
      /нет categories\/nope\.json/,
    ],
    ["слаг с выходом из папки", { categories: ["../x"] }, /не слаг/],
    ["теги не списком", { tags: "x" }, /icons\/a\.json: tags/],
  ])("ошибка формата: %s", async (_n, meta, error) => {
    await makeSource({ "icons/a.json": meta });
    await expect(read("lucide", ["icons/a.svg"])).rejects.toThrow(error);
  });

  it("битый JSON — ошибка с путём", async () => {
    await makeSource({ "icons/a.json": "{" });
    await expect(read("lucide", ["icons/a.svg"])).rejects.toThrow(
      /icons\/a\.json — не JSON/,
    );
  });
});

describe("Tabler", () => {
  it("одна запись на контур и заливку; null в тегах — слово null", async () => {
    await makeSource({
      "icons.json": {
        heart: {
          name: "heart",
          category: "Health",
          tags: ["love", null, 911],
          styles: { outline: {}, filled: {} },
        },
        x: { name: "x", category: "", tags: [] },
      },
    });
    const meta = { tags: ["love", "null", 911], categories: ["Health"] };
    expect(
      await read("tabler", [
        "icons/outline/heart.svg",
        "icons/filled/heart.svg",
        "icons/outline/x.svg",
        "icons/outline/missing.svg",
      ]),
    ).toEqual({
      "icons/outline/heart.svg": meta,
      "icons/filled/heart.svg": meta,
      "icons/outline/x.svg": { tags: [], categories: [] },
    });
  });

  it("встроенные свойства объекта — не иконки", async () => {
    await makeSource({ "icons.json": {} });
    expect(await read("tabler", ["icons/outline/constructor.svg"])).toEqual({});
  });

  it("нет icons.json — ошибка", async () => {
    await expect(read("tabler", ["icons/outline/a.svg"])).rejects.toThrow(
      /нет icons\.json/,
    );
  });
});

describe("Phosphor", () => {
  it("иконка по имени без суффикса начертания", async () => {
    await makeSource({ "dist/index.mjs": PHOSPHOR_MODULE });
    const acorn = {
      tags: ["*new*", "savings", 911],
      categories: ["arrows", "technology & development"],
    };
    expect(
      await read("phosphor", [
        "assets/regular/acorn.svg",
        "assets/bold/acorn-bold.svg",
        "assets/thin/missing-thin.svg",
      ]),
    ).toEqual({
      "assets/regular/acorn.svg": acorn,
      "assets/bold/acorn-bold.svg": acorn,
    });
  });

  it("нет модуля или он в другом формате — ошибка с путём", async () => {
    await expect(read("phosphor", [])).rejects.toThrow(/нет dist\/index\.mjs/);
    await makeSource({ "dist/index.mjs": "export {};" });
    await expect(read("phosphor", [])).rejects.toThrow(
      /dist\/index\.mjs: модуль не экспортирует icons/,
    );
  });
});

describe("Fluent Emoji", () => {
  it("metadata.json папки эмодзи — и для оттенков кожи", async () => {
    await makeSource({
      "assets/Cat/metadata.json": {
        cldr: "cat",
        group: "Animals & Nature",
        keywords: ["Cat", "pet"],
      },
      "assets/Waving hand/metadata.json": {
        group: "People & Body",
        keywords: ["hand", "wave"],
        unicodeSkintones: ["1f44b"],
      },
    });
    expect(
      await read("fluent-emoji", [
        "assets/Cat/Flat/cat_flat.svg",
        "assets/Waving hand/Default/Flat/waving_hand_flat_default.svg",
        "assets/Waving hand/Dark/Flat/waving_hand_flat_dark.svg",
        "assets/Dog/Flat/dog_flat.svg",
      ]),
    ).toEqual({
      "assets/Cat/Flat/cat_flat.svg": {
        tags: ["Cat", "pet"],
        categories: ["Animals & Nature"],
      },
      "assets/Waving hand/Default/Flat/waving_hand_flat_default.svg": {
        tags: ["hand", "wave"],
        categories: ["People & Body"],
      },
      "assets/Waving hand/Dark/Flat/waving_hand_flat_dark.svg": {
        tags: ["hand", "wave"],
        categories: ["People & Body"],
      },
    });
  });
});
