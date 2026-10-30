"use client";

import { Icon } from "@iconavo-ui/react";
import { useSyncExternalStore } from "react";
import { DICTIONARIES, type Lang } from "../lib/i18n";
import { type Theme, type ThemeStore, themeStore } from "../lib/theme";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/**
 * Меню темы в шапке: как в системе, светлая, тёмная. Подпись кнопки постоянная, иконку на ней выбирает
 * CSS по data-theme (globals.css): серверный HTML один для всех, а отмеченный пункт — из хранилища
 * после гидратации.
 */
export function ThemeMenu({
  lang,
  store = themeStore,
  defaultOpen,
}: {
  lang: Lang;
  store?: ThemeStore;
  defaultOpen?: boolean;
}) {
  const t = DICTIONARIES[lang];
  const theme = useSyncExternalStore(
    store.subscribe,
    store.get,
    (): Theme => "system",
  );
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.theme}>
          <Icon
            icon="lucide:monitor"
            className="theme-icon theme-icon-system"
          />
          <Icon icon="lucide:sun" className="theme-icon theme-icon-light" />
          <Icon icon="lucide:moon" className="theme-icon theme-icon-dark" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => store.set(value as Theme)}
        >
          <DropdownMenuRadioItem value="system">
            {t.themeSystem}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            {t.themeLight}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            {t.themeDark}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
