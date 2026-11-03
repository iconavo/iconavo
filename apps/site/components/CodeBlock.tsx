import { cn } from "../lib/cn";
import { CopyButton } from "./CopyButton";

// Блок кода: подпись языка, кнопка «Copy» и сам код. Подсветки пока нет: цвета — часть визуального
// дизайна, фаза 6 (ADR-0050). Генератор кода в панели иконки (шаг 5 фазы 4) даёт свою подпись,
// подписи кнопки на языке страницы, метку аналитики и узкий вид — с переносом длинных строк.

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

export function CodeBlock({
  lang,
  value,
  title,
  labels,
  onCopied,
  wrap = false,
  snippet,
}: {
  lang: string;
  value: string;
  title?: string;
  labels?: { copy: string; copied: string };
  onCopied?: () => void;
  /** Длинные строки переносятся, а не прокручиваются: узкая панель иконки. */
  wrap?: boolean;
  /** Что в блоке — для проверки сайта: data-snippet. */
  snippet?: string;
}) {
  return (
    <figure
      className={cn("code", wrap && "code-wrap")}
      {...(snippet === undefined ? {} : { "data-snippet": snippet })}
    >
      <figcaption className="code-bar">
        <span className="code-lang">
          {title ?? LANGUAGE_TITLES[lang] ?? lang}
        </span>
        <CopyButton
          text={value}
          {...(labels === undefined ? {} : { labels })}
          {...(onCopied === undefined ? {} : { onCopied })}
        />
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
