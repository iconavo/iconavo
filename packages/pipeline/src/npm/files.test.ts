import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NPM_REPOSITORY_URL } from "./config.js";
import {
  buildPackage,
  fingerprintOf,
  groupDigits,
  INDEX_JS,
  indexDts,
  packageJsonOf,
  readmeText,
} from "./files.js";
import { loadDemoNpmSet, writeNpmDemoSet } from "./fixture.testing.js";

const ICONS = {
  house: { body: '<path d="M1 1h2"/>' },
  star: { body: "<g/>" },
  old: { body: "<g/>", hidden: true },
};

let root: string;
let dataDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-npm-"));
  dataDir = join(root, "data");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function demo(extra: { notice?: string } = {}) {
  await writeNpmDemoSet(dataDir, {
    id: "demo",
    icons: ICONS,
    aliases: { home: { parent: "house" } },
    samples: ["house"],
    metadata: { suffixes: { "": "Regular", "-bold": "Bold" } },
    ...extra,
  });
  return loadDemoNpmSet(dataDir, "demo");
}

const text = (data: Uint8Array) => Buffer.from(data).toString("utf8");

describe("buildPackage", () => {
  it("состав пакета: данные, лицензия, модуль, типы и README; в files — всё, что npm не кладёт сам", async () => {
    const pkg = buildPackage(await demo(), "next");
    expect(pkg.name).toBe("@iconavo-ui/icons-demo");
    expect(pkg.files.map((f) => f.path)).toEqual([
      "LICENSE",
      "README.md",
      "icons.json",
      "index.d.ts",
      "index.js",
      "info.json",
      "metadata.json",
    ]);
    expect(pkg.listed).toEqual([
      "icons.json",
      "index.d.ts",
      "index.js",
      "info.json",
      "metadata.json",
    ]);
  });

  it("NOTICE автора — в файлах пакета и в поле files", async () => {
    const pkg = buildPackage(await demo({ notice: "Demo notice\n" }), "next");
    expect(pkg.files.map((f) => f.path)).toContain("NOTICE");
    expect(pkg.listed).toContain("NOTICE");
  });

  it("одинаковый набор — одинаковые байты и отпечаток", async () => {
    const set = await demo();
    const a = buildPackage(set, "next");
    const b = buildPackage(set, "next");
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.files.map((f) => text(f.data))).toEqual(
      a.files.map((f) => text(f.data)),
    );
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("отпечаток меняется от тега: в день запуска выйдет новая версия под latest", async () => {
    const set = await demo();
    expect(buildPackage(set, "latest").fingerprint).not.toBe(
      buildPackage(set, "next").fingerprint,
    );
  });

  it("отпечаток меняется от любого байта любого файла", () => {
    const a = { path: "a.json", data: new Uint8Array([1, 2]) };
    const b = { path: "b.json", data: new Uint8Array([3]) };
    const base = fingerprintOf([a, b], "{}\n");
    expect(fingerprintOf([b, a], "{}\n")).toBe(base);
    expect(
      fingerprintOf([a, { path: "b.json", data: new Uint8Array([4]) }], "{}\n"),
    ).not.toBe(base);
    expect(fingerprintOf([a, { ...b, path: "c.json" }], "{}\n")).not.toBe(base);
    expect(fingerprintOf([a, b], '{"x":1}\n')).not.toBe(base);
  });
});

describe("packageJsonOf", () => {
  it("поля по порядку, types первым в exports, отметка iconavo, тег публикации", async () => {
    const set = await demo();
    const pkg = buildPackage(set, "next");
    const manifest = JSON.parse(
      text(packageJsonOf(set, "next", pkg, "1.2.3").data),
    );
    expect(Object.keys(manifest)).toEqual([
      "name",
      "version",
      "description",
      "keywords",
      "license",
      "repository",
      "bugs",
      "type",
      "sideEffects",
      "main",
      "types",
      "exports",
      "files",
      "publishConfig",
      "iconavo",
    ]);
    expect(manifest).toMatchObject({
      name: "@iconavo-ui/icons-demo",
      version: "1.2.3",
      license: "MIT",
      repository: {
        type: "git",
        url: NPM_REPOSITORY_URL,
        directory: "data/demo",
      },
      type: "module",
      sideEffects: false,
      publishConfig: { access: "public", provenance: true, tag: "next" },
      iconavo: {
        set: "demo",
        setVersion: set.version,
        fingerprint: pkg.fingerprint,
      },
    });
    expect(Object.keys(manifest.exports["."])).toEqual(["types", "default"]);
    expect(Object.keys(manifest.exports)).toEqual([
      ".",
      "./icons.json",
      "./info.json",
      "./metadata.json",
      "./package.json",
    ]);
    expect(manifest.files).toEqual(pkg.listed);
    expect(manifest).not.toHaveProperty("scripts");
    expect(manifest).not.toHaveProperty("dependencies");
  });

  it("номер версии не меняет отпечаток", async () => {
    const set = await demo();
    const pkg = buildPackage(set, "next");
    const a = JSON.parse(text(packageJsonOf(set, "next", pkg, "1.0.0").data));
    const b = JSON.parse(text(packageJsonOf(set, "next", pkg, "1.0.1").data));
    expect(a.iconavo.fingerprint).toBe(b.iconavo.fingerprint);
  });
});

describe("readmeText", () => {
  it("установка с тегом, пример с иконкой витрины, автор и лицензия; номера пакета нет", async () => {
    const set = await demo();
    const readme = readmeText(set, "next");
    expect(readme).toContain("npm install @iconavo-ui/icons-demo@next");
    expect(readme).toContain('icons.icons["house"]');
    expect(readme).toContain("2 icons and 1 alias,");
    expect(readme).toContain("Hidden icons in this version: 1.");
    expect(readme).toContain("variants: Regular, Bold");
    expect(readme).toContain("licensed under MIT.");
    expect(readme).toContain(`Set version \`${set.version}\``);
    expect(readme).toContain("Until the public launch");
  });

  it("в день запуска — без тега и без пометки о предварительных версиях", async () => {
    const readme = readmeText(await demo(), "latest");
    expect(readme).toContain("npm install @iconavo-ui/icons-demo\n");
    expect(readme).not.toContain("Until the public launch");
  });
});

describe("index.js и index.d.ts", () => {
  it("модуль отдаёт три JSON, типы знают точный префикс", () => {
    expect(INDEX_JS).toContain(
      'import icons from "./icons.json" with { type: "json" };',
    );
    expect(INDEX_JS).toContain("export { icons, info, metadata };");
    expect(indexDts("demo")).toContain('prefix: "demo";');
    expect(indexDts("demo")).toContain(
      "export declare const icons: IconavoIconSet;",
    );
  });

  it("числа в README — с разделителем тысяч", () => {
    expect(groupDigits(7)).toBe("7");
    expect(groupDigits(1903)).toBe("1,903");
    expect(groupDigits(15769)).toBe("15,769");
    expect(groupDigits(1234567)).toBe("1,234,567");
  });
});
