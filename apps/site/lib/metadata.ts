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
