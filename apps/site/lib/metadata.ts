import type { Metadata } from "next";
import { INDEXING } from "./headers";
import { DICTIONARIES, type Lang } from "./i18n";

/** Общие метаданные корневой раскладки языка: адрес сайта, заголовки, описание, robots. */
export function siteMetadata(lang: Lang): Metadata {
  return {
    metadataBase: new URL("https://iconavo.dev"),
    title: { default: "Iconavo", template: "%s — Iconavo" },
    description: DICTIONARIES[lang].description,
    // До запуска сайт скрыт от поисковиков (lib/headers.ts).
    robots: INDEXING ? undefined : { index: false, follow: false },
  };
}

/**
 * Страница поиска: заголовок и метка «не индексировать» всегда, и после запуска тоже — у выдачи нет
 * постоянного содержания (ADR-0039).
 */
export function searchMetadata(lang: Lang): Metadata {
  return {
    title: DICTIONARIES[lang].searchTitle,
    robots: { index: false, follow: false },
  };
}

/** Кабинет «Account»: личная страница — не индексируется никогда (шаг 3 фазы 5, PR 4). */
export function accountMetadata(lang: Lang): Metadata {
  return {
    title: DICTIONARIES[lang].accountTitle,
    robots: { index: false, follow: false },
  };
}
