"use client";

import { Icon } from "@iconavo-ui/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { DICTIONARIES, href, type Lang } from "../lib/i18n";
import { QUERY_MAX_LENGTH, TYPING_PAUSE_MS } from "../lib/search";
import { handOff } from "../lib/search-handoff";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Поле поиска в шапке (шаг 3 фазы 4): по мере ввода — после паузы 150 мс открывается /search, текст и
 * фокус подхватывает большое поле страницы (решение владельца). На главной и в поиске поля в шапке нет:
 * там своё большое поле. Без JavaScript — обычная форма на /search.
 */
export function SearchField({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const router = useRouter();
  const pathname = usePathname();
  const searchPath = href(lang, "/search");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const composing = useRef(false);
  const going = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Шапка живёт в корневой раскладке и переживает переходы: на новой странице поле снова ищет.
  useEffect(() => {
    void pathname;
    going.current = false;
  }, [pathname]);
  if (pathname === href(lang, "/") || pathname === searchPath) return null;

  const open = (text: string) => {
    clearTimeout(timer.current);
    const q = text.trim();
    handOff(text);
    if (q === "" || going.current) return;
    going.current = true;
    router.push(`${searchPath}?${new URLSearchParams({ q })}`, {
      scroll: false,
    });
  };

  return (
    // <search> — ориентир «поиск» для скринридеров (HTML, есть во всех браузерах из ADR-0034).
    <search className="header-search">
      <form
        action={searchPath}
        className="header-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          open(new FormData(e.currentTarget).get("q")?.toString() ?? "");
        }}
      >
        <label htmlFor="site-search" className="sr-only">
          {t.searchLabel}
        </label>
        <Input
          id="site-search"
          type="search"
          name="q"
          maxLength={QUERY_MAX_LENGTH}
          placeholder={t.searchPlaceholder}
          autoComplete="off"
          onChange={(e) => {
            const text = e.target.value;
            // Пока страница поиска открывается, допечатанное тоже уходит туда.
            if (going.current) handOff(text);
            clearTimeout(timer.current);
            if (composing.current) return;
            timer.current = setTimeout(() => open(text), TYPING_PAUSE_MS);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            const text = e.currentTarget.value;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => open(text), TYPING_PAUSE_MS);
          }}
          onFocus={() => router.prefetch(searchPath)}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-label={t.searchSubmit}
        >
          <Icon icon="lucide:search" />
        </Button>
      </form>
    </search>
  );
}
