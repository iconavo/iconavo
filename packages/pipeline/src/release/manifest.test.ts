import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGES } from "./config.js";
import { manifestOf } from "./fixture.testing.js";
import { distProblems, manifestPaths, manifestProblems } from "./manifest.js";

const root = join(import.meta.dirname, "..", "..", "..", "..");

describe("package.json пакетов", () => {
  it("поля пакетов репозитория — как задумано (версию ставит выпуск)", () => {
    for (const id of PACKAGES) {
      const m = JSON.parse(
        readFileSync(join(root, "packages", id, "package.json"), "utf8"),
      ) as Record<string, unknown>;
      const version = String(m.version);
      const problems = manifestProblems(id, m, { version, packed: false });
      // До первого выпуска пакеты — 0.0.0 с private; остальное должно быть на месте уже сейчас.
      expect(
        problems.filter((p) => !(version === "0.0.0" && p.includes("private"))),
        id,
      ).toEqual([]);
    }
  });

  it("в архиве ядро — точной версией выпуска, в репозитории — workspace:*", () => {
    expect(
      manifestProblems("react", manifestOf("react", "0.1.0", true), {
        version: "0.1.0",
        packed: true,
      }),
    ).toEqual([]);
    expect(
      manifestProblems("react", manifestOf("react", "0.1.0", false), {
        version: "0.1.0",
        packed: true,
      }),
    ).toEqual([
      '@iconavo-ui/react в архиве: dependencies — {"@iconavo-ui/core":"workspace:*"}, нужно {"@iconavo-ui/core":"0.1.0"}',
    ]);
  });

  it("не те поля, private, скрипты установки и лишние поля — проблемы", () => {
    const m = {
      ...manifestOf("core", "0.1.0", false),
      private: true,
      license: "ISC",
      repository: "github:iconavo/iconavo",
      keywords: ["Icons"],
      scripts: { build: "tsc -b", postinstall: "node x.js" },
      bin: "cli.js",
    };
    const problems = manifestProblems("core", m, {
      version: "0.2.0",
      packed: false,
    });
    expect(problems).toEqual([
      "packages/core/package.json: версия 0.1.0, а выпуск — 0.2.0",
      "packages/core/package.json: private: true — npm его не опубликует",
      'packages/core/package.json: поле license — "ISC", нужно "MIT"',
      'packages/core/package.json: поле repository — "github:iconavo/iconavo", нужно {"type":"git","url":"git+https://github.com/iconavo/iconavo.git","directory":"packages/core"}',
      "packages/core/package.json: keywords — список слов строчными латинскими буквами",
      "packages/core/package.json: скрипты, которые npm запустит сам: postinstall",
      "packages/core/package.json: поле bin — его у наших пакетов нет",
    ]);
  });

  it("пути package.json — из exports, types и sideEffects, без «./»", () => {
    expect(
      manifestPaths({
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            development: "./dist/dev.js",
            default: "./dist/index.js",
          },
          "./package.json": "./package.json",
        },
        types: "./dist/index.d.ts",
        sideEffects: ["./dist/index.js", "./dist/script.js"],
      }),
    ).toEqual([
      "dist/dev.js",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/script.js",
      "package.json",
    ]);
    expect(manifestPaths({ sideEffects: false })).toEqual([]);
  });

  it("файл dist без исходника — забытая старая сборка; скрипт тега — не в счёт", () => {
    const files = [
      "dist/icon.js",
      "dist/icon.d.ts",
      "dist/old.js",
      "dist/iconavo-icon.js",
      "package.json",
    ];
    expect(distProblems("@iconavo-ui/icon", files, ["src/icon.ts"])).toEqual([
      "@iconavo-ui/icon: в dist файлы без исходника — dist/old.js: удалите dist и tsconfig.tsbuildinfo пакета и соберите заново",
    ]);
    expect(distProblems("x", ["dist/icon.js"], ["src/icon.ts"])).toEqual([]);
  });
});
