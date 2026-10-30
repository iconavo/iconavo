import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageName, RELEASE_OUT_DIR } from "./config.js";
import {
  fakeBuild,
  fakePack,
  fakeRegistry,
  packFiles,
  publishedAll,
  writeReleaseRepo,
} from "./fixture.testing.js";
import {
  type PrepareOptions,
  prepareRelease,
  readReleasePlan,
  releaseStop,
} from "./prepare.js";
import { sri } from "./text.js";

async function prepare(
  root: string,
  registry: PrepareOptions["registry"],
  extra: Partial<PrepareOptions> = {},
) {
  const outDir = join(root, RELEASE_OUT_DIR);
  const report = await prepareRelease({
    root,
    outDir,
    registry,
    buildScript: fakeBuild,
    pack: fakePack(),
    ...extra,
  });
  return { report, outDir, plan: join(outDir, "plan.json") };
}

const problems = (r: Awaited<ReturnType<typeof prepareRelease>>) => [
  ...r.checks.flatMap((c) => c.problems),
  ...r.packages.flatMap((p) => p.problems.map((x) => `${p.id}: ${x}`)),
];

describe("pnpm release prepare", () => {
  it("0.0.0 с private — выпуска ещё нет, план не пишется", async () => {
    const root = await writeReleaseRepo({ version: "0.0.0", integrity: null });
    const { report, plan } = await prepare(root, fakeRegistry({}));
    expect(report.unreleased).toBe(true);
    expect(releaseStop(report)).toBe(false);
    expect(existsSync(plan)).toBe(false);
  });

  it("пакетов нет в npm: без --first — ждут первой публикации, ни один не публикуется", async () => {
    const root = await writeReleaseRepo({ version: "0.1.0" });
    const { report, plan } = await prepare(root, fakeRegistry({}));
    expect(problems(report)).toEqual([]);
    expect(report.packages.map((p) => [p.id, p.action, p.publish])).toEqual([
      ["core", "awaiting", false],
      ["icon", "awaiting", false],
      ["react", "awaiting", false],
    ]);
    expect(report.planned).toBe(false);
    expect(
      (await readReleasePlan(plan)).packages.every((p) => !p.publish),
    ).toBe(true);
  });

  it("с --first — первая публикация трёх пакетов, ядро первым; план с архивами", async () => {
    const root = await writeReleaseRepo({ version: "0.1.0" });
    const { report, plan, outDir } = await prepare(root, fakeRegistry({}), {
      first: true,
      commit: "a".repeat(40),
    });
    expect(problems(report)).toEqual([]);
    expect(report.planned).toBe(true);
    const p = await readReleasePlan(plan);
    expect(p).toMatchObject({
      version: "0.1.0",
      tag: "next",
      first: true,
      commit: "a".repeat(40),
      script: {
        path: "dist/iconavo-icon.js",
        integrity: report.script?.integrity,
      },
    });
    expect(
      p.packages.map((x) => [x.name, x.action, x.publish, x.base, x.file]),
    ).toEqual([
      ["@iconavo-ui/core", "new", true, null, "iconavo-ui-core-0.1.0.tgz"],
      ["@iconavo-ui/icon", "new", true, null, "iconavo-ui-icon-0.1.0.tgz"],
      ["@iconavo-ui/react", "new", true, null, "iconavo-ui-react-0.1.0.tgz"],
    ]);
    for (const x of p.packages) {
      expect(existsSync(join(outDir, x.file))).toBe(true);
      expect(x.integrity).toMatch(/^sha512-/);
    }
  });

  it("новая версия существующих пакетов — публикуется, база — версия под next", async () => {
    const root = await writeReleaseRepo({ version: "0.1.1" });
    const registry = fakeRegistry(
      publishedAll([{ version: "0.1.0", token: true }]),
    );
    const { report } = await prepare(root, registry);
    expect(problems(report)).toEqual([]);
    expect(report.packages.map((p) => [p.action, p.publish, p.base])).toEqual([
      ["release", true, "0.1.0"],
      ["release", true, "0.1.0"],
      ["release", true, "0.1.0"],
    ]);
  });

  it("версия уже вышла: публиковать нечего, хэш README сверяется со скриптом в npm", async () => {
    const root = await writeReleaseRepo({ version: "0.1.0" });
    const registry = fakeRegistry(publishedAll([{ version: "0.1.0" }]));
    const { report } = await prepare(root, registry);
    expect(problems(report)).toEqual([]);
    expect(report.planned).toBe(false);
    expect(report.script?.published).toBe(
      sri(packFiles("icon", "0.1.0")["dist/iconavo-icon.js"] as Buffer),
    );
    // Код после выпуска поменялся — свежая сборка другая, но хэш README — от вышедшего скрипта.
    const changed = await prepare(root, registry, {
      buildScript: async () => ({ body: Buffer.from("changed"), gzipBytes: 1 }),
      pack: fakePack((id, _version, files) => ({
        ...files,
        ...(id === "icon"
          ? { "dist/iconavo-icon.js": Buffer.from("changed") }
          : {}),
      })),
    });
    expect(problems(changed.report)).toEqual([]);
  });

  it("хэш README — не от вышедшего скрипта — СТОП", async () => {
    const root = await writeReleaseRepo({
      version: "0.1.0",
      integrity: sri("other"),
    });
    const { report, plan } = await prepare(
      root,
      fakeRegistry(publishedAll([{ version: "0.1.0" }])),
    );
    expect(problems(report)).toEqual([
      `хэш в README (${sri("other")}) — не хэш скрипта 0.1.0 в npm (${report.script?.published})`,
    ]);
    expect(existsSync(plan)).toBe(false);
  });

  it("версия не вышла, а хэш README — не от свежей сборки — СТОП с подсказкой", async () => {
    const root = await writeReleaseRepo({
      version: "0.1.0",
      integrity: sri("old build"),
    });
    const { report } = await prepare(root, fakeRegistry({}), { first: true });
    expect(problems(report)).toEqual([
      `хэш в README (${sri("old build")}) не совпадает со свежей сборкой (${report.script?.integrity}) — pnpm release bump без версии обновит его`,
    ]);
  });

  it("вышла часть пакетов: та же сборка — выпускаются остальные, другая — СТОП", async () => {
    const root = await writeReleaseRepo({ version: "0.1.1" });
    const base = publishedAll([{ version: "0.1.0" }]);
    const partial = {
      ...base,
      [packageName("core")]: {
        versions: [{ version: "0.1.0" }, { version: "0.1.1" }],
        tags: { latest: "0.1.0", next: "0.1.1" },
      },
    };
    const same = await prepare(root, fakeRegistry(partial));
    expect(problems(same.report)).toEqual([]);
    expect(same.report.packages.map((p) => [p.action, p.publish])).toEqual([
      ["published", false],
      ["release", true],
      ["release", true],
    ]);
    const other = {
      ...partial,
      [packageName("core")]: {
        versions: [
          { version: "0.1.0" },
          {
            version: "0.1.1",
            files: {
              ...packFiles("core", "0.1.1"),
              "dist/index.js": Buffer.from("old"),
            },
          },
        ],
        tags: { latest: "0.1.0", next: "0.1.1" },
      },
    };
    const stop = await prepare(root, fakeRegistry(other));
    expect(problems(stop.report)).toEqual([
      "core: в npm уже есть @iconavo-ui/core@0.1.1 с другим содержимым — поднимите версию всем трём: pnpm release bump",
    ]);
  });

  it("номер не выше вышедшего, снятый номер и одна заготовка npm — СТОП", async () => {
    const root = await writeReleaseRepo({ version: "0.1.1" });
    const lower = await prepare(
      root,
      fakeRegistry(publishedAll([{ version: "0.2.0" }])),
    );
    expect(problems(lower.report)[0]).toBe(
      "core: версия 0.1.1 не выше уже вышедшей 0.2.0 — pnpm release bump с версией выше",
    );
    const gone = await prepare(
      root,
      fakeRegistry(
        publishedAll(
          [{ version: "0.1.0" }, { version: "0.1.1", unpublished: true }],
          "0.1.0",
        ),
      ),
    );
    expect(problems(gone.report)[0]).toContain(
      "номер 0.1.1 уже был в npm и снят",
    );
    const stub = await prepare(
      root,
      fakeRegistry(publishedAll([{ version: "0.0.0-stage" }], "0.0.0-stage")),
    );
    expect(problems(stub.report)[0]).toContain("только заготовка 0.0.0-stage");
  });

  it("поля пакета, журнал, строки подключения и состав архива — проверяются", async () => {
    const root = await writeReleaseRepo({
      version: "0.1.0",
      changelog: "# Changelog\n\n## 0.1.0 — 2026-10-29\n\n- TODO\n",
    });
    const path = join(root, "packages/core/package.json");
    const m = JSON.parse(await readFile(path, "utf8"));
    m.license = "ISC";
    await writeFile(path, JSON.stringify(m));
    await writeFile(
      join(root, "examples/starters/html/index.html"),
      '<script type="module" src="https://cdn.jsdelivr.net/npm/@iconavo-ui/icon@0.0.9/dist/iconavo-icon.js" crossorigin="anonymous"></script>\n',
    );
    const { report } = await prepare(root, fakeRegistry({}), {
      first: true,
      pack: fakePack((id, _version, base) => {
        const files = { ...base, "dist/old.js": Buffer.from("") };
        if (id === "react") files.LICENSE = Buffer.from("ISC");
        return files;
      }),
    });
    expect(problems(report)).toEqual([
      'packages/core/package.json: поле license — "ISC", нужно "MIT"',
      "журнал: в разделе 0.1.0 осталась заготовка TODO — допишите, что изменилось",
      "examples/starters/html/index.html: в адресе скрипта версия 0.0.9, а выпуск — 0.1.0",
      "examples/starters/html/index.html: у строки подключения нет integrity",
      'examples/starters/html/index.html: в строке подключения лишнее — crossorigin="anonymous"',
      "core: @iconavo-ui/core: в dist файлы без исходника — dist/old.js: удалите dist и tsconfig.tsbuildinfo пакета и соберите заново",
      "icon: @iconavo-ui/icon: в dist файлы без исходника — dist/old.js: удалите dist и tsconfig.tsbuildinfo пакета и соберите заново",
      "react: @iconavo-ui/react: в dist файлы без исходника — dist/old.js: удалите dist и tsconfig.tsbuildinfo пакета и соберите заново",
      "react: LICENSE в архиве — не LICENSE репозитория",
    ]);
    expect(releaseStop(report)).toBe(true);
  });

  it("раздел журнала версии, которой нет в npm, — СТОП: выпуск передумали, а раздел забыли", async () => {
    const root = await writeReleaseRepo({
      version: "0.1.2",
      changelog:
        "# Changelog\n\n## 0.1.2 — 2026-11-05\n\n- C.\n\n## 0.1.1 — 2026-11-02\n\n- B.\n\n## 0.1.0 — 2026-10-29\n\n- A.\n",
    });
    const { report, plan } = await prepare(
      root,
      fakeRegistry(publishedAll([{ version: "0.1.0" }])),
    );
    expect(problems(report)).toEqual([
      "журнал: разделы 0.1.1 — этих версий нет в npm: перенесите их текст в раздел 0.1.2 и уберите",
    ]);
    expect(existsSync(plan)).toBe(false);
  });

  it("в плане — хэш README: его «Проверка» сверяет с jsDelivr", async () => {
    const root = await writeReleaseRepo({ version: "0.1.0" });
    const { report, plan } = await prepare(root, fakeRegistry({}), {
      first: true,
    });
    expect((await readReleasePlan(plan)).script.integrity).toBe(
      report.script?.readme,
    );
  });
});
