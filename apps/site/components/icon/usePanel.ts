"use client";

// Панель иконки на странице с сеткой (шаг 4 фазы 4; решение владельца 2 ноября 2026): открытая панель —
// в адресе (?icon=набор:иконка), ссылкой можно поделиться.
// - Открытие — новая запись истории с пометкой панели; смена иконки в панели — замена той же записи.
//   Поэтому «назад» закрывает панель целиком.
// - ✕ и Esc уходят назад, только если текущая запись — от открытия панели; иначе (сменили фильтр или
//   открыли ссылку с панелью) убирают icon из адреса заменой.
// - Панель закрылась — фокус к карточке показанной иконки, иначе к той, что открыла панель.

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PANEL_PARAM, panelIcon } from "../../lib/icon";
import {
  type NavigateOptions,
  panelMarker,
  withParams,
} from "../../lib/url-query";
import { plainClick } from "../catalog/Chips";

/** Класс ссылок-карточек сеток: по нему ищется карточка для возврата фокуса. */
export const CARD_LINK = "icon-card-link";

/** Карточка иконки на странице по имени; поиск без селекторов-строк. */
function cardOf(name: string): HTMLElement | undefined {
  for (const el of Array.from(document.getElementsByClassName(CARD_LINK))) {
    if (el instanceof HTMLElement && el.dataset.icon === name) return el;
  }
  return undefined;
}

export interface Panel {
  /** Иконка открытой панели. */
  icon: string | undefined;
  /** Номер открытия — по нему панель переводит фокус на заголовок. */
  focus: number;
  open: (name: string, from?: HTMLElement) => void;
  close: () => void;
  /** Обработчик щелчка по карточке-ссылке: обычный щелчок открывает панель, с Ctrl — страницу. */
  onCardClick: (e: MouseEvent<HTMLAnchorElement>, name: string) => void;
}

export function usePanel(
  query: URLSearchParams,
  navigate: (next: URLSearchParams, options?: NavigateOptions) => void,
): Panel {
  const icon = panelIcon(query);
  const [focus, setFocus] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const last = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (icon !== undefined) {
      last.current = icon;
      return;
    }
    const was = last.current;
    if (was === undefined) return;
    last.current = undefined;
    const target =
      cardOf(was) ?? (opener.current?.isConnected ? opener.current : undefined);
    target?.focus();
    opener.current = null;
  }, [icon]);

  const open = useCallback(
    (name: string, from?: HTMLElement) => {
      const next = withParams(query, { [PANEL_PARAM]: name });
      if (icon === undefined) {
        opener.current = from ?? null;
        navigate(next, { panel: name });
        setFocus((n) => n + 1);
      } else if (name !== icon) {
        navigate(next, { replace: true });
      }
    },
    [query, icon, navigate],
  );

  const close = useCallback(() => {
    if (panelMarker() !== undefined) {
      window.history.back();
      return;
    }
    navigate(withParams(query, { [PANEL_PARAM]: undefined }), {
      replace: true,
      panel: null,
    });
  }, [query, navigate]);

  const onCardClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, name: string) => {
      if (!plainClick(e)) return;
      e.preventDefault();
      open(name, e.currentTarget);
    },
    [open],
  );

  return { icon, focus, open, close, onCardClick };
}
