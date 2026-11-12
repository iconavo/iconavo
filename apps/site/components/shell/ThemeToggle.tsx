"use client";

import { Icon } from "@iconavo-ui/react";
import { useSyncExternalStore } from "react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import {
  isDark,
  subscribeScheme,
  type ThemeStore,
  themeStore,
} from "../../lib/theme";

/**
 * Кнопка темы в верхней полосе — одна, как в макете (решение владельца 12 ноября 2026): переключает
 * светлую и тёмную. До первого щелчка тема — как в системе (ADR-0038), выбор живёт в хранилище браузера
 * (lib/theme.ts). Иконку выбирает CSS по теме на экране (globals.css): серверный HTML один для всех, а
 * aria-pressed — из хранилища после гидратации.
 */
export function ThemeToggle({
  lang,
  store = themeStore,
}: {
  lang: Lang;
  store?: ThemeStore;
}) {
  const t = DICTIONARIES[lang];
  const dark = useSyncExternalStore(
    (listener) => {
      const offStore = store.subscribe(listener);
      const offScheme = subscribeScheme(listener);
      return () => {
        offStore();
        offScheme();
      };
    },
    () => isDark(),
    () => false,
  );
  return (
    <button
      type="button"
      className="top-circle theme-toggle"
      aria-label={t.themeToggle}
      aria-pressed={dark}
      onClick={() => store.set(isDark() ? "light" : "dark")}
    >
      <Icon icon="lucide:moon" className="theme-icon theme-icon-dark" />
      <Icon icon="lucide:sun" className="theme-icon theme-icon-light" />
    </button>
  );
}
