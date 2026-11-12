"use client";

import { usePathname } from "next/navigation";
import { counterpart, isTranslated, LANGUAGE_NAMES } from "../lib/i18n";
import { useUrlQuery } from "../lib/url-query";

/**
 * Та же страница на другом языке. Языки — две корневые раскладки Next.js, переход между ними —
 * полная загрузка, поэтому ссылка обычная, не next/link. Адрес без rewrites: usePathname() на сервере
 * и в браузере одинаков (ADR-0037). После гидратации к ссылке добавляются параметры адреса — запрос
 * поиска, фильтры, страница (шаг 3 фазы 4); в серверном HTML их нет, как и у самой страницы.
 *
 * variant="code" — круглая кнопка верхней полосы и подвала по макету: на ней код языка, на который
 * ведёт ссылка (флагов стран в наших наборах нет); имя для скринридера — «Русский (RU)».
 */
export function LanguageSwitch({
  variant = "name",
  className = "lang-switch",
}: {
  variant?: "name" | "code";
  className?: string;
}) {
  const pathname = usePathname();
  const other = counterpart(pathname);
  const { query, ready } = useUrlQuery();
  const search = ready && isTranslated(pathname) ? query.toString() : "";
  const code = other.lang.toUpperCase();
  const name = LANGUAGE_NAMES[other.lang];
  return (
    <a
      href={search === "" ? other.path : `${other.path}?${search}`}
      hrefLang={other.lang}
      lang={other.lang}
      className={className}
      aria-label={variant === "code" ? `${name} (${code})` : undefined}
    >
      {variant === "code" ? code : name}
    </a>
  );
}
