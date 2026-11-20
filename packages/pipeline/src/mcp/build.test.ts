import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleWorker, stampBuild } from "../api/build.js";
import { BUILD_PLACEHOLDER } from "../api/config.js";
import {
  buildMcp,
  mcpMetadata,
  mcpTarget,
  readResvgWasm,
  readUsage,
} from "./build.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Заглушка страницы сетки: проверки чистоты бандла смотрят код функции регулярками, а в настоящей
 * странице — код вида для браузера (свой zod, PostMessageTransport).
 */
const PICKER = {
  html: '<!doctype html><title>stub</title><main id="picker"></main>',
  version: "00000000",
};

describe("bundleWorker: MCP-сервер", () => {
  it("один ES-модуль: единственный импорт — модуль wasm рисовальщика, export default, одна метка", async () => {
    const code = await bundleWorker(
      ROOT,
      mcpTarget(await readUsage(ROOT), PICKER),
    );
    expect(code.split("\n")[0]).toBe('import resvgWasm from "./resvg.wasm";');
    expect(code.match(/^\s*import[\s{*"']/gm)).toHaveLength(1);
    expect(code).not.toMatch(/\bimport\(|\brequire\(/);
    expect(code).toMatch(/export \{ \w+ as default \};/);
    expect(code.split(BUILD_PLACEHOLDER)).toHaveLength(2);
  });

  it("сборки SDK под Workers: проверка схем без eval (cf-worker), без ajv и модулей Node; одна копия zod", async () => {
    const code = await bundleWorker(
      ROOT,
      mcpTarget(await readUsage(ROOT), PICKER),
    );
    expect(code).toContain("CfWorkerJsonSchemaValidator");
    // ajv строит проверки через new Function — в Workers это запрещено.
    expect(code).not.toMatch(/new Ajv\(|class Ajv\w*\b/);
    expect(code).not.toMatch(/from "node:/);
    expect(code.match(/function \$constructor\(/g)).toHaveLength(1);
  });
});

describe("README тега в бандле", () => {
  it("строки установки и разделы для get_usage вшиты модулем без файла", async () => {
    const usage = await readUsage(ROOT);
    const code = await bundleWorker(ROOT, mcpTarget(usage, PICKER));
    // Строки — как в README (у </script> rolldown экранирует косую черту: так строку можно вставить в HTML).
    expect(code).toContain(JSON.stringify(usage.install.tag.import));
    expect(code).toContain(JSON.stringify(usage.version));
    expect(code).not.toMatch(/from "virtual:/);
  });
});

describe("сетка выбора в бандле (pick_icon, ADR-0045)", () => {
  it("страница вшита модулем без файла; в функции только серверная часть SDK MCP Apps, кода вида нет", async () => {
    const code = await bundleWorker(
      ROOT,
      mcpTarget(await readUsage(ROOT), PICKER),
    );
    expect(code).toContain(JSON.stringify(PICKER.html));
    expect(code).toContain('"text/html;profile=mcp-app"');
    expect(code).toContain('"ui/resourceUri"');
    expect(code).not.toMatch(
      /PostMessageTransport|ResizeObserver|postMessage\(/,
    );
  });
});

describe("stampBuild с солью", () => {
  it("соль меняет метку, без соли — прежняя метка API", () => {
    const code = `const BUILD = "${BUILD_PLACEHOLDER}";`;
    expect(stampBuild(code, "").build).toBe(stampBuild(code).build);
    expect(stampBuild(code, "wasm").build).not.toBe(stampBuild(code).build);
  });
});

describe("buildMcp", () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "iconavo-mcp-build-"));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("функция, модуль wasm, metadata и build.json; повтор — без записи и с той же меткой", async () => {
    const first = await buildMcp({ root: ROOT, outDir });
    expect(first.written).toEqual([
      "worker.js",
      "metadata.json",
      "build.json",
      "resvg.wasm",
    ]);
    const wasm = await readFile(join(outDir, "resvg.wasm"));
    expect(wasm.equals(await readResvgWasm(ROOT))).toBe(true);
    expect(first.wasmBytes).toBe(wasm.length);
    const second = await buildMcp({ root: ROOT, outDir });
    expect(second.written).toEqual([]);
    expect(second.build).toBe(first.build);
    const worker = await readFile(join(outDir, "worker.js"), "utf8");
    expect(worker).toContain(`const BUILD = "${first.build}";`);
    expect(
      JSON.parse(await readFile(join(outDir, "metadata.json"), "utf8")),
    ).toEqual(mcpMetadata());
    expect(
      JSON.parse(await readFile(join(outDir, "build.json"), "utf8")),
    ).toMatchObject({
      build: first.build,
      wasmBytes: wasm.length,
      picker: first.picker,
    });
    expect(first.picker.version).toMatch(/^[0-9a-f]{8}$/);
    expect(worker).toContain(first.picker.version);
  });

  it("metadata: бакеты раздачи и поиска, свои лимиты частоты 1003 и 1004, предел процессора, журнал без запросов", () => {
    expect(mcpMetadata()).toEqual({
      main_module: "worker.js",
      compatibility_date: "2026-10-01",
      bindings: [
        { type: "r2_bucket", name: "CDN", bucket_name: "iconavo-cdn" },
        { type: "r2_bucket", name: "SEARCH", bucket_name: "iconavo-search" },
        {
          type: "ratelimit",
          name: "MCP_SEARCH_LIMIT",
          namespace_id: "1003",
          simple: { limit: 60, period: 60 },
        },
        {
          type: "ratelimit",
          name: "MCP_ICON_LIMIT",
          namespace_id: "1004",
          simple: { limit: 300, period: 60 },
        },
      ],
      limits: { cpu_ms: 300 },
      observability: {
        enabled: true,
        logs: { enabled: true, invocation_logs: false },
      },
    });
  });
});
