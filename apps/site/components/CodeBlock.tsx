import { PanelCopy } from "./panel/parts";

// Блок кода документации — в виде блока кода панели иконки (Icon Panel/Code Block: подпись, Copy и код;
// решение владельца 23 ноября 2026 — документация в стиле сайта). Отличие одно: длинные строки не
// переносятся, а прокручиваются внутри блока — в примерах важны отступы. Подсветки пока нет: цвета —
// часть визуального дизайна, фаза 6 (ADR-0050).

const LANGUAGE_TITLES: Record<string, string> = {
  html: "HTML",
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  sh: "Shell",
  json: "JSON",
  css: "CSS",
  "": "Text",
};

export function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const title = LANGUAGE_TITLES[lang] ?? lang;
  return (
    <figure className="code-block docs-code">
      <figcaption className="code-block-head">
        <span className="code-block-label">{title}</span>
        <span className="code-block-actions">
          <PanelCopy lang="en" text={value} what={title} />
        </span>
      </figcaption>
      {/* Длинная строка прокручивается внутри блока — его можно прокрутить и с клавиатуры. */}
      <pre
        className="code-block-code"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: область прокрутки должна получать фокус (WCAG 2.1.1)
        tabIndex={0}
      >
        <code>{value}</code>
      </pre>
    </figure>
  );
}
