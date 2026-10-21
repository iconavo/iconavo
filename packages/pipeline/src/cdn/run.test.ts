import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoConfig } from "../search/fixture.testing.js";
import { checksumsSchema, manifestSchema } from "./files.js";
import {
  type CdnDemoSet,
  DEMO_LAST_MODIFIED,
  writeCdnDemoSet,
} from "./fixture.testing.js";
import { buildCdn, cdnStop } from "./run.js";

const HOUSE = '<path d="M1 1h2"/>';
const DEMO: CdnDemoSet = {
  id: "demo",
  icons: { house: { body: HOUSE }, old: { body: "<g/>", hidden: true } },
  aliases: { home: { parent: "house" }, gone: { parent: "old" } },
  samples: ["house"],
};
const DEMO_PLUS: CdnDemoSet = {
  ...DEMO,
  icons: { ...DEMO.icons, star: { body: "<g/>" } },
};
const OTHER: CdnDemoSet = { id: "other", icons: { star: { body: "<g/>" } } };
const configs = [demoConfig("demo"), demoConfig("other")];

let root: string;
let dataDir: string;
let outDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-cdn-"));
  dataDir = join(root, "data");
  outDir = join(root, "dist-cdn");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const build = () => buildCdn(configs, { dataDir, outDir, concurrency: 2 });
const text = (path: string) => readFile(join(outDir, path), "utf8");

/** Все файлы папки: путь через «/» → время изменения. */
async function walk(dir: string, rel = ""): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      for (const [p, t] of await walk(dir, path)) out.set(p, t);
    } else {
      out.set(path, (await stat(join(dir, path))).mtimeMs);
    }
  }
  return out;
}

