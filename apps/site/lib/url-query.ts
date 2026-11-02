"use client";

// Параметры адреса для фильтров и страниц каталога и поиска (шаги 2 и 3 фазы 4): страницы статические,
// поэтому параметры читает браузер после гидратации — первый показ совпадает с серверным HTML. Переход —
// history.pushState или replaceState: Next.js их понимает, кнопки «назад» и «вперёд» возвращают прежнее
// состояние. Несколько компонентов страницы (поле поиска и выдача) узнают о переходе друг друга по
// событию URL_EVENT.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** Событие окна после перехода через navigate: его слушают все useUrlQuery страницы. */
export const URL_EVENT = "iconavo:url";

const EMPTY = new URLSearchParams();

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
  navigate: (next: URLSearchParams, options?: { replace?: boolean }) => void;
} {
  const pathname = usePathname();
  const [read, setRead] = useState<{ path?: string; query: URLSearchParams }>(
    () => ({ query: EMPTY }),
  );
  // Читается и после перехода Next.js на другую страницу: компонент общей раскладки при этом не
  // пересоздаётся, а popstate не приходит.
  useEffect(() => {
    void pathname;
    const update = () =>
      setRead({
        path: window.location.pathname,
        query: new URLSearchParams(window.location.search),
      });
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
      const search = next.toString();
      return search === "" ? pathname : `${pathname}?${search}`;
    },
    [pathname],
  );
  const navigate = useCallback(
    (next: URLSearchParams, options?: { replace?: boolean }) => {
      if (options?.replace) {
        window.history.replaceState(null, "", hrefOf(next));
      } else {
        window.history.pushState(null, "", hrefOf(next));
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
