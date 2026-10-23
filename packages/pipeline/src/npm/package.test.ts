// Собранный пакет глазами пользователя: настоящий Node импортирует его модуль и файлы, а TypeScript
// проекта проверяет его типы — в режимах nodenext и bundler. Пакет кладётся копией в node_modules
// временного проекта, как после npm install.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadDemoNpmSet,
  packageFiles,
  writeNpmDemoSet,
} from "./fixture.testing.js";

const require = createRequire(import.meta.url);
const tsc = join(
  dirname(require.resolve("typescript/package.json")),
  "bin",
  "tsc",
);

let root: string;
let consumer: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-npm-"));
  const dataDir = join(root, "data");
  await writeNpmDemoSet(dataDir, {
    id: "demo",
    icons: { house: { body: '<path d="M1 1h2"/>' } },
    aliases: { home: { parent: "house" } },
    samples: ["house"],
    metadata: { suffixes: { "": "Regular" } },
  });
  // search.json рядом с пакетом есть, но наружу он не открыт.
  await writeFile(join(dataDir, "demo", "search.json"), "{}\n");
  const set = await loadDemoNpmSet(dataDir, "demo");
  consumer = join(root, "consumer");
  const dir = join(consumer, "node_modules", "@iconavo-ui", "icons-demo");
  await mkdir(dir, { recursive: true });
  for (const [path, data] of packageFiles(set, "1.0.0")) {
    await writeFile(join(dir, path), data);
  }
  await writeFile(join(dir, "search.json"), "{}\n");
  await writeFile(join(consumer, "package.json"), '{ "type": "module" }\n');
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = (args: string[]) =>
  spawnSync(process.execPath, args, { cwd: consumer, encoding: "utf8" });

describe("собранный пакет", () => {
  it("Node: модуль отдаёт три файла, JSON открывается по пути, search.json — закрыт", () => {
    const code = `
import { icons, info, metadata } from "@iconavo-ui/icons-demo";
import direct from "@iconavo-ui/icons-demo/icons.json" with { type: "json" };
import { createRequire } from "node:module";
const required = createRequire(import.meta.url)("@iconavo-ui/icons-demo/icons.json");
let closed = "";
try {
  await import("@iconavo-ui/icons-demo/search.json", { with: { type: "json" } });
} catch (e) {
  closed = e.code;
}
console.log(JSON.stringify({
  prefix: icons.prefix,
  same: direct === icons,
  required: required.prefix,
  name: info.name,
  suffixes: metadata.suffixes,
  closed,
}));`;
    const r = run(["--input-type=module", "-e", code]);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({
      prefix: "demo",
      same: true,
      required: "demo",
      name: "Demo demo",
      suffixes: { "": "Regular" },
      closed: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
  });

  it("TypeScript: типы проходят строгую проверку, префикс — точный", async () => {
    const check = `import { icons, info, metadata, type IconavoIcon } from "@iconavo-ui/icons-demo";

const prefix: "demo" = icons.prefix;
const icon: IconavoIcon | undefined = icons.icons["house"];
const parent: string | undefined = icons.aliases?.["home"]?.parent;
const spdx: string = info.license.spdx;
const variants: Record<string, string> | undefined = metadata.suffixes;
// @ts-expect-error — префикс другого набора
const wrong: "lucide" = icons.prefix;

export { prefix, icon, parent, spdx, variants, wrong };
`;
    const json = `import icons from "@iconavo-ui/icons-demo/icons.json" with { type: "json" };

export const prefix: string = icons.prefix;
`;
    await writeFile(join(consumer, "check.ts"), check);
    await writeFile(join(consumer, "json.ts"), json);
    const base = {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      target: "es2022",
      types: [],
    };
    await writeFile(
      join(consumer, "tsconfig.nodenext.json"),
      JSON.stringify({
        compilerOptions: {
          ...base,
          module: "nodenext",
          moduleResolution: "nodenext",
        },
        files: ["check.ts"],
      }),
    );
    await writeFile(
      join(consumer, "tsconfig.bundler.json"),
      JSON.stringify({
        compilerOptions: {
          ...base,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
        },
        files: ["check.ts", "json.ts"],
      }),
    );
    for (const config of ["tsconfig.nodenext.json", "tsconfig.bundler.json"]) {
      const r = run([tsc, "-p", config]);
      expect(`${r.stdout}${r.stderr}`).toBe("");
      expect(r.status).toBe(0);
    }
  });
});
