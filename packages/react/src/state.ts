// Что рисует Icon (ADR-0033): на сервере и при гидратации — только данные IconavoProvider, иначе
// разметка сервера и браузера разошлась бы: память сервера общая для всех запросов, и иконка из чужого
// запроса нарисовалась бы на сервере, но не в браузере. После гидратации — общее ядро. Чистые функции:
// их проверяют тесты без React, а useSyncExternalStore получает тот же объект при повторе.

import {
  getIcon,
  type IconData,
  type IconState,
  isValidIconName,
} from "@iconavo-ui/core/internal";

/** Ответ обёртки по имени: иконка, «нет» (not_found) или ничего — имени в её данных нет. */
export type Provided = IconData | "missing" | undefined;

/** Сервер и гидратация: иконка или «нет» обёртки, неверное имя — «нет», остальное — заглушка. */
export const serverState = (name: string, provided: Provided): IconState =>
  provided ?? (isValidIconName(name) ? "loading" : "missing");

/**
 * После гидратации и при отрисовке только в браузере: иконка ядра, иначе обёртки, иначе «нет» обёртки
 * (браузер тем временем переспрашивает имя сам), иначе состояние ядра.
 */
export function clientState(name: string, provided: Provided): IconState {
  const state = getIcon(name);
  return typeof state === "object" || provided === undefined ? state : provided;
}
