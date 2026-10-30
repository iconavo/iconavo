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
  type Release,
  releaseCounts,
  revisionLabel,
  type SetInfo,
  visibleNames,
} from "./catalog";
import { countOf, formatDate, formatNumber, ICON_FORMS } from "./format";
import { DICTIONARIES, type Lang } from "./i18n";

/** Добавленных иконок в превью выпуска. */
export const RELEASE_PREVIEW = 24;

/** Имя метки версии набора на его странице: по ней pnpm site --live видит, что сайт пересобран. */
export const VERSION_META = "iconavo-version";

/** Заголовок и описание страницы набора; метка — версия данных набора (X-Iconavo-Version). */
export async function setMetadata(
  lang: Lang,
  prefix: string,
): Promise<Metadata> {
  const set = await getSet(prefix);
  if (set === undefined) return {};
  return {
    title: set.info.name,
    description: `${countOf(lang, visibleNames(set).length, ICON_FORMS[lang])} · ${set.info.author.name} · ${set.info.license.title}`,
    other: { [VERSION_META]: set.version },
  };
}

/** Карточка набора. */
export function setSummary(lang: Lang, id: string, info: SetInfo): SetSummary {
  return {
    id,
    name: info.name,
    total: countOf(lang, info.total, ICON_FORMS[lang]),
    author: info.author.name,
    license: info.license.title,
    licenseId: info.license.spdx,
    palette: info.palette,
    samples: info.samples ?? [],
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
