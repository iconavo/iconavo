import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { pagePath } from "./page-path";

const site = join(import.meta.dirname, "..");

/** Исходники сайта, которые попадают в страницы: app, components, lib — без тестов и историй. */
function sources(): string[] {
  return ["app", "components", "lib"].flatMap((dir) =>
    readdirSync(join(site, dir), { recursive: true, withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          /\.tsx?$/.test(e.name) &&
          !/\.(test|stories)\.tsx?$/.test(e.name),
      )
      .map((e) => join(e.parentPath, e.name)),
  );
}

const IMPORTS_PATHNAME =
  /import\s*\{[^}]*\busePathname\b[^}]*\}\s*from\s*["']next\/navigation["']/;

describe("адрес страницы (ADR-0039)", () => {
  it("внутреннее имя главной после сброса кэша — главная", () => {
    expect(pagePath("/index")).toBe("/");
  });

  it.each([
    "/",
    "/ru",
    "/search",
    "/ru/search",
    "/sets",
    "/lucide",
    "/ru/lucide",
    "/lucide/index",
    "/ru/lucide/index",
    "/docs/reference",
  ])("%s — без изменений", (path) => {
    expect(pagePath(path)).toBe(path);
  });

  it("компоненты берут адрес страницы только через usePagePath", () => {
    const direct = sources()
      .filter((file) => !file.endsWith(join("lib", "page-path.ts")))
      .filter((file) => IMPORTS_PATHNAME.test(readFileSync(file, "utf8")))
      .map((file) => relative(site, file).replaceAll("\\", "/"));
    expect(
      direct,
      "usePathname() отдаёт «/index» у главной, собранной после сброса кэша: используйте usePagePath() из lib/page-path",
    ).toEqual([]);
  });

  it("сторож видит прямой импорт", () => {
    expect(
      IMPORTS_PATHNAME.test(
        'import { usePathname, useRouter } from "next/navigation";',
      ),
    ).toBe(true);
    expect(
      IMPORTS_PATHNAME.test('import { useRouter } from "next/navigation";'),
    ).toBe(false);
  });
});
