"use client";

import { useEffect, useState } from "react";
import { getSets, type PanelSet, type SetInfo } from "../../lib/catalog";
// Хосты API — для ядра браузера и каталога (lib/iconavo.ts).
import "../../lib/iconavo";

/**
 * Сведения о наборе для панели: название, автор, лицензия, цветной ли он. Страница отдаёт их сама
 * (known) — тогда они есть сразу, в первой же отрисовке панели. Иначе — из каталога наборов
 * (/collections edge API, память вкладки), до ответа — undefined. Поиск для этого не нужен: панель
 * работает и без Meilisearch.
 */
export function useSetInfo(
  prefix: string,
  known?: PanelSet,
): PanelSet | undefined {
  const [sets, setSets] = useState<Record<string, SetInfo>>();
  const asked = known === undefined;
  useEffect(() => {
    if (!asked) return;
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
  }, [asked]);
  return known ?? sets?.[prefix];
}
