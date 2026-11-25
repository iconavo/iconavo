// Настройки сетки (панель Settings по макету «Настройки»; решения владельца 23 ноября 2026, ADR-0054): вид
// — мелкая сетка, крупная сетка или список, размер иконки в плитке и иконок на странице. Действуют на
// сетку набора и выдачу поиска, применяются сразу и хранятся в localStorage браузера (iconavo-grid), как
// тема (ADR-0038); на сервер не уходят, выбор в другой вкладке приходит событием storage.
//
// Вид и размер — стилями: скрипт в <head> (GRID_SCRIPT, lib/grid-script.ts) ставит у <html> data-grid-view и --tile-icon до
// первой отрисовки, и серверный HTML сразу встаёт в нужный вид — без мигания и без расхождения с
// гидратацией (разметка плиток у всех видов одна). Колонки у каждого вида свои, от ширины окна
// (--icon-cols, app/globals.css). Число на странице — только в браузере: по умолчанию 48 на телефоне и 96
// на компьютере (заметки макета), страница — целыми рядами, ближе всего к выбранному (pageSizeFor).

import { useEffect, useRef, useSyncExternalStore } from "react";
import { refreshColumns } from "./grid-columns";
import {
  GRID_KEY,
  ICON_SIZE_MAX,
  ICON_SIZE_MIN,
  ICON_SIZE_STEP,
} from "./grid-script";
import { createPanelStore, PHONE, usePanelOpen } from "./panel-store";
import { touchesKey } from "./storage-event";

export {
  GRID_KEY,
  GRID_SCRIPT,
  ICON_SIZE_MAX,
  ICON_SIZE_MIN,
  ICON_SIZE_STEP,
} from "./grid-script";

export const GRID_VIEWS = ["grid", "large", "list"] as const;
export type GridView = (typeof GRID_VIEWS)[number];

export const PER_PAGE_CHOICES = [48, 96, 144, 192] as const;
export type PerPage = (typeof PER_PAGE_CHOICES)[number];

/** Иконок на странице по умолчанию: на телефоне — 48, на компьютере — 96 (заметки макета). */
export const PER_PAGE_PHONE: PerPage = 48;
export const PER_PAGE_DESKTOP: PerPage = 96;

/** Телефон — как раскладка сайта (до 64rem): шторка вместо панели, 48 иконок на странице. */
export { PHONE };

/**
 * Размер иконки по умолчанию у вида, пока ползунок не трогали: мелкая сетка и список — 24 px, как у Icon
 * Card макета; крупная — 48 px. Тронули — одно значение у всех видов. Те же числа — в стилях
 * (--tile-icon-default, app/globals.css).
 */
export const VIEW_ICON_SIZE: Readonly<Record<GridView, number>> = {
  grid: 24,
  large: 48,
  list: 24,
};

export interface GridSettings {
  view: GridView;
  /** Размер иконки в плитке, px; нет — по умолчанию вида. */
  size?: number;
  /** Иконок на странице; нет — по умолчанию устройства. */
  perPage?: PerPage;
}

export const DEFAULT_GRID: GridSettings = { view: "grid" };

export const isGridView = (value: unknown): value is GridView =>
  GRID_VIEWS.includes(value as GridView);

export const isIconSize = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= ICON_SIZE_MIN &&
  value <= ICON_SIZE_MAX &&
  (value - ICON_SIZE_MIN) % ICON_SIZE_STEP === 0;

export const isPerPage = (value: unknown): value is PerPage =>
  PER_PAGE_CHOICES.includes(value as PerPage);

/** Настройки из хранилища: неверные поля отбрасываются, остальное — по умолчанию. */
export function parseGridSettings(raw: string | null): GridSettings {
  if (raw === null) return DEFAULT_GRID;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_GRID;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_GRID;
  const v = value as Record<string, unknown>;
  return {
    view: isGridView(v.view) ? v.view : "grid",
    ...(isIconSize(v.size) ? { size: v.size } : {}),
    ...(isPerPage(v.perPage) ? { perPage: v.perPage } : {}),
  };
}

/** Для хранилища — только то, что отличается от умолчаний; всё по умолчанию — пустая строка. */
export function serializeGridSettings(s: GridSettings): string {
  const out = {
    ...(s.view === "grid" ? {} : { view: s.view }),
    ...(s.size === undefined ? {} : { size: s.size }),
    ...(s.perPage === undefined ? {} : { perPage: s.perPage }),
  };
  return Object.keys(out).length === 0 ? "" : JSON.stringify(out);
}

