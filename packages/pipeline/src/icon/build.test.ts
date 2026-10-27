import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIconScript, bundleIconScript } from "./build.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PIPELINE = fileURLToPath(new URL("../../", import.meta.url));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-icon-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Сборка проекта разработчика из одной строки import "@iconavo-ui/icon" — с условиями экспорта. */
async function consumer(conditions?: string[]) {
  const { build } = await import("rolldown");
  const result = await build({
    input: "consumer",
    cwd: PIPELINE,
    platform: "browser",
    ...(conditions ? { resolve: { conditionNames: conditions } } : {}),
    plugins: [
      {
        name: "consumer",
        resolveId: (id) => (id === "consumer" ? id : null),
        load: (id) => (id === "consumer" ? 'import "@iconavo-ui/icon";' : null),
      },
    ],
    write: false,
    output: { format: "esm", minify: true },
  });
  const [chunk] = result.output;
  return { code: chunk.code, modules: chunk.moduleIds.map(String) };
}

describe("скрипт тега для страниц без сборщика", () => {
  it("один сжатый ES-модуль без импортов: ядро и регистрация тега внутри, четыре функции наружу", async () => {
    const code = await bundleIconScript(ROOT);
    expect(code).not.toMatch(/^\s*import[\s{*"']|\bimport\(|\brequire\(/m);
    expect(code).toContain("customElements");
    expect(code).toContain("iconavo-icon");
    expect(code).toContain("https://api.iconavo.dev");
    expect(code).not.toContain("process.env");
    // Вычислить в Node, как на сервере: тег не регистрируется, функции на месте.
    const file = join(dir, "iconavo-icon.js");
    await buildIconScript(ROOT, file);
    const module = await import(pathToFileURL(file).href);
    expect(Object.keys(module).sort()).toEqual([
      "addIcons",
      "configure",
      "loadIcons",
      "setLoader",
    ]);
  });

  it("повторная сборка — те же байты, без записи", async () => {
    const file = join(dir, "iconavo-icon.js");
    const first = await buildIconScript(ROOT, file);
    expect(first.written).toBe(true);
    expect(first.gzipBytes).toBeLessThan(first.bytes);
    const bytes = await readFile(file);
    const second = await buildIconScript(ROOT, file);
    expect(second.written).toBe(false);
    expect(await readFile(file)).toEqual(bytes);
  });
});

describe("пакет в сборке разработчика", () => {
  it("import «@iconavo-ui/icon» регистрирует тег: сборщик не выбрасывает вход с побочным эффектом", async () => {
    const { code, modules } = await consumer();
    expect(code).toContain("customElements");
    expect(modules.some((id) => id.endsWith("index.js"))).toBe(true);
    expect(modules.some((id) => id.endsWith("development.js"))).toBe(false);
  });

  it("условие development — вход для разработки с рамкой по умолчанию", async () => {
    const { code, modules } = await consumer([
      "development",
      "browser",
      "import",
      "default",
    ]);
    expect(code).toContain("customElements");
    expect(modules.some((id) => id.endsWith("development.js"))).toBe(true);
  });
});
