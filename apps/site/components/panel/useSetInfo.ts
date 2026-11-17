"use client";

import { useEffect, useState } from "react";
import { getSets, type SetInfo } from "../../lib/catalog";
// Хосты API — для ядра браузера и каталога (lib/iconavo.ts).
import "../../lib/iconavo";

/**
 * Сведения о наборе для панели: название, автор, лицензия, цветной ли он — из каталога наборов
 * (/collections edge API, память вкладки). Поиск для этого не нужен: панель работает и без
 * Meilisearch. До ответа — undefined.
 */
export function useSetInfo(prefix: string): SetInfo | undefined {
  const [sets, setSets] = useState<Record<string, SetInfo>>();
  useEffect(() => {
    let live = true;
    getSets().then(
      (all) => {
        if (live) setSets(all);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return sets?.[prefix];
}
