// Форматы имени иконки для копирования (шаг 5 фазы 4, решения владельца 3 ноября 2026) — как у Iconify:
// список рядом с именем и отдельная кнопка «Копировать имя». По умолчанию — набор/иконка (lucide/house):
// так дизайнеры называют компоненты в Figma. Имена наборов и иконок у нас те же, что у Iconify
// (ADR-0001), поэтому форматы его инструментов — Tailwind CSS, UnoCSS, имя компонента — тоже работают.

export const NAME_FORMATS = [
  "path",
  "iconify",
  "component",
  "tailwind",
  "unocss",
  "unocssDash",
  "bare",
  "cssClass",
] as const;
export type NameFormat = (typeof NAME_FORMATS)[number];

export const DEFAULT_NAME_FORMAT: NameFormat = "path";

/** lucide-house → LucideHouse: каждая часть с большой буквы. */
const pascal = (text: string) =>
  text
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/** Имя `набор:иконка` в формате. */
export function formatName(name: string, format: NameFormat): string {
  const i = name.indexOf(":");
  const set = name.slice(0, i);
  const icon = name.slice(i + 1);
  switch (format) {
    case "path":
      return `${set}/${icon}`;
    case "iconify":
      return name;
    case "component":
      return pascal(`${set}-${icon}`);
    case "tailwind":
      return `icon-[${set}--${icon}]`;
    case "unocss":
      return `i-${set}:${icon}`;
    case "unocssDash":
      return `i-${set}-${icon}`;
    case "bare":
      return icon;
    case "cssClass":
      return `${set}--${icon}`;
  }
}
