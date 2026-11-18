// Рисунок иконки, который в браузере уже есть, — для панели иконки (18 ноября 2026). Панель рисуется
// сразу целиком: код SVG и поле толщины линии не ждут ответа edge API, когда рисунок уже пришёл со
// страницей (IconavoProvider в ядро его не пишет, ADR-0033) или его загрузила сетка.

import { getIcon, type IconData, iconData } from "@iconavo-ui/core/internal";
import type { IconavoIconSet } from "@iconavo-ui/react";
import { splitName } from "./code";

/**
 * Рисунок без запроса: из иконок страницы (sets — данные IconavoProvider), иначе из хранилища ядра. Нет
 * нигде — undefined: рисунок спросит ядро.
 */
export function knownIconData(
  name: string,
  sets: readonly IconavoIconSet[],
): IconData | undefined {
  const [prefix, bare] = splitName(name);
  for (const set of sets) {
    if (set.prefix !== prefix) continue;
    try {
      const icon = iconData(set, bare);
      if (typeof icon?.body === "string") return icon;
    } catch {
      // Сломанная цепочка алиасов в данных страницы — как «нет в них»: ответит ядро.
    }
  }
  const state = getIcon(name);
  return typeof state === "object" ? state : undefined;
}
