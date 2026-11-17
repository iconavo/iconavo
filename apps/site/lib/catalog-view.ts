// Данные каталога — в строки на языке страницы для компонентов (шаг 2 фазы 4). Считает сервер при
// сборке: числа, даты и формы слов в клиентские компоненты приходят готовыми (lib/format.ts).

import type { Metadata } from "next";
import type {
  ReleaseList,
  ReleaseView,
} from "../components/catalog/ReleaseItem";
import type { SetSummary } from "../components/catalog/SetCard";
import {
  getSet,
  groupSets,
  type Release,
  releaseCounts,
  revisionLabel,
  type SetGroupId,
  type SetInfo,
  visibleNames,
} from "./catalog";
import { countOf, formatDate, formatNumber, ICON_FORMS } from "./format";
import { DICTIONARIES, type Dictionary, type Lang, STYLE_KEYS } from "./i18n";
import type { Style } from "./search";

/** Тексты группы наборов: заголовок на главной, короткое имя — в боковой панели и чипсах, описание. */
export const GROUP_TEXTS: Record<
  SetGroupId,
  { title: keyof Dictionary; short: keyof Dictionary; text: keyof Dictionary }
> = {
  material: {
    title: "groupMaterialTitle",
    short: "groupMaterialShort",
    text: "groupMaterialText",
  },
  "ui-24": {
    title: "groupUi24Title",
    short: "groupUi24Short",
    text: "groupUi24Text",
  },
  emoji: {
    title: "groupEmojiTitle",
    short: "groupEmojiShort",
    text: "groupEmojiText",
  },
};

/** Строка набора в боковой панели: число — без слова, как в макете; лицензия — для фильтра поиска. */
export interface SidebarSet {
  id: string;
  name: string;
  count: string;
  /** SPDX лицензии набора: вкладка License левой панели на странице поиска. */
  license: string;
}

export interface SidebarGroup {
  id: SetGroupId;
  title: string;
  sets: SidebarSet[];
}

/** Наборы боковой панели по группам — на языке страницы. */
export function sidebarGroups(
  lang: Lang,
  sets: Record<string, SetInfo>,
): SidebarGroup[] {
  const t = DICTIONARIES[lang];
  return groupSets(sets).map((g) => ({
    id: g.id,
    title: t[GROUP_TEXTS[g.id].short],
    sets: g.ids.flatMap((id) => {
      const info = sets[id];
      return info === undefined
        ? []
        : [
            {
              id,
              name: info.name,
              count: formatNumber(lang, info.total),
              license: info.license.spdx,
            },
          ];
    }),
  }));
}

/** Добавленных иконок в превью выпуска. */
export const RELEASE_PREVIEW = 24;

/** Имя метки версии набора на его странице: по ней pnpm site --live видит, что сайт пересобран. */
export const VERSION_META = "iconavo-version";

/**
 * Имя метки отпечатка содержимого набора (X-Iconavo-Content) — у страницы набора и страниц его иконок:
 * по ней pnpm site --refresh видит, что страницу пора сбросить (ADR-0039).
 */
export const CONTENT_META = "iconavo-content";

/** Имя метки времени сборки страницы (UTC, ISO): по ней pnpm site --refresh видит, что сброс сработал. */
export const RENDERED_META = "iconavo-rendered";

/** Метки страницы с данными набора: версия, отпечаток содержимого и время сборки. */
export const setMetas = (version: string, content: string) => ({
  [VERSION_META]: version,
  [CONTENT_META]: content,
  [RENDERED_META]: new Date().toISOString(),
});

/** Заголовок и описание страницы набора; метки — версия и содержимое набора, время сборки. */
export async function setMetadata(
  lang: Lang,
  prefix: string,
): Promise<Metadata> {
  const set = await getSet(prefix);
  if (set === undefined) return {};
  return {
    title: set.info.name,
    description: `${countOf(lang, visibleNames(set).length, ICON_FORMS[lang])} · ${set.info.author.name} · ${set.info.license.title}`,
    other: setMetas(set.version, set.content),
  };
}

/** Карточка набора; styles — стили набора по общей шкале (ADR-0052). */
export function setSummary(
  lang: Lang,
  id: string,
  info: SetInfo,
  styles: readonly Style[] = [],
): SetSummary {
  const t = DICTIONARIES[lang];
  return {
    id,
    name: info.name,
    total: countOf(lang, info.total, ICON_FORMS[lang]),
    author: info.author.name,
    license: info.license.title,
    licenseId: info.license.spdx,
    palette: info.palette,
    samples: info.samples ?? [],
    styles: [...styles],
    stylesLine: styles.map((s) => t[STYLE_KEYS[s]]).join(" · "),
  };
}

/** Выпуск для ленты: списки — только непустые, переименования и алиасы — «старое → новое». */
export function releaseView(
  lang: Lang,
  r: Release,
  setName: string,
): ReleaseView {
  const t = DICTIONARIES[lang];
  const counts = releaseCounts(r);
  const pairs = (map: Record<string, string> | undefined) =>
    Object.entries(map ?? {}).map(([from, to]) => `${from} → ${to}`);
  const lists: ReleaseList[] = (
    [
      ["added", t.newsAdded, r.added ?? []],
      ["changed", t.newsChanged, r.changed ?? []],
      ["restored", t.newsRestored, r.restored ?? []],
      ["hidden", t.newsHidden, r.hidden ?? []],
      ["renamed", t.newsRenamed, pairs(r.renamed)],
      ["aliases", t.newsAliases, pairs(r.aliases)],
    ] as const
  )
    .filter(([kind]) => counts[kind] > 0)
    .map(([kind, label, names]) => ({
      kind,
      label,
      count: formatNumber(lang, counts[kind]),
      names: [...names],
    }));
  return {
    id: `${r.prefix}-${r.version}`,
    prefix: r.prefix,
    setName,
    iso: r.date,
    date: formatDate(lang, r.date),
    revision: revisionLabel(r.revision),
    total: formatNumber(lang, r.total),
    first: r.previous === undefined,
    preview: (r.added ?? []).slice(0, RELEASE_PREVIEW),
    lists,
  };
}

/** Короткая строка выпуска для главной: что изменилось, без имён; первая запись — «набор добавлен». */
export function releaseSummary(lang: Lang, view: ReleaseView): string {
  const t = DICTIONARIES[lang];
  if (view.first || view.lists.length === 0) return t.newsFirst;
  return view.lists.map((l) => `${l.label}: ${l.count}`).join(" · ");
}

/**
 * «Filter by name» левой панели и шторки фильтра: строки, у которых в названии или префиксе есть эти буквы;
 * пустые группы пропадают. Без запросов — прямо по данным панели.
 */
export function filterGroups(
  groups: readonly SidebarGroup[],
  text: string,
): SidebarGroup[] {
  const needle = text.trim().toLowerCase();
  return groups
    .map((g) => ({
      ...g,
      sets: g.sets.filter(
        (s) =>
          needle === "" ||
          s.name.toLowerCase().includes(needle) ||
          s.id.includes(needle),
      ),
    }))
    .filter((g) => g.sets.length > 0);
}

/** Лицензии наборов панели — без повторов, по алфавиту: вкладка License на странице поиска. */
export const groupLicenses = (groups: readonly SidebarGroup[]): string[] =>
  [...new Set(groups.flatMap((g) => g.sets.map((s) => s.license)))].sort(
    (a, b) => a.localeCompare(b, "en"),
  );
