import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCdnSet } from "../cdn/load.js";
import { demoConfig } from "../search/fixture.testing.js";
import { DEMO_LICENSE, writeNpmDemoSet } from "./fixture.testing.js";
import { loadNpmSet, namesOf } from "./load.js";

const ICONS = {
  house: { body: '<path d="M1 1h2"/>' },
  star: { body: "<g/>", hidden: true },
};
const config = demoConfig("demo");

let root: string;
let dataDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-npm-"));
  dataDir = join(root, "data");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const path = (file: string) => join(dataDir, "demo", file);

describe("loadNpmSet", () => {
  it("читает набор: файлы для пакета побайтно, журнал и метаданные", async () => {
    const { version } = await writeNpmDemoSet(dataDir, {
      id: "demo",
      icons: ICONS,
      aliases: { home: { parent: "house" } },
      metadata: { categories: { Дом: ["house"] } },
      previous: ["aaaaaaaa"],
    });
    const set = await loadNpmSet(config, dataDir);
    expect(set.version).toBe(version);
    expect(set.releases).toEqual([version, "aaaaaaaa"]);
    expect(set.metadata).toEqual({ categories: { Дом: ["house"] } });
    expect(set.files.map((f) => f.path)).toEqual([
      "icons.json",
      "info.json",
      "metadata.json",
      "LICENSE",
    ]);
    for (const f of set.files) {
      const disk = await readFile(path(f.path));
      expect(Buffer.from(f.data).equals(disk)).toBe(true);
    }
  });

  it("NOTICE из info.json идёт в пакет", async () => {
    await writeNpmDemoSet(dataDir, {
      id: "demo",
      icons: ICONS,
      notice: "Demo notice\n",
    });
    const set = await loadNpmSet(config, dataDir);
    expect(set.files.map((f) => f.path)).toContain("NOTICE");
  });

  it("повороты и отражения пакету не мешают, в отличие от раздачи", async () => {
    await writeNpmDemoSet(dataDir, {
      id: "demo",
      icons: { arrow: { body: "<g/>", rotate: 1 } },
    });
    await expect(loadCdnSet(config, dataDir)).rejects.toThrow("повороты");
    await expect(loadNpmSet(config, dataDir)).resolves.toMatchObject({
      id: "demo",
    });
  });

  it("LICENSE не совпадает с текстом в info.json — ошибка", async () => {
    await writeNpmDemoSet(dataDir, { id: "demo", icons: ICONS });
    await writeFile(path("LICENSE"), `${DEMO_LICENSE}\nдругое`);
    await expect(loadNpmSet(config, dataDir)).rejects.toThrow(
      "LICENSE не совпадает с текстом лицензии в info.json — запустите pnpm data demo",
    );
  });

  it("нет LICENSE — ошибка", async () => {
    await writeNpmDemoSet(dataDir, { id: "demo", icons: ICONS });
    await rm(path("LICENSE"));
    await expect(loadNpmSet(config, dataDir)).rejects.toThrow(
      "нет файла LICENSE",
    );
  });

  it("NOTICE без записи в info.json — лишний", async () => {
    await writeNpmDemoSet(dataDir, { id: "demo", icons: ICONS });
    await writeFile(path("NOTICE"), "Demo notice\n");
    await expect(loadNpmSet(config, dataDir)).rejects.toThrow(
      "лишний файл NOTICE",
    );
  });

  it("NOTICE отличается от info.json — ошибка", async () => {
    await writeNpmDemoSet(dataDir, {
      id: "demo",
      icons: ICONS,
      notice: "Demo notice\n",
    });
    await writeFile(path("NOTICE"), "Другой текст\n");
    await expect(loadNpmSet(config, dataDir)).rejects.toThrow(
      "NOTICE не совпадает",
    );
  });

  it("перевод строки Windows в файле данных — ошибка: пакет зависел бы от системы", async () => {
    await writeNpmDemoSet(dataDir, { id: "demo", icons: ICONS });
    await writeFile(path("metadata.json"), "{\r\n}\r\n");
    await expect(loadNpmSet(config, dataDir)).rejects.toThrow(
      "в metadata.json есть перевод строки Windows",
    );
  });

  it("metadata.json не по схеме — ошибка с подсказкой", async () => {
    await writeNpmDemoSet(dataDir, { id: "demo", icons: ICONS });
    await writeFile(path("metadata.json"), '{"lost": true}\n');
    await expect(loadNpmSet(config, dataDir)).rejects.toThrow(
      "metadata.json не проходит схему",
    );
  });

  it("журнал не от этого icons.json — ошибка", async () => {
    await writeNpmDemoSet(dataDir, { id: "demo", icons: ICONS });
    const journal = JSON.parse(await readFile(path("changelog.json"), "utf8"));
    journal.releases[0].version = "bbbbbbbb";
    await writeFile(path("changelog.json"), JSON.stringify(journal));
    await expect(loadNpmSet(config, dataDir)).rejects.toThrow(
      "последний выпуск в changelog.json (bbbbbbbb) не от этого icons.json",
    );
  });

  it("нет metadata.json — подсказка пересобрать", async () => {
    await writeNpmDemoSet(dataDir, { id: "demo", icons: ICONS });
    await rm(path("metadata.json"));
    await expect(loadNpmSet(config, dataDir)).rejects.toThrow(
      "metadata.json не читается — запустите pnpm data demo",
    );
  });
});

describe("namesOf", () => {
  it("иконки и алиасы вместе", () => {
    expect([
      ...namesOf({ icons: { a: {}, b: {} }, aliases: { c: {} } }),
    ]).toEqual(["a", "b", "c"]);
    expect([...namesOf({ icons: { a: {} } })]).toEqual(["a"]);
  });
});
