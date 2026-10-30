"use client";

// Параметры адреса для фильтров и страниц каталога (шаг 2 фазы 4): страницы статические, поэтому
// параметры читает браузер после гидратации — первый показ совпадает с серверным HTML. Переход —
// history.pushState: Next.js его понимает, кнопки «назад» и «вперёд» возвращают прежнее состояние.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** Параметры адреса и переход к другим параметрам той же страницы. */
export function useUrlQuery(): {
  query: URLSearchParams;
  /** Адрес ссылки с этими параметрами — для href. */
  hrefOf: (next: URLSearchParams) => string;
  navigate: (next: URLSearchParams) => void;
} {
  const pathname = usePathname();
  const [query, setQuery] = useState(() => new URLSearchParams());
  useEffect(() => {
    const read = () => setQuery(new URLSearchParams(window.location.search));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const hrefOf = useCallback(
    (next: URLSearchParams) => {
      const search = next.toString();
      return search === "" ? pathname : `${pathname}?${search}`;
    },
    [pathname],
  );
  const navigate = useCallback(
    (next: URLSearchParams) => {
      window.history.pushState(null, "", hrefOf(next));
      setQuery(new URLSearchParams(next));
    },
    [hrefOf],
  );
  return { query, hrefOf, navigate };
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
