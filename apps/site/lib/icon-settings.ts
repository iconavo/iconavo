// Настройки превью иконки на сайте (шаг 4 фазы 4, ADR-0041): хранилище вкладки и хук React. Чистые
// части — типы, значения по умолчанию, разбор адреса — в общем модуле packages/snippets (шаг 10 фазы 4,
// ADR-0044): их же берёт MCP-сервер. Адрес читается только после гидратации, поэтому серверный HTML —
// с настройками по умолчанию.

import {
  DEFAULT_SETTINGS,
  type IconSettings,
} from "@iconavo-ui/snippets/settings";
import { useSyncExternalStore } from "react";

export * from "@iconavo-ui/snippets/settings";

// Хранилище вкладки: панель и страница иконки видят одно и то же.
let current: IconSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

export const settingsStore = {
  get: (): IconSettings => current,
  set(next: IconSettings) {
    current = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Настройки вкладки: на сервере и при гидратации — по умолчанию. */
export function useIconSettings(): IconSettings {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.get,
    () => DEFAULT_SETTINGS,
  );
}
