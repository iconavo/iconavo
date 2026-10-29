import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Block,
  MarkdownError,
  parseMarkdown,
  plainText,
} from "./markdown";

const root = join(import.meta.dirname, "..", "..", "..");

describe("разбор Markdown", () => {
  it("заголовки, абзацы и строка с кодом, жирным и ссылкой", () => {
    const blocks = parseMarkdown(
      "# Title\n\nSome **bold `code`** and [a link](https://example.com).\nNext line.\n",
    );
    expect(blocks[0]).toMatchObject({ type: "heading", depth: 1, line: 1 });
    expect(blocks[1]).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "Some " },
        {
          type: "strong",
          children: [
            { type: "text", value: "bold " },
            { type: "code", value: "code" },
          ],
        },
        { type: "text", value: " and " },
        {
          type: "link",
          href: "https://example.com",
          children: [{ type: "text", value: "a link" }],
        },
        { type: "text", value: ". Next line." },
      ],
    });
  });

  it("список: пункт с абзацем, блоком кода и вложенным списком", () => {
    const blocks = parseMarkdown(
      [
        "- **One.** Text:",
        "",
        "  ```",
        "  connect-src a;",
        "  ```",
        "",
        "  After.",
        "- Two",
        "  - Nested",
        "",
        "Paragraph.",
      ].join("\n"),
    );
    expect(blocks).toHaveLength(2);
    const list = blocks[0] as Extract<Block, { type: "list" }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.map((b) => b.type)).toEqual([
      "paragraph",
      "code",
      "paragraph",
    ]);
    expect(list.items[0]?.[1]).toEqual({
      type: "code",
      lang: "",
      value: "connect-src a;",
    });
    expect(list.items[1]?.map((b) => b.type)).toEqual(["paragraph", "list"]);
    expect(blocks[1]?.type).toBe("paragraph");
  });

  it("таблица и экранированная черта в ячейке", () => {
    const [table] = parseMarkdown(
      "| A | B |\n| --- | --- |\n| `x` | a \\| b |\n",
    );
    expect(table).toMatchObject({
      type: "table",
      head: [[{ type: "text", value: "A" }], [{ type: "text", value: "B" }]],
      rows: [
        [[{ type: "code", value: "x" }], [{ type: "text", value: "a | b" }]],
      ],
    });
  });

  it("цитата в один абзац и блок кода с языком", () => {
    const blocks = parseMarkdown(
      "> **Beta.** Text.\n\n```tsx\nconst a = 1;\n```\n",
    );
    expect(blocks.map((b) => b.type)).toEqual(["blockquote", "code"]);
    expect(blocks[1]).toEqual({
      type: "code",
      lang: "tsx",
      value: "const a = 1;",
    });
  });

  it.each([
    ["1. one", "нумерованные списки"],
    ["* one", "список — только"],
    ["<div>x</div>", "HTML"],
    ["Some *emphasis*.", "разметка «*»"],
    ["![alt](a.png)", "картинки"],
    ["See https://example.com here.", "адрес без ссылки"],
    ["A &amp; B", "сущности HTML"],
    ["Text\n===", "подчёркиванием"],
    ["    indented code", "код отступом"],
    ["```python\nx\n```", "язык блока кода"],
    ["```\nnot closed", "не закрыт"],
    ["| A |\n| B |", "без строки |---|"],
    ["Use <iconavo-icon> here.", "HTML в тексте"],
    ["Unclosed `code", "не закрыт"],
  ])("останавливается на неподдерживаемом: %j", (source, message) => {
    expect(() => parseMarkdown(source)).toThrow(MarkdownError);
    expect(() => parseMarkdown(source)).toThrow(message);
  });

  it("сообщение об ошибке называет строку", () => {
    expect(() => parseMarkdown("ok\n\n1. bad")).toThrow("строка 3");
  });

  it("текст без разметки — для якорей", () => {
    const [heading] = parseMarkdown("## `setLoader(prefix, loader)` **x**");
    expect(
      plainText((heading as Extract<Block, { type: "heading" }>).children),
    ).toBe("setLoader(prefix, loader) x");
  });

  it.each(["packages/icon/README.md", "apps/api/README.md"])(
    "%s разбирается целиком",
    (file) => {
      const blocks = parseMarkdown(readFileSync(join(root, file), "utf8"));
      expect(blocks.filter((b) => b.type === "heading").length).toBeGreaterThan(
        5,
      );
    },
  );
});
