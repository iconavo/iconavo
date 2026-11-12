"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { href, type Lang } from "../../lib/i18n";

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
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      const input = document.getElementById(SEARCH_INPUT_ID);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      } else {
        router.push(href(lang, "/search"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lang, router]);
  return null;
}
