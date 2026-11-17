// Свёрнутая боковая панель (макет «Icon Sets / Sidebar Collapsed»): выбор живёт в localStorage браузера,
// как тема (lib/theme.ts). Атрибут data-sidebar у <html> ставит скрипт в <head> до отрисовки — без
// прыжка ширины колонки; стили — в globals.css.

export const SIDEBAR_KEY = "iconavo-sidebar";

/** Скрипт для <head>: свёрнута — data-sidebar="collapsed"; хранилище запрещено — развёрнута. */
export const SIDEBAR_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_KEY)})==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;

/** Свёрнута ли панель по выбору из хранилища. */
export function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Показать выбор на странице и запомнить его. */
export function setCollapsed(
  collapsed: boolean,
  root = document.documentElement,
) {
  if (collapsed) root.dataset.sidebar = "collapsed";
  else delete root.dataset.sidebar;
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_KEY, "collapsed");
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    // Хранилище запрещено — выбор держится до перезагрузки.
  }
}
