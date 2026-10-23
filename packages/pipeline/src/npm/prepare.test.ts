import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoConfig } from "../search/fixture.testing.js";
import {
  type FakePackage,
  fakeRegistry,
  loadDemoNpmSet,
  type NpmDemoSet,
  packageFiles,
  writeNpmDemoSet,
} from "./fixture.testing.js";
import { type NpmPlan, preparePackages, prepareStop } from "./prepare.js";

const NAME = "@iconavo-ui/icons-demo";
const DEMO: NpmDemoSet = {
  id: "demo",
  icons: { house: { body: '<path d="M1 1h2"/>' }, star: { body: "<g/>" } },
  aliases: { home: { parent: "house" } },
  samples: ["house"],
};
const configs = [demoConfig("demo")];

let root: string;
let dataDir: string;
let outDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-npm-"));
  dataDir = join(root, "data");
  outDir = join(root, "dist-npm");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const plan = async (): Promise<NpmPlan> =>
  JSON.parse(await readFile(join(outDir, "plan.json"), "utf8"));

/** Опубликованная версия — та, что выпустила бы сборка этого набора. */
async function published(
  set: NpmDemoSet,
  version: string,
): Promise<FakePackage> {
  const { version: setVersion } = await writeNpmDemoSet(dataDir, set);
  const loaded = await loadDemoNpmSet(dataDir, set.id);
  expect(loaded.version).toBe(setVersion);
  return {
    versions: [{ version, files: packageFiles(loaded, version) }],
    tags: { latest: version, next: version },
  };
}

/** Все файлы папки: путь → время изменения. */
async function walk(dir: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const e of await readdir(dir, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!e.isFile()) continue;
    const path = join(e.parentPath, e.name);
    out.set(path, (await stat(path)).mtimeMs);
  }
  return out;
}

const run = (
  registry: ReturnType<typeof fakeRegistry>,
  extra: { allowNew?: boolean; force?: boolean; keep?: string[] } = {},
) =>
  preparePackages(configs, {
    dataDir,
    outDir,
    registry: registry.client,
    ...extra,
  });

