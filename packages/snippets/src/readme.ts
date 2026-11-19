// Строки установки из README тега для генератора кода (шаг 5 фазы 4, ADR-0042, ADR-0050) и разделы
// README для get_usage MCP-сервера (шаг 10 фазы 4, ADR-0044). Модуль читают только сборки — next.config.ts,
// Storybook и pnpm mcp build: в код страниц и функции разбор Markdown не попадает. Нужной строки или
// раздела нет или их несколько — «СТОП» сборки с подсказкой, как у разделов документации.

import type { Install } from "./install.js";
import { type Block, parseMarkdown, plainText } from "./markdown.js";

const SCRIPT =
  /^<script type="module" src="https:\/\/cdn\.jsdelivr\.net\/npm\/@iconavo-ui\/icon@[^"/]+\/dist\/iconavo-icon\.js" integrity="sha384-[^"]+"><\/script>$/;
const STYLE = /^<style>iconavo-icon:not\(:defined\) \{[^}]*\}<\/style>$/;
const NPM = /^npm install (@iconavo-ui\/[a-z]+)$/;
const TAG_IMPORT = /^import "@iconavo-ui\/icon";/;
const REACT_IMPORT = 'import { Icon } from "@iconavo-ui/react";';

/** Блоки кода README вместе с вложенными в списки и цитаты. */
function codes(blocks: Block[]): { lang: string; value: string }[] {
  return blocks.flatMap((b) =>
    b.type === "code"
      ? [b]
      : b.type === "list"
        ? b.items.flatMap(codes)
        : b.type === "blockquote"
          ? codes(b.children)
          : [],
  );
}

function one(found: ReadonlySet<string>, what: string): string {
  const [first, ...rest] = found;
  if (first === undefined || rest.length > 0) {
    throw new Error(
      `packages/icon/README.md: ${what} — ${first === undefined ? "нет" : `разные: ${[...found].join(" | ")}`}. Генератор кода сайта берёт её из README (ADR-0042)`,
    );
  }
  return first;
}

/** Строки установки из текста README тега. */
export function installFromReadme(text: string): Install {
  const lines = codes(parseMarkdown(text)).flatMap((c) =>
    c.value.split("\n").map((line) => ({ lang: c.lang, line: line.trim() })),
  );
  const pick = (langs: readonly string[], test: (line: string) => boolean) =>
    new Set(
      lines
        .filter((l) => langs.includes(l.lang) && test(l.line))
        .map((l) => l.line),
    );
  const packages = new Set(
    lines.flatMap((l) => {
      const m = l.lang === "sh" ? NPM.exec(l.line) : null;
      return m ? [m[1] as string] : [];
    }),
  );
  const pkg = (name: string) => {
    if (!packages.has(name)) {
      throw new Error(
        `packages/icon/README.md: нет команды «npm install ${name}» без тега версии. Генератор кода сайта берёт её из README (ADR-0042)`,
      );
    }
    return name;
  };
  return {
    script: [
      one(
        pick(["html"], (l) => SCRIPT.test(l)),
        "строка <script> тега с хэшем integrity",
      ),
      one(
        pick(["html"], (l) => STYLE.test(l)),
        "строка <style> для iconavo-icon:not(:defined)",
      ),
    ].join("\n"),
    tag: {
      package: pkg("@iconavo-ui/icon"),
      import: one(
        pick(["js", "ts"], (l) => TAG_IMPORT.test(l)),
        'строка import "@iconavo-ui/icon"',
      ),
    },
    react: {
      package: pkg("@iconavo-ui/react"),
      import: one(
        pick(["jsx", "tsx"], (l) => l === REACT_IMPORT),
        REACT_IMPORT,
      ),
    },
  };
}

/** Разделы README тега, которые отдаёт get_usage MCP-сервера: ключ → заголовок. */
export const USAGE_SECTIONS = {
  install: "Install",
  html: "HTML",
  react: "React",
  size: "Size and color",
  label: "A label for screen readers",
  next: "Next.js and server rendering",
  license: "License",
} as const;

export type UsageSection = keyof typeof USAGE_SECTIONS;

export interface Usage {
  /** Версия пакетов — из адреса скрипта README (`@iconavo-ui/icon@0.1.1`). */
  version: string;
  install: Install;
  /** Разделы дословно, Markdown: от заголовка до следующего заголовка того же или старшего уровня. */
  sections: Record<UsageSection, string>;
}

const VERSION = /@iconavo-ui\/icon@([0-9A-Za-z.+-]+)\/dist\//;

/** Строки установки, версия и разделы README тега для get_usage (шаг 10 фазы 4, ADR-0044). */
export function usageFromReadme(text: string): Usage {
  const install = installFromReadme(text);
  const version = VERSION.exec(install.script)?.[1];
  if (version === undefined) {
    throw new Error(
      "packages/icon/README.md: в адресе скрипта нет версии @iconavo-ui/icon@… (ADR-0044)",
    );
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headings = parseMarkdown(text).flatMap((b) =>
    b.type === "heading"
      ? [{ title: plainText(b.children), depth: b.depth, line: b.line }]
      : [],
  );
  const sections = {} as Record<UsageSection, string>;
  for (const [key, title] of Object.entries(USAGE_SECTIONS) as [
    UsageSection,
    string,
  ][]) {
    const found = headings.filter((h) => h.title === title);
    const [heading, ...rest] = found;
    if (heading === undefined || rest.length > 0) {
      throw new Error(
        `packages/icon/README.md: раздел «${title}» — ${heading === undefined ? "нет" : "не один"}. Его отдаёт ассистентам get_usage MCP-сервера (ADR-0044)`,
      );
    }
    const next = headings.find(
      (h) => h.line > heading.line && h.depth <= heading.depth,
    );
    sections[key] = lines
      .slice(heading.line, next === undefined ? lines.length : next.line - 1)
      .join("\n")
      .trim();
  }
  return { version, install, sections };
}
