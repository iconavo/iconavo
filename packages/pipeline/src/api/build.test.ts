import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi, bundleWorker, stampBuild, workerMetadata } from "./build.js";
import { BUILD_PLACEHOLDER } from "./config.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("stampBuild", () => {
  it("метка — 8 знаков SHA-256 бандла с заглушкой, ровно одно вхождение", () => {
    const code = `const BUILD = "${BUILD_PLACEHOLDER}";`;
    const a = stampBuild(code);
    expect(a.build).toMatch(/^[0-9a-f]{8}$/);
    expect(a.code).toBe(`const BUILD = "${a.build}";`);
    expect(stampBuild(code).build).toBe(a.build);
    expect(stampBuild(`${code}\n`).build).not.toBe(a.build);
  });

  it("заглушки нет или их две — ошибка", () => {
    expect(() => stampBuild("const BUILD = 1;")).toThrow(/0 раз/);
    expect(() =>
      stampBuild(`"${BUILD_PLACEHOLDER}" + "${BUILD_PLACEHOLDER}"`),
    ).toThrow(/2 раз/);
  });
});

describe("bundleWorker", () => {
  it("один ES-модуль без импортов, ядро внутри, export default", async () => {
    const code = await bundleWorker(ROOT);
    expect(code).not.toMatch(/^\s*import[\s{*"']/m);
    expect(code).toMatch(/export \{ \w+ as default \};/);
    expect(code.split(BUILD_PLACEHOLDER)).toHaveLength(2);
    expect(code).toContain("function iconToSvg(");
  });
});

describe("buildApi", () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "iconavo-api-build-"));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("функция, metadata и build.json; повтор — без записи и с той же меткой", async () => {
    const first = await buildApi({ root: ROOT, outDir });
    expect(first.written).toEqual(["worker.js", "metadata.json", "build.json"]);
    expect(first.gzipBytes).toBeLessThan(first.bytes);
    const second = await buildApi({ root: ROOT, outDir });
    expect(second.written).toEqual([]);
    expect(second.build).toBe(first.build);
    const worker = await readFile(join(outDir, "worker.js"), "utf8");
    expect(worker).toContain(`const BUILD = "${first.build}";`);
    expect(
      JSON.parse(await readFile(join(outDir, "metadata.json"), "utf8")),
    ).toEqual(workerMetadata());
    expect(
      JSON.parse(await readFile(join(outDir, "build.json"), "utf8")),
    ).toMatchObject({ build: first.build, bytes: first.bytes });
  });

  it("metadata: модуль, дата совместимости, бакет раздачи, журнал без запросов", () => {
    expect(workerMetadata()).toEqual({
      main_module: "worker.js",
      compatibility_date: "2026-10-01",
      bindings: [
        { type: "r2_bucket", name: "CDN", bucket_name: "iconavo-cdn" },
      ],
      observability: {
        enabled: true,
        logs: { enabled: true, invocation_logs: false },
      },
    });
  });
});
