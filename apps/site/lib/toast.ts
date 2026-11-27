// Всплывающее сообщение (кадр «L2 · Log Out / Logged Out» макета): одно на страницу, справа сверху под
// верхней полосой, само уходит через 5 секунд; ✕ — сразу. Отмены у выхода нет (решение владельца
// 27 ноября 2026): выход происходит сразу — так безопаснее на чужом компьютере.

import { useSyncExternalStore } from "react";

export interface Toast {
  text: string;
  /** Новое сообщение — новое число: таймер начинается заново. */
  serial: number;
}

/** Сколько сообщение на экране. */
export const TOAST_MS = 5_000;

let current: Toast | null = null;
let serial = 0;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

export const toastStore = {
  get: (): Toast | null => current,
  show(text: string) {
    serial += 1;
    current = { text, serial };
    notify();
  },
  hide(which?: number) {
    if (current === null || (which !== undefined && current.serial !== which))
      return;
    current = null;
    notify();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useToast = (): Toast | null =>
  useSyncExternalStore(toastStore.subscribe, toastStore.get, () => null);
