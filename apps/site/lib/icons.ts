// Иконки самого сайта (ADR-0038: сайт показывает иконки своим же пакетом). Все они грузятся на сервере и
// попадают в IconavoProvider — в HTML страниц, без мигания. Не загрузилась хоть одна — ошибка сборки
// страницы: иначе на сайт ушла бы страница с вечными заглушками, а при пересборке из кэша остаётся
// прежняя. Так же — иконки страниц каталога (шаг 2 фазы 4): витрины наборов, первая страница сетки,
// превью выпусков, страница иконки.
//
// На сервере рисунки берутся пачками edge API своим запросом — один раз на сборку страницы (React
// cache), а не хранилищем ядра: оно живёт весь процесс, и тёплая функция Vercel рисовала бы страницу,
// пересобранную после выпуска набора, старыми рисунками (шаг 4 фазы 4, ADR-0039). Запасных хостов
// статики, как у ядра, здесь нет: API не ответил — страница не собирается.

import type { IconavoIconSet } from "@iconavo-ui/react";
import { cache } from "react";
import { API } from "./api";

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
  // Панель иконки (шаг 4 фазы 4): закрыть, развернуть и свернуть шторку, открыть страницу.
  "lucide:x",
  "lucide:maximize-2",
  "lucide:minimize-2",
  "lucide:arrow-up-right",
  // Сумка в шапке и список форматов имени (шаг 5 фазы 4).
  "lucide:shopping-bag",
  "lucide:chevron-down",
] as const;

export type SiteIcon = (typeof SITE_ICONS)[number];

/** Пачка edge API — не больше 100 имён (ADR-0024); адрес — не длиннее 2000 знаков. */
const BATCH_NAMES = 100;
const BATCH_URL = 2000;

/** Часть имени: набор или иконка (ADR-0001). */
const PART = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Адреса пачек edge API для имён «набор:иконка»: по набору, кусками; имена в куске — по порядку, чтобы
 * одинаковый набор имён давал один адрес. Имя не по правилу — ошибка.
 */
export function batchUrls(
  api: string,
  names: readonly string[],
): [prefix: string, url: string][] {
  const byPrefix = new Map<string, string[]>();
  for (const name of new Set(names)) {
    const [prefix = "", icon = "", ...rest] = name.split(":");
    if (!PART.test(prefix) || !PART.test(icon) || rest.length > 0) {
      throw new Error(
        `СТОП: «${name}» — не имя иконки «набор:иконка» (ADR-0001)`,
      );
    }
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), icon]);
  }
  const urls: [string, string][] = [];
  for (const [prefix, icons] of byPrefix) {
    const head = `${api}/${prefix}.json?icons=`;
    let chunk: string[] = [];
    for (const icon of icons.sort()) {
      const longer = head.length + [...chunk, icon].join(",").length;
      if (chunk.length === BATCH_NAMES || longer > BATCH_URL) {
        urls.push([prefix, head + chunk.join(",")]);
        chunk = [];
      }
      chunk.push(icon);
    }
    if (chunk.length > 0) urls.push([prefix, head + chunk.join(",")]);
  }
  return urls;
}

/** Ответ пачки — IconifyJSON набора; не тот набор или формат — ошибка. */
export function parseBatch(prefix: string, value: unknown): IconavoIconSet {
  const set = value as Partial<IconavoIconSet> | null;
  if (
    typeof set !== "object" ||
    set === null ||
    set.prefix !== prefix ||
    typeof set.icons !== "object" ||
    set.icons === null
  ) {
    throw new Error(
      `СТОП: пачка набора «${prefix}» не по формату IconifyJSON (ADR-0024)`,
    );
  }
  return set as IconavoIconSet;
}

/** Пачка — один запрос на сборку страницы. */
const fetchBatch = cache(
  async (prefix: string, url: string): Promise<IconavoIconSet> => {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (e) {
      throw new Error(`СТОП: ${url} не ответил: ${(e as Error).message}`);
    }
    if (!response.ok)
      throw new Error(`СТОП: ${url} ответил ${response.status}`);
    return parseBatch(prefix, await response.json());
  },
);

/** Иконки по именам «набор:иконка»; не хватает хоть одной — ошибка. */
async function loadAll(
  names: readonly string[],
  what: string,
): Promise<IconavoIconSet[]> {
  const wanted = [...new Set(names)];
  if (wanted.length === 0) return [];
  const sets = await Promise.all(
    batchUrls(API, wanted).map(([prefix, url]) => fetchBatch(prefix, url)),
  );
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

/**
 * Какие из имён есть в наборах и не скрыты — для соседей в мокапах страницы иконки (lib/mockups.ts):
 * рисунки в страницу не идут, их догружает браузер.
 */
export async function existingIcons(
  names: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(names)];
  if (wanted.length === 0) return new Set();
  const sets = await Promise.all(
    batchUrls(API, wanted).map(([prefix, url]) => fetchBatch(prefix, url)),
  );
  return new Set(
    sets.flatMap((set) =>
      [
        ...Object.entries(set.icons),
        ...Object.entries(set.aliases ?? {}),
      ].flatMap(([name, entry]) =>
        entry.hidden ? [] : [`${set.prefix}:${name}`],
      ),
    ),
  );
}

/** Иконки страницы — для вложенного IconavoProvider; не хватает хоть одной — ошибка. */
export const loadPageIcons = (
  names: readonly string[],
): Promise<IconavoIconSet[]> => loadAll(names, "иконки страницы");
