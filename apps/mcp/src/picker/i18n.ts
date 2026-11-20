// Подписи сетки выбора (ADR-0045): язык — как у чата (locale клиента), русский или английский.

import { STYLE_LABELS } from "@iconavo-ui/snippets/picker";

export type Lang = "en" | "ru";

/** Язык по locale клиента: ru-RU и ru — русский, остальное — английский. */
export const langOf = (locale: string | undefined): Lang =>
  locale?.toLowerCase().startsWith("ru") ? "ru" : "en";

/** 1 иконка, 2 иконки, 5 иконок. */
function ruIcons(n: number): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return `${n} иконка`;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) {
    return `${n} иконки`;
  }
  return `${n} иконок`;
}

export interface Texts {
  styles: (typeof STYLE_LABELS)["en"];
  title: (count: number, query: string) => string;
  searching: (query: string) => string;
  style: string;
  color: string;
  colorHex: string;
  colorAuto: string;
  icons: string;
  select: string;
  hint: string;
  missing: (style: string) => string;
  sending: string;
  sent: string;
  tell: (name: string) => string;
  empty: (query: string) => string;
  error: string;
  cancelled: string;
  fallback: string;
}

export const TEXTS: Record<Lang, Texts> = {
  en: {
    styles: STYLE_LABELS.en,
    title: (count, query) =>
      `${count} ${count === 1 ? "icon" : "icons"} for “${query}”`,
    searching: (query) => `Looking for icons for “${query}”…`,
    style: "Style",
    color: "Color",
    colorHex: "Color, hex",
    colorAuto: "Auto",
    icons: "Icons",
    select: "Select",
    hint: "Choose an icon",
    missing: (style) => `not in the ${style} style`,
    sending: "Sending to the assistant…",
    sent: "Sent to the assistant",
    tell: (name) => `Tell the assistant: “${name}”`,
    empty: (query) =>
      `Nothing found for “${query}”. Ask the assistant to try other words.`,
    error: "The picker could not show the icons.",
    cancelled: "The search was cancelled.",
    fallback: "Tell the assistant the number of the icon you like.",
  },
  ru: {
    styles: STYLE_LABELS.ru,
    title: (count, query) => `${ruIcons(count)} по запросу «${query}»`,
    searching: (query) => `Ищу иконки по запросу «${query}»…`,
    style: "Стиль",
    color: "Цвет",
    colorHex: "Цвет, hex",
    colorAuto: "Авто",
    icons: "Иконки",
    select: "Выбрать",
    hint: "Выберите иконку",
    missing: (style) => `нет в стиле «${style}»`,
    sending: "Отправляю ассистенту…",
    sent: "Отправлено ассистенту",
    tell: (name) => `Скажите ассистенту: «${name}»`,
    empty: (query) =>
      `По запросу «${query}» ничего нет. Попросите ассистента поискать другими словами.`,
    error: "Сетка не смогла показать иконки.",
    cancelled: "Поиск отменён.",
    fallback: "Назовите ассистенту номер понравившейся иконки.",
  },
};
