"use client";

import { counterpart, isTranslated, LANGUAGE_NAMES } from "../lib/i18n";
import { usePagePath } from "../lib/page-path";
import { queryText, useUrlQuery } from "../lib/url-query";
import { FlagLogo } from "./shell/Logos";

/**
 * Та же страница на другом языке. Языки — две корневые раскладки Next.js, переход между ними —
 * полная загрузка, поэтому ссылка обычная, не next/link. Адрес без rewrites: usePagePath() на сервере
 * и в браузере одинаков (ADR-0037, ADR-0039). После гидратации к ссылке добавляются параметры адреса —
 * запрос поиска, фильтры, страница (шаг 3 фазы 4); в серверном HTML их нет, как и у самой страницы.
 *
 * variant="flag" — круглая кнопка верхней полосы и подвала по макету: флаг текущего языка (решение
 * владельца 12 ноября 2026, картинки в public/logos); ссылка ведёт на другой язык, имя для скринридера —
 * «Русский (RU)».
 */
export function LanguageSwitch({
  variant = "name",
  className = "lang-switch",
}: {
  variant?: "name" | "flag";
  className?: string;
}) {
  const pathname = usePagePath();
  const other = counterpart(pathname);
  const { query, ready } = useUrlQuery();
  // Параметры — как в адресе страницы: двоеточие и запятые без %3A и %2C (ревизия фазы 5, С-17).
  const search = ready && isTranslated(pathname) ? queryText(query) : "";
  const code = other.lang.toUpperCase();
  const name = LANGUAGE_NAMES[other.lang];
  return (
    <a
      href={search === "" ? other.path : `${other.path}?${search}`}
      hrefLang={other.lang}
      lang={other.lang}
      className={className}
      aria-label={variant === "flag" ? `${name} (${code})` : undefined}
    >
      {variant === "flag" ? (
        <FlagLogo lang={other.lang === "ru" ? "en" : "ru"} />
      ) : (
        name
      )}
    </a>
  );
}
