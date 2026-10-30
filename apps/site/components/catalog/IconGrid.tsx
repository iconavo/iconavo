"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useRef, useState } from "react";
import {
  categoriesOf,
  getNames,
  pageCount,
  pageOf,
  pageParam,
  visibleNames,
} from "../../lib/catalog";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
// Хосты иконок — для ядра браузера: страницы и категории сетка грузит сама (lib/iconavo.ts).
import "../../lib/iconavo";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { Chips } from "./Chips";
import { Pagination } from "./Pagination";

/** Категория для сетки: адрес, название, число имён и оно же строкой на языке страницы. */
export interface GridCategory {
  slug: string;
  title: string;
  size: number;
  count: string;
}

interface Names {
  all: string[];
  bySlug: Map<string, string[]>;
}

/**
 * Сетка набора (шаг 2 фазы 4): по 96 иконок, категории автора и номера страниц — в адресе
 * (?category=…&page=…). Первая страница всех иконок — в серверном HTML с иконками, без мигания. Другие
 * страницы и категории — в браузере: список имён он один раз берёт у edge API (/collection), а иконки
 * грузит ядро пакета, пачками; пока грузятся — скелетоны. Варианты стиля — отдельными иконками, как у
 * Iconify; карточки с переключателем стиля — шаг 3 (решение владельца 30 октября 2026).
 */
export function IconGrid({
  lang,
  prefix,
  first,
  total,
  allCount,
  categories,
}: {
  lang: Lang;
  prefix: string;
  /** Первая страница всех иконок. */
  first: string[];
  /** Видимых имён в наборе. */
  total: number;
  /** То же число на языке страницы. */
  allCount: string;
  categories: GridCategory[];
}) {
  const t = DICTIONARIES[lang];
  const { query, hrefOf, navigate } = useUrlQuery();
  const slug = query.get("category");
  const category = categories.find((c) => c.slug === slug);
  const pages = pageCount(category?.size ?? total);
  const page = pageParam(query.get("page"), pages);
  const initial = category === undefined && page === 1;
  const [names, setNames] = useState<Names>();
  const [failed, setFailed] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initial || names !== undefined || failed) return;
    let cancelled = false;
    getNames(prefix)
      .then((c) => {
        if (cancelled) return;
        setNames({
          all: visibleNames(c),
          bySlug: new Map(categoriesOf(c).map((x) => [x.slug, x.names])),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initial, names, prefix, failed]);

  // После сбоя следующий переход спрашивает список ещё раз.
  const go = (changes: Record<string, string | undefined>) => {
    setFailed(false);
    navigate(withParams(query, changes));
    top.current?.scrollIntoView({ block: "start" });
  };
  const list =
    names === undefined
      ? undefined
      : category === undefined
        ? names.all
        : (names.bySlug.get(category.slug) ?? []);
  const shown = initial ? first : list && pageOf(list, page);
  const pageHref = (p: number) =>
    hrefOf(withParams(query, { page: p === 1 ? undefined : String(p) }));

  return (
    <div className="set-browser" ref={top}>
      {categories.length > 0 ? (
        <Chips
          label={t.setCategories}
          chips={[
            {
              key: "",
              label: t.setAllIcons,
              count: allCount,
              href: hrefOf(
                withParams(query, { category: undefined, page: undefined }),
              ),
              current: category === undefined,
              onSelect: () => go({ category: undefined, page: undefined }),
            },
            ...categories.map((c) => ({
              key: c.slug,
              label: c.title,
              count: c.count,
              href: hrefOf(
                withParams(query, { category: c.slug, page: undefined }),
              ),
              current: c.slug === category?.slug,
              onSelect: () => go({ category: c.slug, page: undefined }),
            })),
          ]}
        />
      ) : null}
      {failed ? (
        <p className="grid-status" role="alert">
          {t.gridError}
        </p>
      ) : shown === undefined ? (
        <p className="grid-status" aria-live="polite">
          {t.gridLoading}
        </p>
      ) : (
        <ul className="icon-grid" data-page={page}>
          {shown.map((name) => (
            <li key={name} className="icon-cell">
              <Icon icon={`${prefix}:${name}`} className="icon-cell-svg" />
              <span className="icon-cell-name">{name}</span>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        lang={lang}
        page={page}
        pages={pages}
        hrefOf={pageHref}
        onSelect={(p) => go({ page: p === 1 ? undefined : String(p) })}
      />
    </div>
  );
}
