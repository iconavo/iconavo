import { useSyncExternalStore } from "react";

// Шторка фильтра страницы поиска на телефоне (редизайн, сценарий «Фильтр по семействам» макета): одна на
// страницу, её открывает кнопка с ползунками в строке инструментов. Открыта ли и сколько выбрано — только
// в памяти вкладки: число пишет выдача (SearchResults) по фильтрам из адреса, кнопка его показывает.
let open = false;
let opener: HTMLElement | null = null;
let count = 0;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export const filterSheetStore = {
  get: (): boolean => open,
  /** Сколько выбрано в фильтрах выдачи — для счётчика на кнопке (заметка макета). */
  count: (): number => count,
  /** Открыть или закрыть; from — кнопка, которой вернуть фокус после закрытия (как у рюкзака). */
  set(next: boolean, from?: HTMLElement) {
    if (from !== undefined) opener = from;
    if (next === open) return;
    open = next;
    notify();
  },
  setCount(next: number) {
    if (next === count) return;
    count = next;
    notify();
  },
  /** Кнопка, которая открыла шторку, — забирается один раз. */
  takeOpener(): HTMLElement | null {
    const el = opener;
    opener = null;
    return el;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Открыта ли шторка фильтра; на сервере — закрыта. */
export function useFilterSheet(): boolean {
  return useSyncExternalStore(
    filterSheetStore.subscribe,
    filterSheetStore.get,
    () => false,
  );
}

/** Сколько выбрано в фильтрах; на сервере — ничего. */
export function useFilterCount(): number {
  return useSyncExternalStore(
    filterSheetStore.subscribe,
    filterSheetStore.count,
    () => 0,
  );
}
