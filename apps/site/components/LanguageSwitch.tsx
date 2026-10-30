"use client";

import { usePathname } from "next/navigation";
import { counterpart, LANGUAGE_NAMES } from "../lib/i18n";

/**
 * Та же страница на другом языке. Языки — две корневые раскладки Next.js, переход между ними —
 * полная загрузка, поэтому ссылка обычная, не next/link. Адрес без rewrites: usePathname() на сервере
 * и в браузере одинаков (ADR-0037).
 */
export function LanguageSwitch() {
  const other = counterpart(usePathname());
  return (
    <a
      href={other.path}
      hrefLang={other.lang}
      lang={other.lang}
      className="lang-switch"
    >
      {LANGUAGE_NAMES[other.lang]}
    </a>
  );
}
