import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IconsFile } from "@iconavo-ui/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoConfig } from "../search/fixture.testing.js";
import { DEMO_LAST_MODIFIED, writeCdnDemoSet } from "./fixture.testing.js";
import { loadCdnSet, transformedNames } from "./load.js";

const ICONS = {
  house: { body: '<path d="M1 1h2"/>' },
  star: { body: "<g/>", hidden: true },
};
const config = demoConfig("demo");

let root: string;
let dataDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-cdn-"));
  dataDir = join(root, "data");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Правит записанный файл набора: так получаются сломанные входы. */
async function rewrite(
  file: string,
  change: (data: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(dataDir, "demo", file);
  const data = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  change(data);
  await writeFile(path, JSON.stringify(data));
}

describe("loadCdnSet", () => {
  it("читает набор: версия из info.json сходится с icons.json", async () => {
    const { version } = await writeCdnDemoSet(dataDir, {
      id: "demo",
      icons: ICONS,
      aliases: { home: { parent: "house" } },
    });
    const set = await loadCdnSet(config, dataDir);
    expect(set).toMatchObject({
      id: "demo",
      name: "Demo demo",
      version,
      lastModified: DEMO_LAST_MODIFIED,
    });
    expect(Object.keys(set.file.icons)).toEqual(["house", "star"]);
    expect(set.file.aliases).toEqual({ home: { parent: "house" } });
    expect(set.info.version).toBe(version);
  });

  it("нет файла — подсказка пересобрать", async () => {
    await expect(loadCdnSet(config, dataDir)).rejects.toThrow(
      "icons.json не читается — запустите pnpm data demo",
    );
  });

  it("не по схеме — какой файл и что не так", async () => {
    await writeCdnDemoSet(dataDir, { id: "demo", icons: ICONS });
    await rewrite("icons.json", (d) => {
      (d.icons as Record<string, unknown>)["Bad Name"] = { body: "<g/>" };
    });
    await expect(loadCdnSet(config, dataDir)).rejects.toThrow(
      /icons\.json не проходит схему/,
    );
  });

  it("icons.json от другого набора", async () => {
    await writeCdnDemoSet(dataDir, { id: "demo", icons: ICONS });
    await rewrite("icons.json", (d) => {
      d.prefix = "other";
    });
    await expect(loadCdnSet(config, dataDir)).rejects.toThrow(
      "icons.json — от набора «other», а не «demo»",
    );
  });

  it("версия не сходится или её нет", async () => {
    await writeCdnDemoSet(dataDir, {
      id: "demo",
      icons: ICONS,
      version: "ffffffff",
    });
    await expect(loadCdnSet(config, dataDir)).rejects.toThrow(
      /версия в info\.json \(ffffffff\).*запустите pnpm data demo/,
    );
    await rewrite("info.json", (d) => {
      d.version = undefined;
    });
    await expect(loadCdnSet(config, dataDir)).rejects.toThrow(
      "в info.json нет версии набора",
    );
  });

  it("нет lastModified", async () => {
    await writeCdnDemoSet(dataDir, {
      id: "demo",
      icons: ICONS,
      lastModified: null,
    });
    await expect(loadCdnSet(config, dataDir)).rejects.toThrow(
      "в icons.json нет lastModified",
    );
  });

  it("повороты и отражения — СТОП с именами, rotate: 0 допустим", async () => {
    await writeCdnDemoSet(dataDir, {
      id: "demo",
      icons: { ...ICONS, flipped: { body: "<g/>", hFlip: true } },
      aliases: {
        turned: { parent: "house", rotate: 1 },
        same: { parent: "house", rotate: 0 },
      },
    });
    await expect(loadCdnSet(config, dataDir)).rejects.toThrow(
      "не поддерживаются: 2 — flipped, turned",
    );
  });
});

describe("transformedNames", () => {
  it("иконки и алиасы с поворотом или отражением, по алфавиту", () => {
    const file = {
      prefix: "demo",
      icons: { b: { body: "x", vFlip: true }, a: { body: "x", rotate: 0 } },
      aliases: { c: { parent: "a", rotate: 2 }, d: { parent: "a" } },
    } as IconsFile;
    expect(transformedNames(file)).toEqual(["b", "c"]);
  });
});
