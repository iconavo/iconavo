"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useSyncExternalStore } from "react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { MENU_BUTTON_ID, MENU_CLOSE_ID, menuStore } from "../../lib/menu";
import { usePagePath } from "../../lib/page-path";

const useOpen = () =>
  useSyncExternalStore(menuStore.subscribe, menuStore.get, () => false);

/** Кнопка меню в верхней полосе телефона: открывает шторку с боковой панелью. */
export function MenuButton({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const open = useOpen();
  return (
    <button
      type="button"
      id={MENU_BUTTON_ID}
      className="topbar-menu"
      aria-label={t.menuOpen}
      aria-expanded={open}
      aria-controls="sidebar"
      onClick={() => menuStore.set(true)}
    >
      <Icon icon="material-symbols:menu" />
    </button>
  );
}

/** Крестик в шапке шторки. */
export function MenuClose({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  return (
    <button
      type="button"
      id={MENU_CLOSE_ID}
      className="sidebar-close"
      aria-label={t.menuClose}
      onClick={() => {
        menuStore.set(false);
        document.getElementById(MENU_BUTTON_ID)?.focus();
      }}
    >
      <Icon icon="material-symbols:close" />
    </button>
  );
}

/**
 * Поведение шторки: открылась — фокус на крестик; Esc и затемнение закрывают её и возвращают фокус на
 * кнопку меню; переход на другую страницу закрывает без возврата фокуса.
 */
export function MenuController() {
  const open = useOpen();
  const pathname = usePagePath();

  useEffect(() => {
    if (pathname !== undefined) menuStore.set(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(MENU_CLOSE_ID)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      menuStore.set(false);
      document.getElementById(MENU_BUTTON_ID)?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    // Затемнение под шторкой: щелчок мимо неё закрывает меню; с клавиатуры его закрывают Esc и крестик.
    <div
      className="app-backdrop"
      aria-hidden="true"
      onClick={() => {
        menuStore.set(false);
        document.getElementById(MENU_BUTTON_ID)?.focus();
      }}
    />
  );
}
