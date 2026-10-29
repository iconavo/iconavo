// Согласованность живых примеров с README и пакетами (ADR-0050): одна версия скрипта тега во всём
// README, HTML-пример подключает его теми же строками, что README, примеры просят ту же версию пакетов,
// версии всех зависимостей примеров — точные, ссылки — из starters/links.ts, имена иконок — есть в data/.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGES, STARTER_IDS } from "./config.js";
import { CREATE_NEXT_APP, STACKBLITZ_LINKS } from "./links.js";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const json = (path: string) =>
  JSON.parse(read(path)) as Record<string, unknown>;

const readme = read("packages/icon/README.md");
const SCRIPT =
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@iconavo-ui\/icon@([^/]+)\/dist\/iconavo-icon\.js/g;
const versions = [
  ...new Set([...readme.matchAll(SCRIPT)].map((m) => m[1] as string)),
];
const version = versions[0] as string;

type Manifest = {
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const starters = STARTER_IDS.filter((id) =>
  existsSync(join(root, "examples/starters", id, "package.json")),
);
const manifest = (id: string) =>
  json(`examples/starters/${id}/package.json`) as Manifest;

describe("живые примеры согласованы с README и пакетами", () => {
  it("в README одна версия скрипта тега", () => {
    expect(versions).toHaveLength(1);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("HTML-пример подключает тег теми же строками, что README", () => {
    const page = read("examples/starters/html/index.html")
      .split(/\r?\n/)
      .map((l) => l.trim());
    const lines = readme.split(/\r?\n/).map((l) => l.trim());
    const script = lines.find((l) =>
      l.startsWith('<script type="module" src="https://cdn.jsdelivr.net'),
    );
    const style = lines.find((l) =>
      l.startsWith("<style>iconavo-icon:not(:defined)"),
    );
    expect(script).toBeDefined();
    expect(style).toBeDefined();
    expect(page).toContain(script);
    expect(page).toContain(style);
  });

  it("примеры просят пакеты той же версии", () => {
    for (const id of starters) {
      for (const [name, range] of Object.entries(
        manifest(id).dependencies ?? {},
      )) {
        if (name.startsWith("@iconavo-ui/"))
          expect(`${id}: ${name}@${range}`).toBe(`${id}: ${name}@${version}`);
      }
    }
  });

  it("пакеты: либо ещё не опубликованы (0.0.0, private), либо ровно версия README", () => {
    for (const id of PACKAGES) {
      const pkg = json(`packages/${id}/package.json`) as Manifest;
      const unpublished = pkg.version === "0.0.0" && pkg.private === true;
      const released = pkg.version === version && pkg.private !== true;
      expect(
        unpublished || released,
        `${id}: ${pkg.version}, private ${pkg.private}`,
      ).toBe(true);
    }
  });

  it("версии всех зависимостей примеров — точные", () => {
    for (const id of starters) {
      const m = manifest(id);
      for (const [name, range] of Object.entries({
        ...m.dependencies,
        ...m.devDependencies,
      })) {
        expect(`${id}: ${name}@${range}`).toMatch(/@\d+\.\d+\.\d+$/);
      }
    }
  });

  it("lock-файлы: после публикации обязательны и совпадают с package.json", () => {
    const published =
      (json("packages/react/package.json") as Manifest).version !== "0.0.0";
    for (const id of starters) {
      const path = `examples/starters/${id}/package-lock.json`;
      if (!existsSync(join(root, path))) {
        expect(
          published,
          `${path}: нет, а пакеты уже опубликованы — pnpm starters --lock`,
        ).toBe(false);
        continue;
      }
      const lock = json(path) as {
        packages: Record<
          string,
          { version?: string; resolved?: string } & Manifest
        >;
      };
      const m = manifest(id);
      expect(lock.packages[""]?.dependencies).toEqual(m.dependencies);
      expect(lock.packages[""]?.devDependencies).toEqual(m.devDependencies);
      for (const [path, entry] of Object.entries(lock.packages)) {
        if (!path.includes("node_modules/@iconavo-ui/")) continue;
        expect(entry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
        expect(entry.version).toBe(version);
      }
    }
  });

  it("ссылки на примеры — из starters/links.ts, в README и в README примеров", () => {
    for (const [id, url] of Object.entries(STACKBLITZ_LINKS)) {
      expect(readme).toContain(url);
      expect(read(`examples/starters/${id}/README.md`)).toContain(url);
    }
    expect(readme).toContain(CREATE_NEXT_APP);
    expect(read("examples/starters/next/README.md")).toContain(CREATE_NEXT_APP);
  });

  it("имена иконок примеров есть в data/ и не скрыты", () => {
    const files = [
      "examples/starters/html/index.html",
      "examples/starters/react/src/App.tsx",
      "examples/starters/next/app/layout.tsx",
      "examples/starters/next/app/page.tsx",
      "examples/starters/next/app/like-button.tsx",
    ];
    const names = new Set(
      files.flatMap((f) =>
        [...read(f).matchAll(/"([a-z0-9-]+:[a-z0-9-]+)"/g)].map(
          (m) => m[1] as string,
        ),
      ),
    );
    expect(names.size).toBeGreaterThan(5);
    const missing = [...names].filter((name) => {
      const [set, icon] = name.split(":") as [string, string];
      const data = json(`data/${set}/icons.json`) as {
        icons: Record<string, { hidden?: boolean }>;
        aliases?: Record<string, { hidden?: boolean }>;
      };
      const entry = data.icons[icon] ?? data.aliases?.[icon];
      return entry === undefined || entry.hidden === true;
    });
    expect(missing).toEqual([]);
  });
});
