// Прототип «панель во всю высоту страницы» (просьба владельца 13 ноября 2026 — сравнить вживую с нынешним
// вариантом). Пока открыта панель иконки, страница набора делится на две колонки: слева заголовок, строка
// поиска, фильтры и сетка, справа — панель от уровня хлебных крошек до низа (место — PAGE_PANEL_ID в
// SetPage, стили — app/globals.css). Вариант выбирается ссылкой ?panel-layout=page | grid и запоминается
// в браузере; по умолчанию — нынешний («grid»: панель на уровне строки с номерами страниц).

/** Место панели справа от всей страницы набора (вариант «page»). */
export const PAGE_PANEL_ID = "page-panel";
/** Выбранный вариант в хранилище браузера. */
export const PANEL_LAYOUT_KEY = "iconavo-panel-layout";

export type PanelLayoutMode = "grid" | "page";

/** Вариант: из адреса (и запомнить), иначе из хранилища; хранилище недоступно — нынешний. */
export function readPanelLayout(
  search: string,
  storage: Pick<Storage, "getItem" | "setItem">,
): PanelLayoutMode {
  try {
    const param = new URLSearchParams(search).get("panel-layout");
    if (param === "page" || param === "grid") {
      storage.setItem(PANEL_LAYOUT_KEY, param);
    }
    return storage.getItem(PANEL_LAYOUT_KEY) === "page" ? "page" : "grid";
  } catch {
    return "grid";
  }
}
