// Строки установки из README тега для генератора кода (шаг 5 фазы 4, ADR-0042, ADR-0050). Модуль
// читают только next.config.ts и Storybook при сборке — в код страниц разбор Markdown не попадает.
// Нужной строки нет или она не одна — «СТОП» сборки с подсказкой, как у разделов документации.

import type { Install } from "./install";
import { type Block, parseMarkdown } from "./markdown";

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
