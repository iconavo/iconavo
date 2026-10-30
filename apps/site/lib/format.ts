// Числа, даты и формы слов на языке страницы. Считаются на сервере при сборке, время — по UTC: вывод
// одинаков на любой машине. В клиентские компоненты попадают готовые строки — браузер с другой версией
// данных Intl не разойдётся с серверным HTML.

import type { Lang } from "./i18n";

const LOCALES: Record<Lang, string> = { en: "en-US", ru: "ru-RU" };

/** 1998 → «1,998» и «1 998». */
export const formatNumber = (lang: Lang, n: number) =>
  new Intl.NumberFormat(LOCALES[lang]).format(n);

/** Дата выпуска: «October 30, 2026», «30 октября 2026 г.». */
export const formatDate = (lang: Lang, iso: string) =>
  new Intl.DateTimeFormat(LOCALES[lang], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));

/** Формы слова по числу: en — one/other, ru — one/few/many. */
export type Forms = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string;
};

/** Число и слово в нужной форме: «1,998 icons», «1 998 иконок». */
export function countOf(lang: Lang, n: number, forms: Forms): string {
  const rule = new Intl.PluralRules(LOCALES[lang]).select(n);
  return `${formatNumber(lang, n)} ${forms[rule] ?? forms.other}`;
}

/** Слово «иконка» по языку. */
export const ICON_FORMS: Record<Lang, Forms> = {
  en: { one: "icon", other: "icons" },
  ru: { one: "иконка", few: "иконки", many: "иконок", other: "иконки" },
};
