import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BumpOptions, bumpRelease, versionProblem } from "./bump.js";
import { scriptUrl } from "./config.js";
import {
  fakeBuild,
  fakeRegistry,
  publishedAll,
  SCRIPT,
  writeReleaseRepo,
} from "./fixture.testing.js";
import { changelogSections, scriptRefs, sri } from "./text.js";

const read = (root: string, path: string) => readFile(join(root, path), "utf8");
const json = async (root: string, path: string) =>
  JSON.parse(await read(root, path)) as Record<string, unknown> & {
    dependencies?: Record<string, string>;
  };

/** bump без сборки и сети: реестр — пустой, если не задан другой. */
const bump = (o: Omit<BumpOptions, "buildScript">) =>
  bumpRelease({ registry: fakeRegistry({}), buildScript: fakeBuild, ...o });

const sections = async (root: string) =>
  changelogSections(await read(root, "packages/icon/CHANGELOG.md")).sections;

describe("pnpm release bump", () => {
  it("первый выпуск: версия трём пакетам и примерам, private снят, раздел журнала, хэш в строках", async () => {
    const root = await writeReleaseRepo({
      version: "0.0.0",
      integrity: null,
      starters: "0.1.0",
      changelog: "# Changelog\n\nIntro.\n",
    });
    const report = await bump({ root, version: "0.1.0", date: "2026-10-30" });
    expect(report).toMatchObject({
      from: "0.0.0",
      version: "0.1.0",
      integrity: sri(SCRIPT),
      removed: [],
    });
    for (const id of ["core", "icon", "react"]) {
      const m = await json(root, `packages/${id}/package.json`);
      expect(m.version).toBe("0.1.0");
      expect("private" in m).toBe(false);
    }
    expect((await sections(root))[0]).toEqual({
      version: "0.1.0",
      date: "2026-10-30",
      body: "- TODO",
    });
    for (const path of [
      "packages/icon/README.md",
      "examples/starters/html/index.html",
      "README.md",
    ]) {
      const refs = scriptRefs(await read(root, path));
      expect(refs.tags, path).toEqual([
        {
          version: "0.1.0",
          integrity: sri(SCRIPT),
          attributes: `integrity="${sri(SCRIPT)}"`,
        },
      ]);
    }
    expect(await read(root, "packages/icon/README.md")).toContain(
      `import { configure } from "${scriptUrl("0.1.0")}"`,
    );
    expect(report.changed).toContain("packages/icon/CHANGELOG.md");
  });

  it("новая версия после вышедшей: новый раздел, примеры на неё, устаревшие lock-файлы удаляются", async () => {
    const root = await writeReleaseRepo({ version: "0.1.0" });
    const lock = {
      packages: {
        "": {},
        "node_modules/@iconavo-ui/react": { version: "0.1.0" },
      },
    };
    await writeFile(
      join(root, "examples/starters/react/package-lock.json"),
      JSON.stringify(lock),
    );
    const report = await bump({
      root,
      version: "0.1.1",
      date: "2026-11-02",
      registry: fakeRegistry(publishedAll([{ version: "0.1.0" }])),
    });
    expect(report.removed).toEqual([
      "examples/starters/react/package-lock.json",
    ]);
    expect(
      existsSync(join(root, "examples/starters/react/package-lock.json")),
    ).toBe(false);
    for (const id of ["react", "next"]) {
      expect(
        (await json(root, `examples/starters/${id}/package.json`)).dependencies,
      ).toEqual({
        "@iconavo-ui/react": "0.1.1",
        react: "19.3.1",
      });
    }
    expect((await sections(root)).map((s) => `${s.version} ${s.date}`)).toEqual(
      ["0.1.1 2026-11-02", "0.1.0 2026-10-29"],
    );
    expect(scriptRefs(await read(root, "README.md")).versions).toEqual([
      "0.1.1",
    ]);
  });

  it("выпуск передумали на другую версию: невышедший раздел переходит к ней с текстом", async () => {
    const root = await writeReleaseRepo({
      version: "0.1.1",
      changelog:
        "# Changelog\n\n## 0.1.1 — 2026-11-02\n\n- Breaking.\n\n## 0.1.0 — 2026-10-29\n\n- First.\n",
    });
    await bump({
      root,
      version: "0.2.0",
      date: "2026-11-03",
      registry: fakeRegistry(publishedAll([{ version: "0.1.0" }])),
    });
    expect(await sections(root)).toEqual([
      { version: "0.2.0", date: "2026-11-03", body: "- Breaking." },
      { version: "0.1.0", date: "2026-10-29", body: "- First." },
    ]);
  });

  it("без версии, пока версия не вышла, — только хэш и дата раздела", async () => {
    const root = await writeReleaseRepo({
      version: "0.1.0",
      integrity: "sha384-old",
    });
    const report = await bump({ root, date: "2026-10-31" });
    expect(report.version).toBe("0.1.0");
    expect(report.changed.sort()).toEqual([
      "README.md",
      "examples/starters/html/index.html",
      "packages/icon/CHANGELOG.md",
      "packages/icon/README.md",
    ]);
    expect((await sections(root))[0]?.date).toBe("2026-10-31");
    // Повтор — без изменений.
    expect((await bump({ root, date: "2026-10-31" })).changed).toEqual([]);
  });

  it("без версии после её выхода — ошибка: хэш вышедшего скрипта не меняется", async () => {
    const root = await writeReleaseRepo({ version: "0.1.0" });
    const registry = fakeRegistry(publishedAll([{ version: "0.1.0" }]));
    await expect(bump({ root, date: "2026-11-02", registry })).rejects.toThrow(
      "0.1.0 уже в npm",
    );
    // Ничего не записано.
    expect((await sections(root))[0]?.date).toBe("2026-10-29");
  });

  it("сборка скрипта упала — ни один файл не тронут", async () => {
    const root = await writeReleaseRepo({ version: "0.1.0" });
    await expect(
      bumpRelease({
        root,
        version: "0.1.1",
        date: "2026-11-02",
        registry: fakeRegistry(publishedAll([{ version: "0.1.0" }])),
        buildScript: async () => {
          throw new Error("сборка скрипта тега с предупреждениями");
        },
      }),
    ).rejects.toThrow("сборка скрипта");
    expect((await json(root, "packages/icon/package.json")).version).toBe(
      "0.1.0",
    );
    expect((await sections(root)).map((s) => s.version)).toEqual(["0.1.0"]);
  });

  it("неверная версия и выпуск без версии до первого — ошибка", async () => {
    const root = await writeReleaseRepo({ version: "0.0.0" });
    await expect(bump({ root, date: "2026-10-30" })).rejects.toThrow(
      "pnpm release bump 0.1.0",
    );
    expect(versionProblem("0.1.0", "0.1")).toContain("X.Y.Z");
    expect(versionProblem("0.1.0", "01.2.0")).toContain("X.Y.Z");
    expect(versionProblem("0.1.0", "1.0.0")).toContain(
      "1.0 выходит в день запуска",
    );
    expect(versionProblem("0.1.0", "0.1.0")).toContain("не выше нынешней");
    expect(versionProblem("0.1.9", "0.1.10")).toBeUndefined();
  });

  it("разные версии у пакетов — ошибка: пакеты выходят вместе", async () => {
    const root = await writeReleaseRepo({ version: "0.1.0" });
    const path = join(root, "packages/react/package.json");
    const m = JSON.parse(await readFile(path, "utf8"));
    m.version = "0.1.1";
    await writeFile(path, JSON.stringify(m));
    await expect(
      bump({ root, version: "0.1.2", date: "2026-11-02" }),
    ).rejects.toThrow("разные версии");
  });
});