describe("buildCdn", () => {
  it("строит папки версий, файлы на каждое имя и манифест", async () => {
    const demo = await writeCdnDemoSet(dataDir, DEMO);
    const other = await writeCdnDemoSet(dataDir, OTHER);
    const report = await build();
    expect(cdnStop(report)).toBe(false);
    expect(report.sets.map((s) => s.status)).toEqual(["written", "written"]);
    expect(report.manifestWritten).toBe(true);
    expect(report.removed).toEqual([]);
    expect(await text(`v/${demo.version}/demo/house.json`)).toBe(
      `{"height":24,"icons":{"house":{"body":${JSON.stringify(HOUSE)}}},"prefix":"demo","width":24}`,
    );
    expect(await text(`v/${demo.version}/demo/home.json`)).toBe(
      `{"aliases":{"home":{"parent":"house"}},"height":24,"icons":{"house":{"body":${JSON.stringify(HOUSE)}}},"prefix":"demo","width":24}`,
    );
    expect(await text(`v/${demo.version}/demo/house.svg`)).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">${HOUSE}</svg>`,
    );
    // Скрытая иконка и её алиас тоже получают файлы: имена не пропадают (ADR-0005).
    expect(await text(`v/${demo.version}/demo/old.json`)).toContain(
      '"hidden":true',
    );
    expect(await text(`v/${demo.version}/demo/gone.svg`)).toContain("<g/>");
    const sums = checksumsSchema.parse(
      JSON.parse(await text(`v/${demo.version}/demo.checksums.json`)),
    );
    expect(Object.keys(sums.files)).toHaveLength(8);
    expect(sums.version).toBe(demo.version);
    const manifest = manifestSchema.parse(
      JSON.parse(await text("manifest.json")),
    );
    expect(manifest.sets).toEqual({
      demo: { version: demo.version, lastModified: DEMO_LAST_MODIFIED },
      other: { version: other.version, lastModified: DEMO_LAST_MODIFIED },
    });
    const r = report.sets[0];
    expect(r).toMatchObject({ icons: 2, hidden: 1, aliases: 2, files: 8 });
    expect(r?.examples.icon?.json.path).toBe(
      `v/${demo.version}/demo/house.json`,
    );
    expect(r?.examples.icon?.svg.text).toContain(HOUSE);
    expect(r?.examples.alias?.path).toBe(`v/${demo.version}/demo/home.json`);
    expect(r?.tree[0]).toBe(`v/${demo.version}/demo/gone.json`);
    expect(r?.checksums[0]?.[0]).toBe("demo/gone.json");
  });

  it("повторная сборка без изменений не пишет ни байта", async () => {
    await writeCdnDemoSet(dataDir, DEMO);
    await writeCdnDemoSet(dataDir, OTHER);
    await build();
    const before = await walk(outDir);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const report = await build();
    expect(report.sets.map((s) => s.status)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    expect(report.manifestWritten).toBe(false);
    expect(report.removed).toEqual([]);
    const after = await walk(outDir);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [path, mtime] of before) expect(after.get(path)).toBe(mtime);
    expect([...after.keys()].some((p) => p.includes(".tmp-"))).toBe(false);
  });

  it("новая версия набора заменяет старую, старая убирается", async () => {
    const first = await writeCdnDemoSet(dataDir, DEMO);
    await writeCdnDemoSet(dataDir, OTHER);
    await build();
    const second = await writeCdnDemoSet(dataDir, DEMO_PLUS);
    expect(second.version).not.toBe(first.version);
    const report = await build();
    expect(report.sets.map((s) => s.status)).toEqual(["written", "unchanged"]);
    expect(report.removed).toEqual([`v/${first.version}`]);
    await expect(stat(join(outDir, "v", first.version))).rejects.toThrow();
    expect(await text(`v/${second.version}/demo/star.svg`)).toContain("<g/>");
    const manifest = manifestSchema.parse(
      JSON.parse(await text("manifest.json")),
    );
    expect(manifest.sets.demo?.version).toBe(second.version);
  });

  it("убирает мусор в v/, но не трогает посторонние файлы в корне", async () => {
    const demo = await writeCdnDemoSet(dataDir, DEMO);
    await writeCdnDemoSet(dataDir, OTHER);
    await build();
    await mkdir(join(outDir, "v", ".tmp-x"), { recursive: true });
    await writeFile(join(outDir, "v", ".tmp-x", "f"), "x");
    await mkdir(join(outDir, "v", demo.version, ".tmp-y"), { recursive: true });
    await writeFile(join(outDir, "v", demo.version, ".tmp-y", "f"), "x");
    await mkdir(join(outDir, "v", "zzzz0000", "demo"), { recursive: true });
    await writeFile(join(outDir, "v", "zzzz0000", "demo", "x.json"), "{}");
    await writeFile(join(outDir, "notes.txt"), "мои заметки");
    const report = await build();
    expect(report.removed).toEqual([
      "v/.tmp-x",
      `v/${demo.version}/.tmp-y`,
      "v/zzzz0000",
    ]);
    expect(report.warnings).toEqual([]);
    expect(await text("notes.txt")).toBe("мои заметки");
    expect(report.sets.map((s) => s.status)).toEqual([
      "unchanged",
      "unchanged",
    ]);
  });

  it("повреждённая папка версии пересобирается", async () => {
    const demo = await writeCdnDemoSet(dataDir, DEMO);
    await writeCdnDemoSet(dataDir, OTHER);
    await build();
    await rm(join(outDir, "v", demo.version, "demo", "house.svg"));
    let report = await build();
    expect(report.sets.map((s) => s.status)).toEqual(["written", "unchanged"]);
    expect(await text(`v/${demo.version}/demo/house.svg`)).toContain(HOUSE);
    await writeFile(
      join(outDir, "v", demo.version, "demo.checksums.json"),
      "{}",
    );
    report = await build();
    expect(report.sets[0]?.status).toBe("written");
    expect(
      checksumsSchema.safeParse(
        JSON.parse(await text(`v/${demo.version}/demo.checksums.json`)),
      ).success,
    ).toBe(true);
  });

  it("СТОП одного набора: остальные собираются, манифест и старые папки не трогаются", async () => {
    await writeCdnDemoSet(dataDir, DEMO);
    await writeCdnDemoSet(dataDir, OTHER);
    await build();
    const manifestBefore = await text("manifest.json");
    const { mtimeMs } = await stat(join(outDir, "manifest.json"));
    await rm(join(dataDir, "other", "icons.json"));
    await writeCdnDemoSet(dataDir, DEMO_PLUS);
    const report = await build();
    expect(cdnStop(report)).toBe(true);
    expect(report.sets[0]?.status).toBe("written");
    expect(report.sets[1]).toMatchObject({
      status: "stopped",
      stop: ["icons.json не читается — запустите pnpm data other"],
    });
    expect(report.manifest).toBeUndefined();
    expect(report.manifestWritten).toBe(false);
    expect(report.removed).toEqual([]);
    expect(await text("manifest.json")).toBe(manifestBefore);
    expect((await stat(join(outDir, "manifest.json"))).mtimeMs).toBe(mtimeMs);
    // Старая версия demo осталась: уборки не было.
    expect((await readdir(join(outDir, "v"))).length).toBe(3);
  });
});
