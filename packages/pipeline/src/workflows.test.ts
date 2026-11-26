// Фильтры запуска workflow и код, который они выкладывают (ревизия фазы 5, Р-9 и Р-10). Сборка edge API
// и MCP-сервера берёт файлы конвейера: правка любого из них должна запускать выкладку. Проверка «main
// ушёл вперёд» смотрит ровно на то, что запускает workflow: иначе живой запуск становится показом, а
// нового запуска нет.

import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = "packages/pipeline/src";

/** `import … from "./x.js"` и `export … from`: есть ли `type`, что импортируется, откуда. */
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+"(\.{1,2}\/[^"]+)"/g;

/** В импорте есть значения, а не только типы: `x`, `* as x`, `{ type A, b }`. */
function hasValues(clause: string): boolean {
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces === null) return true;
  const rest = clause
    .replace(/\{[^}]*\}/, "")
    .replace(",", "")
    .trim();
  const names = (braces[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return rest !== "" || names.some((name) => !name.startsWith("type "));
}

/** Файлы конвейера, которые сборка берёт при выполнении, — без импортов только типов. */
function runtimeFiles(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, typeOnly, clause = "", spec = ""] of readFileSync(
      join(ROOT, file),
      "utf8",
    ).matchAll(IMPORT)) {
      if (typeOnly !== undefined || !hasValues(clause)) continue;
      const next = posix
        .join(posix.dirname(file), spec)
        .replace(/\.js$/, ".ts");
      if (next.startsWith(`${SRC}/`) && existsSync(join(ROOT, next))) {
        visit(next);
      }
    }
  };
  visit(entry);
  return [...seen].sort();
}

const workflow = (name: string) =>
  readFileSync(join(ROOT, ".github", "workflows", name), "utf8");

/** Пути запуска по push в main — список `paths:` под `push:`. */
function pushPaths(text: string): string[] {
  const lines = text.split("\n");
  const paths: string[] = [];
  for (const line of lines.slice(lines.indexOf("  push:") + 1)) {
    if (/^ {0,2}\S/.test(line)) break;
    const m = line.match(/^ {6}- "([^"]+)"$/);
    if (m?.[1] !== undefined) paths.push(m[1]);
  }
  return paths;
}

/** Пути проверки «main ушёл вперёд» — `git diff --quiet origin/main HEAD -- …`. */
function livePaths(text: string): string[] {
  const m = text.match(/git diff --quiet origin\/main HEAD -- ([^;\n]+);/);
  return m?.[1] === undefined ? [] : m[1].trim().split(/\s+/);
}

/** Файл задан путём: тот же файл, `папка/**` у push или `папка/` у git diff. */
const covers = (paths: readonly string[], file: string) =>
  paths.some(
    (p) =>
      p === file ||
      (p.endsWith("/**") && file.startsWith(p.slice(0, -2))) ||
      (p.endsWith("/") && file.startsWith(p)),
  );

describe("фильтры запуска workflow", () => {
  it.each([
    ["api.yml", `${SRC}/api/build.ts`],
    ["mcp.yml", `${SRC}/mcp/build.ts`],
  ])(
    "%s запускается от каждого файла конвейера, который берёт сборка",
    (name, entry) => {
      const text = workflow(name);
      const files = runtimeFiles(entry);
      // Разбор не слепой: сборка тянет и сам конфиг, и общие помощники.
      expect(files).toContain(`${SRC}/api/config.ts`);
      expect(files).toContain(`${SRC}/meili/config.ts`);
      expect(
        files.filter((f) => !covers(pushPaths(text), f)),
        "нет в paths у push",
      ).toEqual([]);
      expect(
        files.filter((f) => !covers(livePaths(text), f)),
        "нет в проверке «main ушёл вперёд»",
      ).toEqual([]);
    },
  );

  it.each(["api.yml", "mcp.yml", "publish.yml", "site.yml"])(
    "%s: «main ушёл вперёд» смотрит ровно на то, что запускает workflow",
    (name) => {
      const text = workflow(name);
      const push = pushPaths(text);
      expect(push.length).toBeGreaterThan(2);
      expect([...livePaths(text)].sort()).toEqual(
        push.map((p) => p.replace(/\*\*$/, "")).sort(),
      );
    },
  );
});

describe("публикация пакетов данных (ревизия фазы 5, А-3)", () => {
  it("реестр сверяется с тегом, каким его видел план, а не с основой плана", () => {
    const text = workflow("publish.yml");
    expect(text).toContain('(.tagged // "-")');
    expect(text).toContain('if [ "$current" != "$tagged" ]; then');
    expect(text).not.toContain("(.base //");
  });
});
