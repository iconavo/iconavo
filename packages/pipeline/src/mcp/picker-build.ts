// Сетка выбора в чате (шаг 11 фазы 4, ADR-0045): одна HTML-страница — вид MCP Apps. rolldown собирает вид
// apps/mcp/src/picker/view.ts для браузера (SDK MCP Apps, общий модуль кода и ядро — внутри), стили — токены
// сайта из блока @theme apps/site/app/globals.css и правила view.css. Всё встроено в страницу: рамка
// клиента без сети, и по умолчанию она пускает только встроенные скрипты и стили. Версия — 8 знаков
// SHA-256 страницы: по ней меняется адрес ui://picker/{версия}, и клиент не покажет старую сетку из кэша.
// Vite из навыков MCP Apps не нужен: rolldown уже собирает функции и скрипт тега.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { IMPORT } from "../api/build.js";

/** Вход вида и его стили — от корня репозитория. */
export const PICKER_ENTRY = "apps/mcp/src/picker/view.ts";
export const PICKER_CSS = "apps/mcp/src/picker/view.css";
/** Токены сайта (ADR-0038): сетка в чате берёт те же значения. */
export const SITE_TOKENS = "apps/site/app/globals.css";
/** Сборки пакетов для браузера: у SDK MCP — свои заглушки модулей Node для браузера. */
export const BROWSER_CONDITIONS = ["browser", "import", "default"] as const;
/** Заглушка метки сборки функции: в странице её быть не может — метку ставит stampBuild ровно в одно место. */
const BUILD_PLACEHOLDER = "__ICONAVO_BUILD__";
/**
 * Бюджет страницы в gzip: замер 20 ноября 2026 — 72 КБ (SDK MCP Apps с клиентом протокола и zod внутри),
 * плюс 10%. Клиент читает страницу при каждом показе сетки, если не держит её в кэше.
 */
export const PICKER_GZIP_BUDGET = 80_000;

export interface PickerBuild {
  html: string;
  /** 8 знаков SHA-256 страницы. */
  version: string;
  bytes: number;
  gzipBytes: number;
  scriptBytes: number;
}

/** Модуль для браузера: один сжатый ES-модуль без импортов. */
export async function bundleBrowser(
  root: string,
  entry: string,
): Promise<string> {
  const { build } = await import("rolldown");
  const warnings: string[] = [];
  const result = await build({
    input: join(root, entry),
    cwd: root,
    platform: "browser",
    resolve: {
      extensionAlias: { ".js": [".ts", ".js"] },
      conditionNames: [...BROWSER_CONDITIONS],
    },
    write: false,
    onLog: (level, log) => {
      if (level === "warn") warnings.push(log.message);
    },
    output: { format: "esm", minify: true, codeSplitting: false },
  });
  if (warnings.length > 0) {
    throw new Error(
      `сборка ${entry} с предупреждениями: ${warnings.join("; ")}`,
    );
  }
  const [chunk, ...rest] = result.output;
  if (rest.length > 0 || chunk.type !== "chunk") {
    throw new Error(`сборка ${entry} дала не один файл`);
  }
  if (
    chunk.imports.length > 0 ||
    chunk.dynamicImports.length > 0 ||
    IMPORT.test(chunk.code)
  ) {
    throw new Error(`в сборке ${entry} остался импорт: всё должно быть внутри`);
  }
  return chunk.code;
}

/**
 * Токены из блока @theme сайта — объявлениями для :root: пары light-dark() браузер считает сам по
 * color-scheme. Шаблоны Tailwind (--color-*: initial) и шрифт сайта пропускаются: шрифт в рамке — чата.
 */
export function themeTokens(css: string): string {
  const start = css.indexOf("@theme {");
  if (start < 0) throw new Error(`в ${SITE_TOKENS} нет блока @theme`);
  const end = css.indexOf("\n}", start);
  const block = css
    .slice(start + "@theme {".length, end)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = block
    .split(";")
    .map((d) => d.trim().replace(/\s+/g, " "))
    .filter(
      (d) =>
        d.startsWith("--") &&
        !/^--[\w-]*\*\s*:/.test(d) &&
        !d.startsWith("--font-sans:"),
    );
  if (!declarations.some((d) => d.startsWith("--color-"))) {
    throw new Error(`в блоке @theme ${SITE_TOKENS} нет токенов цвета`);
  }
  return `:root {\n${declarations.map((d) => `  ${d};`).join("\n")}\n}\n`;
}

const count = (text: string, pattern: RegExp) =>
  (text.match(pattern) ?? []).length;

/** Страница сетки: один встроенный стиль и один встроенный скрипт. */
export function pickerHtml(script: string, css: string): string {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Iconavo</title>
<style>
${css}</style>
</head>
<body>
<main id="picker" class="picker" aria-busy="true"></main>
<script type="module">${script}</script>
</body>
</html>
`;
  // Разбор HTML однозначен, только если тегов <script> и <style> ровно по одному: иначе строка внутри
  // скрипта могла бы закрыть его раньше времени.
  if (
    count(html, /<script/gi) !== 1 ||
    count(html, /<\/script/gi) !== 1 ||
    count(html, /<style/gi) !== 1 ||
    count(html, /<\/style/gi) !== 1
  ) {
    throw new Error(
      "в странице сетки лишние <script> или <style>: строка в коде вида их повторяет",
    );
  }
  if (html.includes(BUILD_PLACEHOLDER)) {
    throw new Error(
      `в странице сетки заглушка метки ${BUILD_PLACEHOLDER}: вид не должен импортировать config edge API`,
    );
  }
  return html;
}

export const pickerVersion = (html: string): string =>
  createHash("sha256").update(html).digest("hex").slice(0, 8);

const builds = new Map<string, Promise<PickerBuild>>();

/** Страница сетки из исходников; повтор в том же процессе — та же сборка. */
export function buildPicker(root: string): Promise<PickerBuild> {
  let build = builds.get(root);
  if (build === undefined) {
    build = (async () => {
      const [script, own, site] = await Promise.all([
        bundleBrowser(root, PICKER_ENTRY),
        readFile(join(root, PICKER_CSS), "utf8"),
        readFile(join(root, SITE_TOKENS), "utf8"),
      ]);
      const html = pickerHtml(script, `${themeTokens(site)}${own}`);
      return {
        html,
        version: pickerVersion(html),
        bytes: Buffer.byteLength(html, "utf8"),
        gzipBytes: gzipSync(html).length,
        scriptBytes: Buffer.byteLength(script, "utf8"),
      };
    })();
    build.catch(() => builds.delete(root));
    builds.set(root, build);
  }
  return build;
}
