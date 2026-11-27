// Всплывающее сообщение (кадр «L2 · Log Out / Logged Out» макета): одно на страницу, справа сверху под
// верхней полосой, само уходит через 5 секунд; ✕ — сразу. «Undo» — только там, где отмена честная
// (решение владельца 27 ноября 2026): фото, имя и письма в кабинете; у выхода, почты, пароля, Google и
// удаления его нет.

import { useSyncExternalStore } from "react";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  text: string;
  /** «Undo» — где отмена честная. */
  action?: ToastAction;
  /** Успех — галочка вместо значка «i» (кадр K3 «Thanks! We got your report»). */
  tone?: "success";
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
  show(text: string, action?: ToastAction, tone?: "success") {
    serial += 1;
    current = {
      text,
      serial,
      ...(action === undefined ? {} : { action }),
      ...(tone === undefined ? {} : { tone }),
    };
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
