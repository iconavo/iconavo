// biome-ignore-all lint/suspicious/noArrayIndexKey: дерево README статично — узлы не переставляются, и ключ по порядку надёжен
import Link from "next/link";
import type { ReactNode } from "react";
import type { DocBlock } from "../lib/docs";
import type { Block, Inline } from "../lib/markdown";
import { CodeBlock } from "./CodeBlock";

// Страница документации из дерева разбора (lib/markdown.ts): текст — строками React, без вставки HTML.

function inline(list: Inline[]): ReactNode[] {
  return list.map((node, i) => {
    if (node.type === "text") return node.value;
    if (node.type === "code") return <code key={i}>{node.value}</code>;
    if (node.type === "strong") {
      return <strong key={i}>{inline(node.children)}</strong>;
    }
    return node.href.startsWith("/") ? (
      <Link key={i} href={node.href}>
        {inline(node.children)}
      </Link>
    ) : (
      <a key={i} href={node.href}>
        {inline(node.children)}
      </a>
    );
  });
}

/** Пункт списка: один абзац — без <p>, как у GitHub в плотном списке. */
function item(blocks: Block[], key: number): ReactNode {
  const only = blocks[0];
  return (
    <li key={key}>
      {blocks.length === 1 && only?.type === "paragraph"
        ? inline(only.children)
        : blocks.map(block)}
    </li>
  );
}

/** Подпись таблицы для области прокрутки: по заголовкам столбцов. */
const tableLabel = (head: Inline[][]) =>
  `Table: ${head
    .map((cell) => cell.map((n) => ("value" in n ? n.value : "")).join(""))
    .join(", ")}`;

function block(node: DocBlock, i: number): ReactNode {
  switch (node.type) {
    case "heading": {
      const Tag = `h${node.depth}` as "h2" | "h3" | "h4";
      return (
        <Tag key={i} id={node.id}>
          {inline(node.children)}
        </Tag>
      );
    }
    case "paragraph":
      return <p key={i}>{inline(node.children)}</p>;
    case "code":
      return <CodeBlock key={i} lang={node.lang} value={node.value} />;
    case "list":
      return <ul key={i}>{node.items.map(item)}</ul>;
    case "blockquote":
      return <blockquote key={i}>{node.children.map(block)}</blockquote>;
    case "table":
      // Широкая таблица прокручивается внутри своей области — её можно прокрутить и с клавиатуры.
      return (
        <section
          key={i}
          className="table-wrap"
          aria-label={tableLabel(node.head)}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: область прокрутки должна получать фокус (WCAG 2.1.1)
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {node.head.map((cell, k) => (
                  <th key={k}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, k) => (
                    <td key={k}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );
  }
}

export function Markdown({ blocks }: { blocks: DocBlock[] }) {
  return <>{blocks.map(block)}</>;
}
