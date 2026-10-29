import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DocBlock, docPages, PAGES, SOURCES } from "./docs";
import type { Inline } from "./markdown";

const root = join(import.meta.dirname, "..", "..", "..");

/** Все ссылки страниц. */
function links(blocks: DocBlock[]): string[] {
  const fromInline = (list: Inline[]): string[] =>
    list.flatMap((n) =>
      n.type === "link"
        ? [n.href, ...fromInline(n.children)]
        : n.type === "strong"
          ? fromInline(n.children)
          : [],
    );
  return blocks.flatMap((b) => {
    switch (b.type) {
      case "heading":
      case "paragraph":
        return fromInline(b.children);
      case "list":
        return b.items.flatMap(links);
      case "blockquote":
        return links(b.children);
      case "table":
        return [...b.head, ...b.rows.flat()].flatMap(fromInline);
      default:
        return [];
    }
  });
}

/** Свой корень с README и журналом — для случаев, которых в настоящих файлах нет. */
function fakeRoot(icon: string, api = "# API\n\n## Errors\n\nText.\n"): string {
  const dir = mkdtempSync(join(tmpdir(), "iconavo-docs-"));
  for (const [source, text] of [
    [SOURCES.icon, icon],
    [SOURCES.api, api],
    [SOURCES.changelog, "# Changelog\n\n## 0.1.0 — 2026-10-29\n\nText.\n"],
  ] as const) {
    mkdirSync(join(dir, source, ".."), { recursive: true });
    writeFileSync(join(dir, source), text);
  }
  return dir;
}

describe("страницы документации из README", () => {
  const pages = docPages(root);

  it("каждый раздел «##» README пакета — ровно на одной странице", () => {
    const readme = readFileSync(join(root, SOURCES.icon), "utf8");
    const titles = [...readme.matchAll(/^## (.+)$/gm)].map(
      (m) => m[1] as string,
    );
    for (const title of titles) {
      const owners = PAGES.filter((p) => p.sections.includes(title));
      expect(owners, title).toHaveLength(1);
    }
    expect(pages.map((p) => p.path)).toEqual([
      "/docs",
      "/docs/reference",
      "/docs/recipes",
      "/docs/iconify",
      "/docs/security",
      "/docs/api",
      "/docs/changelog",
    ]);
  });

  it("журнал изменений — своя страница: раздел на версию, правка — в CHANGELOG.md", () => {
    const changelog = pages.find((p) => p.slug === "changelog");
    const text = readFileSync(join(root, SOURCES.changelog), "utf8");
    const versions = [...text.matchAll(/^## (\d+\.\d+\.\d+) — /gm)].map(
      (m) => m[1] as string,
    );
    expect(versions.length).toBeGreaterThan(0);
    expect(
      changelog?.headings
        .filter((h) => h.depth === 2)
        .map((h) => h.text.split(" ")[0]),
    ).toEqual(versions);
    expect(changelog?.edit).toBe(
      "https://github.com/iconavo/iconavo/edit/main/packages/icon/CHANGELOG.md",
    );
  });

  it("раздел, совпавший с названием страницы, становится её заголовком", () => {
    const recipes = pages.find((p) => p.slug === "recipes");
    expect(recipes?.aliases).toContain("recipes");
    expect(recipes?.headings[0]).toMatchObject({
      depth: 2,
      id: "without-network-requests",
    });
    expect(pages.find((p) => p.slug === "api")?.aliases).toContain(
      "iconavo-edge-api",
    );
  });

  it("ссылки README ведут на страницы сайта", () => {
    const all = pages.flatMap((p) =>
      links(p.blocks).map((href) => [p.slug, href]),
    );
    expect(all).toContainEqual([
      "",
      "/docs/recipes#what-your-own-host-must-serve",
    ]);
    expect(all).toContainEqual(["reference", "#missing-icons"]);
    expect(all).toContainEqual([
      "reference",
      "/docs/recipes#nextjs-and-server-rendering",
    ]);
    // Внутренние — только на существующие страницы, внешние — только https.
    for (const [, href] of all) {
      expect(href).toMatch(/^(#|\/docs|https:\/\/)/);
    }
  });

  it("ссылка «править на GitHub» — на исходный README", () => {
    expect(pages[0]?.edit).toBe(
      "https://github.com/iconavo/iconavo/edit/main/packages/icon/README.md",
    );
  });

  it("раздел README без страницы — остановка с подсказкой", () => {
    const dir = fakeRoot(
      "# Icons\n\nIntro.\n\n## Install\n\nText.\n\n## Unknown\n\nText.\n",
    );
    expect(() => docPages(dir)).toThrow(
      /СТОП: .*не попал ни на одну страницу|СТОП: .*нет раздела/,
    );
  });

  it("неизвестный якорь и относительная ссылка — остановка", () => {
    const sections = PAGES.filter((p) => p.source === "icon")
      .flatMap((p) => p.sections)
      .filter((s) => s !== "");
    const body = (extra: string) =>
      `# Icons\n\n${extra}\n\n${sections.map((s) => `## ${s}\n\nText.\n`).join("\n")}`;
    expect(() =>
      docPages(fakeRoot(body("See [x](#nowhere)."), "# API\n\n## A\n")),
    ).toThrow("такого заголовка нет");
    expect(() =>
      docPages(fakeRoot(body("See [x](LICENSE)."), "# API\n\n## A\n")),
    ).toThrow("только https://");
  });
});
