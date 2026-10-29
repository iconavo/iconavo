import { CopyButton } from "./CopyButton";

// Блок кода: подпись языка, кнопка «Copy» и сам код. Подсветки пока нет: цвета — часть визуального
// дизайна, фаза 6 (ADR-0050).

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
    <figure className="code">
      <figcaption className="code-bar">
        <span className="code-lang">{title}</span>
        <CopyButton text={value} />
      </figcaption>
      {/* Длинная строка прокручивается внутри блока — его можно прокрутить и с клавиатуры. */}
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: область прокрутки должна получать фокус (WCAG 2.1.1)
        tabIndex={0}
      >
        <code>{value}</code>
      </pre>
    </figure>
  );
}
