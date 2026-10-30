// Тема сайта (ADR-0038): «как в системе» по умолчанию, светлая или тёмная — по выбору в меню шапки.
// Выбор живёт в localStorage браузера, на сервер не уходит. Атрибут data-theme у <html> ставит
// скрипт в <head> ещё до отрисовки — без вспышки (руководство Next.js «Preventing flash before
// hydration»); токены в globals.css переключает color-scheme.

export const THEME_KEY = "iconavo-theme";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const explicit = (value: unknown): value is "light" | "dark" =>
  value === "light" || value === "dark";

/** Скрипт для <head>: выбор из хранилища — в data-theme; хранилище запрещено — тема системы. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** Выбор из хранилища браузера. */
export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return explicit(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** Применить тему к странице: «как в системе» — без атрибута. */
export function applyTheme(theme: Theme, root = document.documentElement) {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/** Хранилище выбора для меню темы; в Storybook тему ставит аддон, и меню получает своё. */
export interface ThemeStore {
  get(): Theme;
  set(theme: Theme): void;
  subscribe(listener: () => void): () => void;
}

const listeners = new Set<() => void>();

export const themeStore: ThemeStore = {
  get() {
    const value = document.documentElement.dataset.theme;
    return explicit(value) ? value : "system";
  },
  set(theme) {
    try {
      if (theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Хранилище запрещено — тема держится до перезагрузки.
    }
    applyTheme(theme);
    for (const listener of listeners) listener();
  },
  subscribe(listener) {
    listeners.add(listener);
    // Выбор в другой вкладке приходит событием storage.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      applyTheme(storedTheme());
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
};
