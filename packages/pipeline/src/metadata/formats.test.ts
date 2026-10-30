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
        aliases: ["icons/old-a.svg"],
      },
    });
  });

  it("прежние имена — объектом с причиной или строкой; путь в имени — ошибка формата", async () => {
    await makeSource({
      "icons/a.json": { tags: ["a"], aliases: ["a-old", { name: "a-typo" }] },
      "icons/b.json": { tags: ["b"] },
    });
    expect(await read("lucide", ["icons/a.svg", "icons/b.svg"])).toEqual({
      "icons/a.svg": {
        tags: ["a"],
        categories: [],
        aliases: ["icons/a-old.svg", "icons/a-typo.svg"],
      },
      "icons/b.svg": { tags: ["b"], categories: [] },
    });
    await makeSource({ "icons/a.json": { aliases: ["../x"] } });
    await expect(read("lucide", ["icons/a.svg"])).rejects.toThrow(
      /прежнее имя «\.\.\/x» — не имя файла/,
    );
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

  it("ссылки $extends и $group раскрываются на месте, по цепочке, без повторов", async () => {
    // Пример из правил Lucide (metadata-conventions): file-minus — это file с группой minus.
    await makeSource({
      "icons/file.json": { tags: ["document"], categories: ["files"] },
      "icons/file-minus.json": {
        tags: ["$extends:file", "$group:minus", "erase", "remove"],
        categories: ["$extends:file", "text"],
        aliases: ["file-minus-old"],
      },
      "icons/file-minus-2.json": {
        tags: ["$extends:file-minus", "two"],
        categories: ["$extends:file-minus"],
      },
      "groups/minus.json": {
        $schema: "../group.schema.json",
        description: "Modifier: remove something",
        tags: ["remove", "delete"],
      },
      "categories/files.json": { title: "Files" },
      "categories/text.json": { title: "Text formatting" },
    });
    // Иконка-основа file в списке не нужна: её JSON читается по ссылке. Прежние имена не наследуются.
    expect(
      await read("lucide", ["icons/file-minus.svg", "icons/file-minus-2.svg"]),
    ).toEqual({
      "icons/file-minus.svg": {
        tags: ["document", "remove", "delete", "erase"],
        categories: ["Files", "Text formatting"],
        aliases: ["icons/file-minus-old.svg"],
      },
      "icons/file-minus-2.svg": {
        tags: ["document", "remove", "delete", "erase", "two"],
        categories: ["Files", "Text formatting"],
      },
    });
  });

  it("знак доллара — обычный тег: ссылка — это «$» и буква", async () => {
    await makeSource({ "icons/a.json": { tags: ["$", "usd"] } });
    expect(await read("lucide", ["icons/a.svg"])).toEqual({
      "icons/a.svg": { tags: ["$", "usd"], categories: [] },
    });
  });

  it.each([
    [
      "иконки нет",
      { "icons/a.json": { tags: ["$extends:nope"] } },
      /icons\/a\.json: «\$extends:nope» — нет icons\/nope\.json/,
    ],
    [
      "ссылки по кругу",
      {
        "icons/a.json": { tags: ["$extends:b"] },
        "icons/b.json": { tags: ["$extends:a"] },
      },
      /icons\/a\.json: ссылки «\$extends:» идут по кругу/,
    ],
    [
      "иконка ссылается на себя",
      { "icons/a.json": { categories: ["$extends:a"] } },
      /icons\/a\.json: ссылки «\$extends:» идут по кругу/,
    ],
    [
      "имя иконки с выходом из папки",
      { "icons/a.json": { tags: ["$extends:../x"] } },
      /«\$extends:\.\.\/x» — не имя иконки/,
    ],
    [
      "группы нет",
      { "icons/a.json": { tags: ["$group:nope"] } },
      /icons\/a\.json: «\$group:nope» — нет groups\/nope\.json/,
    ],
    [
      "имя группы с выходом из папки",
      { "icons/a.json": { tags: ["$group:../x"] } },
      /«\$group:\.\.\/x» — не имя группы/,
    ],
    [
      "группа в категориях",
      {
        "icons/a.json": { categories: ["$group:g"] },
        "groups/g.json": { tags: ["x"] },
      },
      /категория «\$group:g» — не слаг/,
    ],
    [
      "незнакомая ссылка",
      { "icons/a.json": { tags: ["$foo:bar"] } },
      /icons\/a\.json: незнакомая ссылка «\$foo:bar»/,
    ],
    [
      "ссылка внутри группы",
      {
        "icons/a.json": { tags: ["$group:g"] },
        "groups/g.json": { tags: ["$group:h"] },
      },
      /незнакомая ссылка «\$group:h»/,
    ],
  ])("ошибка ссылки: %s", async (_n, files, error) => {
    await makeSource(files);
    await expect(read("lucide", ["icons/a.svg"])).rejects.toThrow(error);
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

  it("прежнее имя — у каждого начертания со своим суффиксом", async () => {
    await makeSource({ "dist/index.mjs": PHOSPHOR_MODULE });
    const read2 = await read("phosphor", [
      "assets/regular/asclepius.svg",
      "assets/bold/asclepius-bold.svg",
    ]);
    expect(read2["assets/regular/asclepius.svg"]?.aliases).toEqual([
      "assets/regular/caduceus.svg",
    ]);
    expect(read2["assets/bold/asclepius-bold.svg"]?.aliases).toEqual([
      "assets/bold/caduceus-bold.svg",
    ]);
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
