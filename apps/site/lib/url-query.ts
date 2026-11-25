"use client";

// Параметры адреса для фильтров и страниц каталога и поиска (шаги 2 и 3 фазы 4): страницы статические,
// поэтому параметры читает браузер после гидратации — первый показ совпадает с серверным HTML. Переход —
// history.pushState или replaceState: Next.js их понимает, кнопки «назад» и «вперёд» возвращают прежнее
// состояние. Несколько компонентов страницы (поле поиска и выдача) узнают о переходе друг друга по
// событию URL_EVENT.

import { useCallback, useEffect, useState } from "react";
import { PANEL_PARAM } from "./icon";
import { usePagePath } from "./page-path";

/** Событие окна после перехода через navigate: его слушают все useUrlQuery страницы. */
export const URL_EVENT = "iconavo:url";

const EMPTY = new URLSearchParams();

/**
 * Пометка записи истории, которую добавило открытие панели иконки (шаг 4 фазы 4): закрытие панели
 * уходит назад только с такой записи — иначе «назад» отменил бы смену фильтра.
 */
interface PanelState {
  iconavoPanel?: string;
}

/** Иконка, открытием которой добавлена текущая запись истории; нет — запись не от панели. */
export function panelMarker(): string | undefined {
  const state = window.history.state as PanelState | null;
  return typeof state?.iconavoPanel === "string"
    ? state.iconavoPanel
    : undefined;
}

/**
 * Строка параметров; двоеточие имени иконки и запятые списков остаются как есть: ?icon=lucide:house,
 * ?set=lucide,ph (страница поиска). В адресе оба знака допустимы без кодирования (RFC 3986).
 */
export const queryText = (next: URLSearchParams): string =>
  next.toString().replaceAll("%3A", ":").replaceAll("%2C", ",");

/**
 * Замена записи сохраняет пометку панели, только если меняется одна иконка панели: набранный при открытой
 * панели поиск по набору или смена фильтра делают запись своей, и закрытие панели уже не уходит назад —
 * иначе «назад» стёр бы набранное (ревизия фазы 5, С-5).
 */
export function keepsPanelMarker(
  current: URLSearchParams,
  next: URLSearchParams,
): boolean {
  const rest = (query: URLSearchParams) => {
    const copy = new URLSearchParams(query);
    copy.delete(PANEL_PARAM);
    copy.sort();
    return copy.toString();
  };
  return rest(current) === rest(next);
}

export interface NavigateOptions {
  /** Заменить запись истории, а не добавить (набор текста, смена иконки в панели). */
  replace?: boolean;
  /**
   * Пометка панели: строка — запись от открытия панели с этой иконкой; null — без пометки. Нет — при
   * замене пометка текущей записи сохраняется, новая запись идёт без неё.
   */
  panel?: string | null;
}

/** Параметры адреса и переход к другим параметрам той же страницы. */
export function useUrlQuery(): {
  query: URLSearchParams;
  /**
   * Параметры прочитаны у этой страницы. До этого query пустой — как в серверном HTML; компонент из
   * общей раскладки после перехода на другую страницу тоже сначала видит пустой.
   */
  ready: boolean;
  /** Адрес ссылки с этими параметрами — для href. */
  hrefOf: (next: URLSearchParams) => string;
  /** Переход; replace — заменить запись истории, а не добавить (набор текста в поле поиска). */
  navigate: (next: URLSearchParams, options?: NavigateOptions) => void;
} {
  const pathname = usePagePath();
  const [read, setRead] = useState<{ path?: string; query: URLSearchParams }>(
    () => ({ query: EMPTY }),
  );
  // Читается и после перехода Next.js на другую страницу: компонент общей раскладки при этом не
  // пересоздаётся, а popstate не приходит. Переход по ссылке на эту же страницу (путь тот же, параметры
  // другие) приносит URL_EVENT от UrlWatch (components/shell/UrlWatch.tsx). Те же параметры — состояние
  // прежнее: лишней отрисовки нет.
  useEffect(() => {
    void pathname;
    const update = () => {
      const path = window.location.pathname;
      const query = new URLSearchParams(window.location.search);
      setRead((was) =>
        was.path === path && was.query.toString() === query.toString()
          ? was
          : { path, query },
      );
    };
    update();
    window.addEventListener("popstate", update);
    window.addEventListener(URL_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(URL_EVENT, update);
    };
  }, [pathname]);
  const ready = read.path === pathname;
  const query = ready ? read.query : EMPTY;
  const hrefOf = useCallback(
    (next: URLSearchParams) => {
      const search = queryText(next);
      return search === "" ? pathname : `${pathname}?${search}`;
    },
    [pathname],
  );
  const navigate = useCallback(
    (next: URLSearchParams, options?: NavigateOptions) => {
      // Своё состояние — новым объектом: в history.state лежит и внутреннее состояние Next.js, его не
      // копируем — Next.js допишет своё сам.
      const marker =
        options?.panel !== undefined
          ? options.panel
          : options?.replace &&
              keepsPanelMarker(
                new URLSearchParams(window.location.search),
                next,
              )
            ? panelMarker()
            : undefined;
      const state: PanelState | null =
        marker === undefined || marker === null
          ? null
          : { iconavoPanel: marker };
      if (options?.replace) {
        window.history.replaceState(state, "", hrefOf(next));
      } else {
        window.history.pushState(state, "", hrefOf(next));
      }
      setRead({ path: pathname, query: new URLSearchParams(next) });
      window.dispatchEvent(new Event(URL_EVENT));
    },
    [hrefOf, pathname],
  );
  return { query, ready, hrefOf, navigate };
}

/** Параметры с изменениями: undefined удаляет параметр. */
export function withParams(
  query: URLSearchParams,
  changes: Record<string, string | undefined>,
): URLSearchParams {
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  }
  return next;
}
