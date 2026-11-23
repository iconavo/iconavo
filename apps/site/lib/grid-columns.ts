// Колонки сетки набора — только от ширины окна (решение владельца 13 ноября 2026): их задаёт таблица
// стилей, --icon-cols у <html> (app/globals.css), и ни боковая панель, ни панель иконки их не меняют.
// Отсюда — число иконок на странице (pageSizeFor, lib/catalog.ts). На сервере и при гидратации колонки
// неизвестны (undefined); после — читаются из стилей и обновляются при изменении размера окна и вида сетки.

import { useSyncExternalStore } from "react";

/** Колонок сетки набора по стилям страницы; нет числа — undefined. */
export function readColumns(): number | undefined {
  const value = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue("--icon-cols"),
    10,
  );
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

let current: number | undefined;
const listeners = new Set<() => void>();

function onResize() {
  const next = readColumns();
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  // Пока подписчиков не было, окно могло поменяться: число — заново.
  current = readColumns();
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("resize", onResize);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("resize", onResize);
  };
}

/**
 * Колонки зависят и от вида сетки (data-grid-view у <html>, lib/grid-settings.ts): после его смены число
 * перечитывается, и подписчики узнают новое.
 */
export function refreshColumns(): void {
  onResize();
}

function getSnapshot(): number | undefined {
  current ??= readColumns();
  return current;
}

/** Колонок сетки набора; на сервере и при гидратации — undefined. */
export function useGridColumns(): number | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
