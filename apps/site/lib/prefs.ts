// Выбор в генераторе кода (шаг 5 фазы 4, ADR-0042): вид кода и менеджер пакетов запоминаются в
// localStorage браузера, как тема (ADR-0038), и на сервер не уходят. На сервере и при гидратации —
// значение по умолчанию, выбор из хранилища — после гидратации; выбор в другой вкладке приходит
// событием storage.

import { useSyncExternalStore } from "react";
import { CODE_KINDS, type CodeKind } from "./code";
import { PACKAGE_MANAGERS, type PackageManager } from "./install";

export interface ChoiceStore<T extends string> {
  readonly fallback: T;
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

/** Значение из хранилища, если оно из списка; иначе — по умолчанию. */
export function readChoice<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function choiceStore<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): ChoiceStore<T> {
  const listeners = new Set<() => void>();
  let current: T | undefined;
  const read = (): T => {
    try {
      return readChoice(localStorage.getItem(key), allowed, fallback);
    } catch {
      return fallback;
    }
  };
  return {
    fallback,
    get() {
      current ??= read();
      return current;
    },
    set(value) {
      current = value;
      try {
        localStorage.setItem(key, value);
      } catch {
        // Хранилище запрещено — выбор держится до перезагрузки.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key) return;
        current = read();
        listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

export const CODE_KEY = "iconavo-code";
export const PM_KEY = "iconavo-pm";

export const codeStore = choiceStore<CodeKind>(CODE_KEY, CODE_KINDS, "tag");
export const pmStore = choiceStore<PackageManager>(
  PM_KEY,
  PACKAGE_MANAGERS,
  "npm",
);

/** Выбор после гидратации; на сервере — по умолчанию. */
export function useChoice<T extends string>(store: ChoiceStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, () => store.fallback);
}
