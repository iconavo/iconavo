// Иконки самого сайта (ADR-0038: сайт показывает иконки своим же пакетом). Все они грузятся на сервере и
// попадают в IconavoProvider — в HTML страниц, без мигания. Страницы статические, поэтому не загрузилась
// хоть одна — ошибка сборки: иначе на сайт ушла бы страница с вечными заглушками. Так же — иконки
// страниц каталога (шаг 2 фазы 4): витрины наборов, первая страница сетки, превью выпусков.

import { type IconavoIconSet, loadIcons } from "@iconavo-ui/react";
import "./iconavo";

export const SITE_ICONS = [
  "lucide:menu",
  "lucide:copy",
  "lucide:check",
  "lucide:arrow-left",
  "lucide:arrow-right",
  "lucide:pencil",
  "tabler:brand-github",
  // Шапка: поиск и меню темы.
  "lucide:search",
  "lucide:monitor",
  "lucide:sun",
  "lucide:moon",
  // Номера страниц сетки набора.
  "lucide:chevron-left",
  "lucide:chevron-right",
] as const;

export type SiteIcon = (typeof SITE_ICONS)[number];

/** Иконки по именам «набор:иконка»; не хватает хоть одной — ошибка. */
async function loadAll(
  names: readonly string[],
  what: string,
): Promise<IconavoIconSet[]> {
  const wanted = [...new Set(names)];
  if (wanted.length === 0) return [];
  const sets = await loadIcons(wanted);
  const got = new Set(
    sets.flatMap((set) =>
      [...Object.keys(set.icons), ...Object.keys(set.aliases ?? {})].map(
        (name) => `${set.prefix}:${name}`,
      ),
    ),
  );
  const missing = wanted.filter((name) => !got.has(name));
  if (missing.length > 0) {
    throw new Error(
      `СТОП: ${what} не загрузились: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""} — хосты иконок не ответили или имени нет`,
    );
  }
  return sets;
}

/** Все иконки сайта; не хватает хоть одной — ошибка. */
export const loadSiteIcons = (): Promise<IconavoIconSet[]> =>
  loadAll(SITE_ICONS, "иконки сайта");

/** Иконки страницы каталога — для вложенного IconavoProvider; не хватает хоть одной — ошибка. */
export const loadPageIcons = (
  names: readonly string[],
): Promise<IconavoIconSet[]> => loadAll(names, "иконки страницы каталога");
