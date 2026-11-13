// Выбор в генераторе кода (шаг 5 фазы 4, ADR-0042): вид кода, менеджер пакетов и формат копируемого имени
// запоминаются в localStorage браузера, как тема (ADR-0038), и на сервер не уходят. На сервере и при гидратации —
// значение по умолчанию, выбор из хранилища — после гидратации; выбор в другой вкладке приходит
// событием storage.

import { useSyncExternalStore } from "react";
import { CODE_KINDS, type CodeKind } from "./code";
import {
  COPY_FORMATS,
  type CopyFormat,
  PREVIEW_BGS,
  PREVIEW_GRIDS,
  type PreviewBg,
  type PreviewGrid,
} from "./icon-page";
import { PACKAGE_MANAGERS, type PackageManager } from "./install";
import { DEFAULT_NAME_FORMAT, NAME_FORMATS, type NameFormat } from "./names";
import {
  DEFAULT_SVG_OPTIONS,
  DEFAULT_VIEW,
  PANEL_VIEWS,
  type PanelView,
  SVG_OPTION_VALUES,
  type SvgOptionsValue,
} from "./panel-code";

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
export const NAME_KEY = "iconavo-name";

export const codeStore = choiceStore<CodeKind>(CODE_KEY, CODE_KINDS, "tag");
export const pmStore = choiceStore<PackageManager>(
  PM_KEY,
  PACKAGE_MANAGERS,
  "npm",
);
/** Формат копируемого имени: по умолчанию набор/иконка (решение владельца 3 ноября 2026). */
export const nameStore = choiceStore<NameFormat>(
  NAME_KEY,
  NAME_FORMATS,
  DEFAULT_NAME_FORMAT,
);

/**
 * Панель иконки по макету «Icon Panel»: вид блока кода (формат и подвкладка) и настройки вывода SVG
 * запоминаются — следующая иконка открывается в том же виде (гайд макета).
 */
export const PANEL_VIEW_KEY = "iconavo-panel-code";
export const SVG_OPTIONS_KEY = "iconavo-svg-options";
export const panelViewStore = choiceStore<PanelView>(
  PANEL_VIEW_KEY,
  PANEL_VIEWS,
  DEFAULT_VIEW,
);
export const svgOptionsStore = choiceStore<SvgOptionsValue>(
  SVG_OPTIONS_KEY,
  SVG_OPTION_VALUES,
  DEFAULT_SVG_OPTIONS,
);

/**
 * Страница иконки по макету (редизайн, шаг 4): формат «Copy as» подставляется в кнопку и запоминается
 * (гайд макета), фон и сетка превью — тоже.
 */
export const COPY_FORMAT_KEY = "iconavo-copy-format";
export const PREVIEW_BG_KEY = "iconavo-preview-bg";
export const PREVIEW_GRID_KEY = "iconavo-preview-grid";
export const copyFormatStore = choiceStore<CopyFormat>(
  COPY_FORMAT_KEY,
  COPY_FORMATS,
  "svg",
);
export const previewBgStore = choiceStore<PreviewBg>(
  PREVIEW_BG_KEY,
  PREVIEW_BGS,
  "auto",
);
export const previewGridStore = choiceStore<PreviewGrid>(
  PREVIEW_GRID_KEY,
  PREVIEW_GRIDS,
  "on",
);

/** Выбор после гидратации; на сервере — по умолчанию. */
export function useChoice<T extends string>(store: ChoiceStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, () => store.fallback);
}
