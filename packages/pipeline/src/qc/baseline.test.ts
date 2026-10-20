import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceConfigSchema } from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import {
  gitHistory,
  type History,
  iconsByName,
  loadBaseline,
} from "./baseline.js";

const config = sourceConfigSchema.parse({
  id: "demo",
  name: "Demo",
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  author: { name: "Demo" },
  license: { spdx: "MIT", file: "LICENSE" },
});
const entry = (version: string): LockEntry => ({
  type: "npm",
  version,
  integrity: "sha512-AAAA",
});
const lockFile = (version: string) => JSON.stringify({ demo: entry(version) });

const ICONS = JSON.stringify({
  prefix: "demo",
  width: 24,
  height: 24,
  icons: { a: { body: "<g/>" }, b: { body: "<path/>", height: 25 } },
  aliases: {
    "a-outline": { parent: "a" },
    "a-chain": { parent: "a-outline" },
  },
});

const COMMIT = "c".repeat(40);

/** История с одним коммитом и его файлами; files не задан — набора нет в истории. */
function history(files?: Record<string, string>): History {
  return {
    lastCommit: async () => (files ? COMMIT : undefined),
    show: async (commit, path) =>
      commit === COMMIT ? files?.[path] : undefined,
  };
}

describe("прошлая версия", () => {
  it("алиас разворачивается в тело родителя, размер по умолчанию — у набора", () => {
    const icons = iconsByName(JSON.parse(ICONS));
    expect(icons.get("a")).toEqual({ body: "<g/>", width: 24, height: 24 });
    expect(icons.get("b")).toEqual({ body: "<path/>", width: 24, height: 25 });
    expect(icons.get("a-outline")).toEqual(icons.get("a"));
    expect(icons.get("a-chain")).toEqual(icons.get("a"));
    expect(icons.size).toBe(4);
  });

  it("версия источника из того же коммита: та же, другая или неизвестна", async () => {
    const files = (lock?: string) => ({
      "data/demo/icons.json": ICONS,
      ...(lock === undefined ? {} : { "sources.lock.json": lock }),
    });
    const same = await loadBaseline(
      history(files(lockFile("1.0.0"))),
      config,
      entry("1.0.0"),
    );
    expect(same.baseline?.label).toBe("коммит ccccccc, demo-icons@1.0.0");
    expect(same.baseline?.sourceChanged).toBe(false);
    expect(same.baseline?.icons.size).toBe(4);
    const updated = await loadBaseline(
      history(files(lockFile("0.9.0"))),
      config,
      entry("1.0.0"),
    );
    expect(updated.baseline?.sourceChanged).toBe(true);
    const noLock = await loadBaseline(history(files()), config, entry("1.0.0"));
    expect(noLock.baseline?.sourceChanged).toBe(true);
    expect(noLock.baseline?.label).toBe("коммит ccccccc");
  });

  it("сравнивать не с чем: набора нет в истории, git недоступен, файл не читается", async () => {
    const none = await loadBaseline(history(), config, entry("1.0.0"));
    expect(none.baselineNote).toBe(
      "data/demo/icons.json ещё нет в истории git",
    );
    const noGit: History = {
      lastCommit: async () => {
        throw new Error("not a git repository");
      },
      show: async () => undefined,
    };
    expect(
      (await loadBaseline(noGit, config, entry("1.0.0"))).baselineNote,
    ).toBe("история git недоступна — not a git repository");
    const broken = await loadBaseline(
      history({ "data/demo/icons.json": "{" }),
      config,
      entry("1.0.0"),
    );
    expect(broken.baseline).toBeUndefined();
    expect(broken.baselineNote).toMatch(/из коммита ccccccc не читается/);
  });

  it("настоящий git: берётся коммит, где последний раз менялся файл набора", async () => {
    const repo = await mkdtemp(join(tmpdir(), "iconavo-git-"));
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@t",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: repo, encoding: "utf8" },
      );
    try {
      git("init", "-q");
      await mkdir(join(repo, "data", "demo"), { recursive: true });
      await writeFile(join(repo, "data", "demo", "icons.json"), ICONS);
      await writeFile(join(repo, "sources.lock.json"), lockFile("1.0.0"));
      git("add", ".");
      git("commit", "-q", "-m", "сборка");
      const built = git("rev-parse", "HEAD").trim();
      // Версию закрепили и закоммитили раньше пересборки: прошлая версия — всё ещё сборка.
      await writeFile(join(repo, "sources.lock.json"), lockFile("2.0.0"));
      git("commit", "-q", "-am", "новая версия");
      const r = await loadBaseline(gitHistory(repo), config, entry("2.0.0"));
      expect(r.baseline?.label).toBe(
        `коммит ${built.slice(0, 7)}, demo-icons@1.0.0`,
      );
      expect(r.baseline?.sourceChanged).toBe(true);
      expect(r.baseline?.icons.get("a-chain")?.body).toBe("<g/>");
      const other = sourceConfigSchema.parse({ ...config, id: "other" });
      expect(
        (await loadBaseline(gitHistory(repo), other, entry("1.0.0")))
          .baselineNote,
      ).toBe("data/other/icons.json ещё нет в истории git");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
