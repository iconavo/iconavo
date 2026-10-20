import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceConfigSchema } from "../sources/config.js";
import { baseRevision } from "../sources/git.js";
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
      (await loadBaseline(noGit, config, entry("1.0.0"))).baselineError,
    ).toBe("история git недоступна — not a git repository");
    const broken = await loadBaseline(
      history({ "data/demo/icons.json": "{" }),
      config,
      entry("1.0.0"),
    );
    expect(broken.baseline).toBeUndefined();
    expect(broken.baselineNote).toBeUndefined();
    expect(broken.baselineError).toMatch(/из коммита ccccccc не читается/);
    const badChangelog = await loadBaseline(
      history({
        "data/demo/icons.json": ICONS,
        "data/demo/changelog.json": JSON.stringify({ prefix: "demo" }),
      }),
      config,
      entry("1.0.0"),
    );
    expect(badChangelog.baselineError).toMatch(
      /из коммита ccccccc не читается/,
    );
    const onlyChangelog = await loadBaseline(
      history({ "data/demo/changelog.json": "{}" }),
      config,
      entry("1.0.0"),
    );
    expect(onlyChangelog.baselineError).toBe(
      "в коммите ccccccc нет data/demo/icons.json",
    );
  });

  it("журнал и скрытые иконки прошлой версии — из того же коммита", async () => {
    const changelog = JSON.stringify({
      prefix: "demo",
      releases: [
        {
          version: "0123abcd",
          date: "2026-10-20T09:00:00Z",
          revision: "1.0.0",
          total: 2,
        },
      ],
    });
    const icons = JSON.stringify({
      ...JSON.parse(ICONS),
      icons: {
        ...JSON.parse(ICONS).icons,
        old: { body: "<rect/>", hidden: true },
      },
    });
    const r = await loadBaseline(
      history({
        "data/demo/icons.json": icons,
        "data/demo/changelog.json": changelog,
        "sources.lock.json": lockFile("1.0.0"),
      }),
      config,
      entry("1.0.0"),
    );
    expect(r.baseline?.changelog?.releases[0]?.version).toBe("0123abcd");
    expect(r.baseline?.state?.icons.get("old")?.hidden).toBe(true);
    expect(r.baseline?.state?.aliases.get("a-chain")).toBe("a");
    expect(r.baseline?.icons.size).toBe(5);
    // Журнала ещё не было (данные шага 7) — прошлая версия есть, журнал начнётся с этой сборки.
    const noLog = await loadBaseline(
      history({ "data/demo/icons.json": ICONS }),
      config,
      entry("1.0.0"),
    );
    expect(noLog.baseline?.state?.icons.size).toBe(2);
    expect(noLog.baseline?.changelog).toBeUndefined();
  });

  it("настоящий git: прошлая версия — версия в main; свои коммиты ветки, даже исправленные, не в счёт", async () => {
    const repo = await mkdtemp(join(tmpdir(), "iconavo-git-"));
    const clone = await mkdtemp(join(tmpdir(), "iconavo-clone-"));
    const run = (cwd: string, ...args: string[]) =>
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
        { cwd, encoding: "utf8" },
      );
    const git = (...args: string[]) => run(repo, ...args);
    const icons = (extra: object) =>
      writeFile(
        join(repo, "data", "demo", "icons.json"),
        JSON.stringify({ ...JSON.parse(ICONS), ...extra }),
      );
    try {
      git("init", "-q", "-b", "main");
      await mkdir(join(repo, "data", "demo"), { recursive: true });
      await icons({});
      await writeFile(join(repo, "sources.lock.json"), lockFile("1.0.0"));
      git("add", ".");
      git("commit", "-q", "-m", "сборка в main");
      const main = git("rev-parse", "HEAD").trim();
      git("update-ref", "refs/remotes/origin/main", main);
      git("checkout", "-q", "-b", "feature");
      await icons({ lastModified: 1 });
      git("commit", "-q", "-am", "сборка на ветке");
      await icons({ lastModified: 2 });
      git("commit", "-q", "-a", "--amend", "-m", "исправленная сборка");

      const base = await baseRevision(repo);
      expect(base).toEqual({
        commit: main,
        label: `версия в main (коммит ${main.slice(0, 7)})`,
      });
      const r = await loadBaseline(
        gitHistory(repo, base.commit),
        config,
        entry("1.0.0"),
      );
      expect(r.baseline?.label).toBe(
        `коммит ${main.slice(0, 7)}, demo-icons@1.0.0`,
      );
      // Без from — последний коммит ветки, как раньше.
      const head = git("rev-parse", "HEAD").trim();
      expect(
        (await loadBaseline(gitHistory(repo), config, entry("1.0.0"))).baseline
          ?.label,
      ).toBe(`коммит ${head.slice(0, 7)}, demo-icons@1.0.0`);

      // Клон глубиной 1, как в CI: общего предка не найти — прошлая версия от HEAD.
      run(
        clone,
        "clone",
        "-q",
        "--depth",
        "1",
        "--no-single-branch",
        "--branch",
        "feature",
        pathToFileURL(repo).href,
        ".",
      );
      expect(await baseRevision(clone)).toEqual({
        commit: head,
        label: `HEAD (коммит ${head.slice(0, 7)}): origin/main не найден`,
      });
      // Нет origin/main вовсе — тоже HEAD.
      git("update-ref", "-d", "refs/remotes/origin/main");
      expect((await baseRevision(repo)).commit).toBe(head);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(clone, { recursive: true, force: true });
    }
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