describe("preparePackages", () => {
  it("пакета нет: без «первой публикации» — ждёт, папка собрана, в плане не публикуется", async () => {
    await writeNpmDemoSet(dataDir, DEMO);
    const report = await run(fakeRegistry({}));
    expect(prepareStop(report)).toBe(false);
    expect(report.packages[0]).toMatchObject({
      name: NAME,
      action: "awaiting",
      version: "1.0.0",
      written: true,
    });
    expect((await plan()).packages).toEqual([
      expect.objectContaining({
        id: "demo",
        name: NAME,
        action: "awaiting",
        publish: false,
      }),
    ]);
    const manifest = JSON.parse(
      await readFile(join(outDir, "demo", "package.json"), "utf8"),
    );
    expect(manifest.version).toBe("1.0.0");
  });

  it("с «первой публикацией» — 1.0.0 к публикации, список файлов как у npm pack", async () => {
    await writeNpmDemoSet(dataDir, DEMO);
    const report = await run(fakeRegistry({}), { allowNew: true });
    expect(report.packages[0]).toMatchObject({
      action: "new",
      version: "1.0.0",
    });
    const [entry] = (await plan()).packages;
    expect(entry).toMatchObject({
      publish: true,
      base: null,
      version: "1.0.0",
    });
    expect(entry?.files).toEqual([
      "LICENSE",
      "README.md",
      "icons.json",
      "index.d.ts",
      "index.js",
      "info.json",
      "metadata.json",
      "package.json",
    ]);
    expect((await readdir(join(outDir, "demo"))).sort()).toEqual(entry?.files);
  });

  it("повторный запуск не пишет ни байта", async () => {
    await writeNpmDemoSet(dataDir, DEMO);
    await run(fakeRegistry({}));
    const before = await walk(outDir);
    const again = await run(fakeRegistry({}));
    expect(again.packages[0]?.written).toBe(false);
    expect(again.planWritten).toBe(false);
    expect(await walk(outDir)).toEqual(before);
  });

  it("в npm тот же отпечаток — без изменений, архив не качается", async () => {
    const pkg = await published(DEMO, "1.0.0");
    const registry = fakeRegistry({ [NAME]: pkg });
    const report = await run(registry);
    expect(report.packages[0]).toMatchObject({
      action: "unchanged",
      version: "1.0.0",
      base: "1.0.0",
    });
    expect((await plan()).packages[0]?.publish).toBe(false);
    expect(registry.calls).toEqual([`packument ${NAME}`]);
  });

  it("--force — новая патч-версия без изменений", async () => {
    const registry = fakeRegistry({ [NAME]: await published(DEMO, "1.0.0") });
    const report = await run(registry, { force: true });
    expect(report.packages[0]).toMatchObject({
      action: "patch",
      version: "1.0.1",
    });
    expect((await plan()).packages[0]).toMatchObject({
      publish: true,
      base: "1.0.0",
    });
  });

  it("изменился рисунок — последняя цифра; новая иконка — средняя", async () => {
    const pkg = await published(DEMO, "1.0.0");
    const { version: old } = await writeNpmDemoSet(dataDir, DEMO);
    await writeNpmDemoSet(dataDir, {
      ...DEMO,
      icons: { ...DEMO.icons, star: { body: "<g><path/></g>" } },
      previous: [old],
    });
    const patch = await run(fakeRegistry({ [NAME]: pkg }));
    expect(patch.packages[0]).toMatchObject({
      action: "patch",
      version: "1.0.1",
      added: [],
    });

    await writeNpmDemoSet(dataDir, {
      ...DEMO,
      icons: { ...DEMO.icons, moon: { body: "<g/>" } },
      previous: [old],
    });
    const minor = await run(fakeRegistry({ [NAME]: pkg }));
    expect(minor.packages[0]).toMatchObject({
      action: "minor",
      version: "1.1.0",
      added: ["moon"],
    });
    const manifest = JSON.parse(
      await readFile(join(outDir, "demo", "package.json"), "utf8"),
    );
    expect(manifest.version).toBe("1.1.0");
  });

  it("пропало имя — «СТОП», плана нет, и прошлый план убран", async () => {
    await writeNpmDemoSet(dataDir, DEMO);
    await run(fakeRegistry({}));
    const pkg = await published(DEMO, "1.0.0");
    const { version: old } = await writeNpmDemoSet(dataDir, DEMO);
    await writeNpmDemoSet(dataDir, {
      ...DEMO,
      aliases: undefined,
      previous: [old],
    });
    const report = await run(fakeRegistry({ [NAME]: pkg }));
    expect(prepareStop(report)).toBe(true);
    expect(report.packages[0]?.stop).toEqual([
      expect.stringContaining("пропали имена (1): home"),
    ]);
    await expect(stat(join(outDir, "plan.json"))).rejects.toThrow();
  });

  it("в npm данные новее этой сборки — «СТОП»", async () => {
    const pkg = await published(
      { ...DEMO, icons: { ...DEMO.icons, moon: { body: "<g/>" } } },
      "1.1.0",
    );
    await writeNpmDemoSet(dataDir, DEMO);
    const report = await run(fakeRegistry({ [NAME]: pkg }));
    expect(report.packages[0]?.stop).toEqual([
      expect.stringContaining("в npm данные новее"),
    ]);
  });

  it("набор не читается — «СТОП» с подсказкой, остальные отчёты есть", async () => {
    const report = await run(fakeRegistry({}));
    expect(report.packages[0]?.stop).toEqual([
      "icons.json не читается — запустите pnpm data demo",
    ]);
  });

  it("уборка: забытые временные папки и чужие наборы — прочь, наборы реестра остаются", async () => {
    await writeNpmDemoSet(dataDir, DEMO);
    await mkdir(join(outDir, ".tmp-demo-123"), { recursive: true });
    await mkdir(join(outDir, "gone"), { recursive: true });
    await mkdir(join(outDir, "other"), { recursive: true });
    const report = await run(fakeRegistry({}), { keep: ["demo", "other"] });
    expect(report.removed).toEqual([".tmp-demo-123", "gone"]);
    expect((await readdir(outDir)).sort()).toEqual([
      "demo",
      "other",
      "plan.json",
    ]);
  });
});