/** Размер иконки в плитке: выбранный или по умолчанию вида. */
export const iconSizeOf = (s: GridSettings): number =>
  s.size ?? VIEW_ICON_SIZE[s.view];

/** Иконок на странице: выбранное или по умолчанию устройства. */
export const perPageOf = (s: GridSettings, phone: boolean): PerPage =>
  s.perPage ?? (phone ? PER_PAGE_PHONE : PER_PAGE_DESKTOP);

/**
 * Номер страницы после смены числа на ней: та, где окажется первая иконка прежней страницы, — она
 * остаётся на экране.
 */
export const keptPage = (page: number, from: number, to: number): number =>
  Math.floor(((page - 1) * from) / to) + 1;

/** Вид и размер — на <html>: стили переставляют плитки, колонки перечитываются. */
export function applyGrid(
  s: GridSettings,
  root: HTMLElement = document.documentElement,
): void {
  if (s.view === "grid") delete root.dataset.gridView;
  else root.dataset.gridView = s.view;
  if (s.size === undefined) root.style.removeProperty("--tile-icon");
  else root.style.setProperty("--tile-icon", `${s.size}px`);
  refreshColumns();
}

const listeners = new Set<() => void>();
let current: GridSettings | undefined;

function read(): GridSettings {
  try {
    return parseGridSettings(localStorage.getItem(GRID_KEY));
  } catch {
    return DEFAULT_GRID;
  }
}

function write(next: GridSettings) {
  current = next;
  try {
    const raw = serializeGridSettings(next);
    if (raw === "") localStorage.removeItem(GRID_KEY);
    else localStorage.setItem(GRID_KEY, raw);
  } catch {
    // Хранилище запрещено — настройки держатся до перезагрузки.
  }
  applyGrid(next);
  for (const listener of listeners) listener();
}

export const gridStore = {
  get(): GridSettings {
    current ??= read();
    return current;
  },
  set(next: GridSettings) {
    write(next);
  },
  /** Reset Settings: всё по умолчанию. */
  reset() {
    write(DEFAULT_GRID);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (!touchesKey(event.key, GRID_KEY)) return;
      current = read();
      applyGrid(current);
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
};

/** Настройки после гидратации; на сервере и при гидратации — по умолчанию. */
export function useGridSettings(): GridSettings {
  return useSyncExternalStore(
    gridStore.subscribe,
    gridStore.get,
    () => DEFAULT_GRID,
  );
}

function subscribePhone(listener: () => void): () => void {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Раскладка телефона; на сервере и при гидратации — компьютер. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

/** Иконок на странице для этой вкладки. */
export function usePerPage(): PerPage {
  return perPageOf(useGridSettings(), usePhone());
}

/** Что было на экране: число на странице из настроек, размер страницы целыми рядами и её номер. */
export interface ShownPage {
  perPage: number;
  size: number;
  page: number;
}

/**
 * Куда перейти после смены числа на странице: туда, где первая иконка страницы, которую человек видел.
 * Номер — от показанной страницы, а не от новой: с поздней страницы при большем числе номер в адресе уже
 * за последней, и новая отрисовка видит первую (ревизия фазы 5, С-7). Смена колонок (окно, вид) номер не
 * трогает; undefined — переходить некуда.
 */
export function keptPageAfter(
  was: ShownPage | undefined,
  now: ShownPage,
): number | undefined {
  if (was === undefined || was.perPage === now.perPage) return undefined;
  const next = keptPage(was.page, was.size, now.size);
  return next === now.page ? undefined : next;
}

/**
 * Сменили число иконок на странице — номер страницы в адресе такой, чтобы её первая иконка осталась на
 * экране (keptPageAfter).
 */
export function useKeptPage(
  perPage: number,
  size: number | undefined,
  page: number,
  go: (page: number) => void,
): void {
  const before = useRef<ShownPage>(undefined);
  useEffect(() => {
    if (size === undefined) return;
    const now = { perPage, size, page };
    const next = keptPageAfter(before.current, now);
    before.current = now;
    if (next !== undefined) go(next);
  }, [perPage, size, page, go]);
}

// Панель настроек: одна на страницу (components/settings/SettingsPanel.tsx), её открывают кнопки Settings
// в строке поиска набора и выдачи. Рядом с рюкзаком открытой бывает только одна (lib/panel-store.ts).
export const settingsPanelStore = createPanelStore();

/** Открыта ли панель настроек; на сервере — закрыта. */
export function useSettingsPanel(): boolean {
  return usePanelOpen(settingsPanelStore);
}
