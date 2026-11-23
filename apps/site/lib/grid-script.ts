// Скрипт в <head> для настроек сетки (ADR-0054): вид и размер иконок в плитках ставятся у <html> до первой
// отрисовки, как тема и свёрнутая боковая панель (components/ThemeScript.tsx). Без React: модуль берёт и
// серверная раскладка. Остальное о настройках — lib/grid-settings.ts.

export const GRID_KEY = "iconavo-grid";

/** Размер иконки в плитке, px: ползунок Icon Size. */
export const ICON_SIZE_MIN = 16;
export const ICON_SIZE_MAX = 96;
export const ICON_SIZE_STEP = 4;

/**
 * data-grid-view и --tile-icon у <html> из хранилища. Проверки — те же, что у parseGridSettings: чужое
 * значение в хранилище страницу не меняет.
 */
export const GRID_SCRIPT = `try{var g=JSON.parse(localStorage.getItem(${JSON.stringify(GRID_KEY)})||"{}"),r=document.documentElement;if(g.view==="large"||g.view==="list")r.dataset.gridView=g.view;if(typeof g.size==="number"&&g.size>=${ICON_SIZE_MIN}&&g.size<=${ICON_SIZE_MAX}&&g.size%${ICON_SIZE_STEP}===0)r.style.setProperty("--tile-icon",g.size+"px")}catch(e){}`;
