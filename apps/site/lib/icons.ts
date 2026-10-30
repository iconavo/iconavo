// Иконки самого сайта (ADR-0038: сайт показывает иконки своим же пакетом). Все они грузятся на сервере и
// попадают в IconavoProvider — в HTML страниц, без мигания. Страницы статические, поэтому не загрузилась
// хоть одна — ошибка сборки: иначе на сайт ушла бы страница с вечными заглушками.

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
  // Витрина главной: по иконке из каждого набора.
  "lucide:house",
  "tabler:star",
  "material-symbols:home-rounded",
  "ph:smiley",
  "fluent-emoji-flat:rocket",
] as const;

export type SiteIcon = (typeof SITE_ICONS)[number];

/** Все иконки сайта; не хватает хоть одной — ошибка. */
export async function loadSiteIcons(): Promise<IconavoIconSet[]> {
  const sets = await loadIcons([...SITE_ICONS]);
  const got = new Set(
    sets.flatMap((set) =>
      [...Object.keys(set.icons), ...Object.keys(set.aliases ?? {})].map(
        (name) => `${set.prefix}:${name}`,
      ),
    ),
  );
  const missing = SITE_ICONS.filter((name) => !got.has(name));
  if (missing.length > 0) {
    throw new Error(
      `СТОП: иконки сайта не загрузились: ${missing.join(", ")} — хосты иконок не ответили или имени нет`,
    );
  }
  return sets;
}
