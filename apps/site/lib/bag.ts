// Сумка (шаг 5 фазы 4, ADR-0042; решения владельца 3 ноября 2026): иконки, собранные для ZIP или
// спрайта. Имена — в localStorage браузера (iconavo-bag) в порядке добавления, не больше 500; на сервер
// они не уходят. Сумка переживает перезагрузку и видна во всех вкладках (событие storage). Чужое или
// неверное имя из хранилища отбрасывается. На сервере и при гидратации сумка пуста — число в шапке
// появляется после гидратации.

import { useSyncExternalStore } from "react";
import { isIconName } from "./icon";

export const BAG_KEY = "iconavo-bag";
export const BAG_LIMIT = 500;

const EMPTY: readonly string[] = [];

/** Сумка из хранилища: только имена по правилу, без повторов, не больше лимита. */
export function parseBag(raw: string | null): readonly string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return EMPTY;
    return [...new Set(value.filter(isIconName))].slice(0, BAG_LIMIT);
  } catch {
    return EMPTY;
  }
}

export type BagChange = "added" | "removed" | "full";

/** Положить или убрать иконку; полная сумка новую не берёт. */
export function toggled(
  bag: readonly string[],
  name: string,
): { bag: readonly string[]; change: BagChange } {
  if (bag.includes(name)) {
    return { bag: bag.filter((n) => n !== name), change: "removed" };
  }
  if (bag.length >= BAG_LIMIT) return { bag, change: "full" };
  return { bag: [...bag, name], change: "added" };
}

let current: readonly string[] | undefined;
const listeners = new Set<() => void>();

function read(): readonly string[] {
  try {
    return parseBag(localStorage.getItem(BAG_KEY));
  } catch {
    return EMPTY;
  }
}

function write(next: readonly string[]) {
  current = next;
  try {
    localStorage.setItem(BAG_KEY, JSON.stringify(next));
  } catch {
    // Хранилище запрещено — сумка держится до перезагрузки.
  }
  for (const listener of listeners) listener();
}

export const bagStore = {
  get(): readonly string[] {
    current ??= read();
    return current;
  },
  toggle(name: string): BagChange {
    const next = toggled(bagStore.get(), name);
    if (next.change !== "full") write(next.bag);
    return next.change;
  },
  remove(name: string) {
    write(bagStore.get().filter((n) => n !== name));
  },
  clear() {
    write(EMPTY);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== BAG_KEY) return;
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

/** Сумка после гидратации; на сервере — пустая. */
export function useBag(): readonly string[] {
  return useSyncExternalStore(bagStore.subscribe, bagStore.get, () => EMPTY);
}
