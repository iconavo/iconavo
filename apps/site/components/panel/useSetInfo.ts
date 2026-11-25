"use client";

import { useEffect, useState } from "react";
import { getSets, type PanelSet, type SetInfo } from "../../lib/catalog";
// Хосты API — для ядра браузера и каталога (lib/iconavo.ts).
import "../../lib/iconavo";

/** Паузы перед повторами после сбоя каталога — как у повторов ядра (RETRIES). */
const RETRY_MS = [1_000, 2_000, 4_000];

/**
 * Сведения о наборе для панели: название, автор, лицензия, цветной ли он. Страница отдаёт их сама
 * (known) — тогда они есть сразу, в первой же отрисовке панели. Иначе — из каталога наборов
 * (/collections edge API, память вкладки), до ответа — undefined. Поиск для этого не нужен: панель
 * работает и без Meilisearch. Сбой каталога — не навсегда: пока панель открыта, он спрашивается снова
 * через паузы RETRY_MS, а иконка другого набора спрашивает его сразу (ревизия фазы 5, С-20).
 */
export function useSetInfo(
  prefix: string,
  known?: PanelSet,
): PanelSet | undefined {
  const [sets, setSets] = useState<Record<string, SetInfo>>();
  const [attempt, setAttempt] = useState(0);
  const asked = known === undefined;
  useEffect(() => {
    void prefix;
    if (!asked || sets !== undefined) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    getSets().then(
      (all) => {
        if (live) setSets(all);
      },
      () => {
        const pause = RETRY_MS[attempt];
        if (live && pause !== undefined) {
          timer = setTimeout(() => setAttempt((n) => n + 1), pause);
        }
      },
    );
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [asked, sets, attempt, prefix]);
  return known ?? sets?.[prefix];
}
