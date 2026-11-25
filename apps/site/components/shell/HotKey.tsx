"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isSearchHotKey } from "../../lib/hotkey";
import { href, type Lang } from "../../lib/i18n";
import { handOff } from "../../lib/search-handoff";

/** Поле поиска главной и /search (SearchHero). */
export const SEARCH_INPUT_ID = "hero-search";

/**
 * Ctrl K (на Mac — ⌘K), как подсказано у поля поиска в макете: есть поле на странице — фокус на нём,
 * нет — переход на страницу поиска, где поле получит фокус само.
 */
export function HotKey({ lang }: { lang: Lang }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchHotKey(e)) return;
      e.preventDefault();
      const input = document.getElementById(SEARCH_INPUT_ID);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      } else {
        // Пустая передача: большое поле страницы поиска возьмёт фокус само (lib/search-handoff).
        handOff("");
        router.push(href(lang, "/search"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lang, router]);
  return null;
}
