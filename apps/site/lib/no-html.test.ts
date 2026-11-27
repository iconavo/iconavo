import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Б-7 закрыт без nonce и хэшей (решение владельца 27 ноября 2026, ADR-0050, ADR-0055): у статических
// страниц Next.js встроенные скрипты свои в каждой странице, поэтому CSP пускает 'unsafe-inline'. Риск
// закрывается иначе — в коде сайта нет вставки HTML строкой: ни innerHTML, ни dangerouslySetInnerHTML, ни
// document.write, ни eval. Иконки рисует пакет (@iconavo-ui/react) из данных наборов, тексты — React.
// Единственное исключение — постоянный скрипт темы в <head> (components/ThemeScript.tsx), без данных от
// людей.

const site = join(import.meta.dirname, "..");

/** Вставка HTML или кода строкой. */
const UNSAFE = [
  /dangerouslySetInnerHTML/,
  /\.innerHTML\b/,
  /\.outerHTML\b/,
  /insertAdjacentHTML/,
  /document\.write/,
  /createContextualFragment/,
  /\bsrcdoc\b/,
  /\beval\s*\(/,
  /\bnew Function\s*\(/,
  /setTimeout\(\s*["'`]/,
  /setInterval\(\s*["'`]/,
  /\.parseFromString\s*\(/,
];

/** Где исключение законно: файл и что в нём можно. */
const ALLOWED: Record<string, RegExp[]> = {
  "components/ThemeScript.tsx": [/dangerouslySetInnerHTML/],
};

function sources(dir: string): string[] {
  return readdirSync(join(site, dir), { recursive: true, withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        /\.(ts|tsx)$/.test(e.name) &&
        !/\.(test|stories)\.tsx?$/.test(e.name),
    )
    .map((e) => join(e.parentPath, e.name));
}

describe("в коде сайта нет вставки HTML строкой (Б-7)", () => {
  it("ни в страницах, ни в компонентах, ни в lib/", () => {
    const files = ["app", "components", "lib"].flatMap(sources);
    // Разбор не слепой: файлов много, а исключение действительно есть.
    expect(files.length).toBeGreaterThan(100);
    const problems = files.flatMap((file) => {
      const name = relative(site, file).replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      return UNSAFE.filter(
        (pattern) =>
          pattern.test(text) &&
          !(ALLOWED[name] ?? []).some((a) => a.source === pattern.source),
      ).map((pattern) => `${name}: ${pattern.source}`);
    });
    expect(problems).toEqual([]);
    expect(
      readFileSync(join(site, "components", "ThemeScript.tsx"), "utf8"),
    ).toMatch(/dangerouslySetInnerHTML/);
  });
});
