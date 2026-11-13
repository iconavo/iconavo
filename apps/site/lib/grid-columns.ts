// Колонки сетки не зависят от панели иконки (решение владельца 13 ноября 2026): с открытой панелью
// сетка держит столько колонок, сколько у неё было бы во всю ширину, — карточки сужаются и сдвигаются,
// но не перескакивают в другие ряды. Сколько это, считает сам браузер: рядом с сеткой лежит пустой
// «пробник» с теми же правилами колонок во всю ширину раскладки (.grid-probe, app/globals.css), его
// колонки и есть ответ. Число записывается на раскладку (.with-panel: --cols и data-cols) — по нему
// стиль сетки с открытой панелью — и отдаётся странице: по нему число иконок на странице
// (pageSizeFor, lib/catalog.ts).

import { useEffect, useRef, useState } from "react";

/** Пробники колонок на странице. */
export const PROBES = ".grid-probe";

/** Колонок у пробника: дорожки вычисленного grid-template-columns. */
export function probeColumns(probe: HTMLElement): number {
  const tracks = getComputedStyle(probe).gridTemplateColumns.trim();
  return tracks === "" || tracks === "none" ? 1 : tracks.split(/\s+/).length;
}

/** Записать колонки пробника на его раскладку и вернуть их. */
export function syncColumns(probe: HTMLElement): number {
  const columns = probeColumns(probe);
  const layout = probe.parentElement;
  if (layout !== null && layout.dataset.cols !== String(columns)) {
    layout.style.setProperty("--cols", String(columns));
    layout.dataset.cols = String(columns);
  }
  return columns;
}

/**
 * Колонки сетки во всю ширину: probe — ref пробника, columns — после первого замера в браузере (на
 * сервере и при гидратации — undefined). Меняются с шириной окна и при сворачивании боковой панели.
 */
export function useGridColumns() {
  const probe = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number>();
  useEffect(() => {
    const element = probe.current;
    if (element === null) return;
    const update = () => setColumns(syncColumns(element));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { probe, columns };
}
