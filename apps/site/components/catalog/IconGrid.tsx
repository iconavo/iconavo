"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useRef, useState } from "react";
import {
  type Category,
  cardsInStyle,
  categoriesOf,
  categoryCards,
  getNames,
  pageCount,
  pageOf,
  pageParam,
  type SetCards,
  setCards,
  shownName,
} from "../../lib/catalog";
import { cn } from "../../lib/cn";
import { DICTIONARIES, href, type Lang, STYLE_KEYS } from "../../lib/i18n";
import { iconPagePath } from "../../lib/icon";
// Хосты иконок — для ядра браузера: страницы и категории сетка грузит сама (lib/iconavo.ts).
import "../../lib/iconavo";
import { isStyle, type Style } from "../../lib/search";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { IconPanel } from "../icon/IconPanel";
import { CARD_LINK, usePanel } from "../icon/usePanel";
import { Chips } from "./Chips";
import { Pagination } from "./Pagination";
import { SelectToggle, useSelect } from "./SelectToggle";

/** Категория для сетки: адрес, название, число карточек и оно же строкой на языке страницы. */
export interface GridCategory {
  slug: string;
  title: string;
  size: number;
  count: string;
}

/** Стиль набора для чипсов: число карточек в нём — числом и строкой на языке страницы. */
export interface GridStyle {
  style: Style;
  size: number;
  count: string;
}

interface Loaded {
  set: SetCards;
  categories: Category[];
}

/**
 * Сетка набора (шаги 2 и 3 фазы 4): карточки — база со своими вариантами (ADR-0052), по 96 на страницу,
 * стиль, категория автора и номер страницы — в адресе (?style=…&category=…&page=…). Первая страница
 * всех карточек — в серверном HTML с иконками, без мигания. Остальное — в браузере: список имён он
 * один раз берёт у edge API (/collection) и собирает карточки тем же правилом, что индекс поиска;
 * иконки грузит ядро пакета, пачками; пока грузятся — скелетоны. Карточка показывает главное имя
 * выбранного стиля, без стиля — как у автора. Карточка — ссылка на страницу иконки: обычный щелчок
 * открывает боковую панель, с Ctrl — страницу в новой вкладке (шаг 4 фазы 4). В режиме «Выбрать
 * несколько» карточка — кнопка: щелчок кладёт иконку в сумку или убирает (шаг 5 фазы 4).
 */
export function IconGrid({
  lang,
  prefix,
  first,
  total,
  allCount,
  categories,
  styles,
}: {
  lang: Lang;
  prefix: string;
  /** Первая страница карточек: имена баз. */
  first: string[];
  /** Карточек в наборе. */
  total: number;
  /** То же число на языке страницы. */
  allCount: string;
  categories: GridCategory[];
  /** Стили набора; чипсы — только если их больше одного. */
  styles: GridStyle[];
}) {
  const t = DICTIONARIES[lang];
  const { query, hrefOf, navigate } = useUrlQuery();
  const panel = usePanel(query, navigate);
  const select = useSelect();
  const slug = query.get("category");
  const category = categories.find((c) => c.slug === slug);
  const styleParam = query.get("style");
  const style =
    isStyle(styleParam) && styles.some((s) => s.style === styleParam)
      ? styleParam
      : undefined;
  const [loaded, setLoaded] = useState<Loaded>();
  const [failed, setFailed] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const list =
    loaded === undefined
      ? undefined
      : cardsInStyle(
          category === undefined
            ? loaded.set.cards
            : categoryCards(
                loaded.categories.find((c) => c.slug === category.slug)
                  ?.names ?? [],
                loaded.set,
              ),
          style,
        );
  const pages = pageCount(
    list?.length ??
      (style === undefined
        ? (category?.size ?? total)
        : (styles.find((s) => s.style === style)?.size ?? total)),
  );
  const page = pageParam(query.get("page"), pages);
  const initial = category === undefined && style === undefined && page === 1;

  useEffect(() => {
    if (initial || loaded !== undefined || failed) return;
    let cancelled = false;
    getNames(prefix)
      .then((c) => {
        if (cancelled) return;
        setLoaded({ set: setCards(c), categories: categoriesOf(c) });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initial, loaded, prefix, failed]);

  // После сбоя следующий переход спрашивает список ещё раз.
  const go = (changes: Record<string, string | undefined>) => {
    setFailed(false);
    navigate(withParams(query, changes));
    top.current?.scrollIntoView({ block: "start" });
  };
  const shown = initial
    ? first
    : list && pageOf(list, page).map((card) => shownName(card, style));
  const pageHref = (p: number) =>
    hrefOf(withParams(query, { page: p === 1 ? undefined : String(p) }));

  return (
    <div
      className="with-panel"
      data-panel={panel.icon === undefined ? undefined : ""}
    >
      <div className="set-browser" ref={top}>
        {styles.length > 1 ? (
          <Chips
            label={t.searchStyle}
            chips={[
              {
                key: "",
                label: t.styleAny,
                count: allCount,
                href: hrefOf(
                  withParams(query, { style: undefined, page: undefined }),
                ),
                current: style === undefined,
                onSelect: () => go({ style: undefined, page: undefined }),
              },
              ...styles.map((s) => ({
                key: s.style,
                label: t[STYLE_KEYS[s.style]],
                count: s.count,
                href: hrefOf(
                  withParams(query, { style: s.style, page: undefined }),
                ),
                current: s.style === style,
                onSelect: () => go({ style: s.style, page: undefined }),
              })),
            ]}
          />
        ) : null}
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
        <SelectToggle lang={lang} select={select} />
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
            {shown.map((name) => {
              const icon = `${prefix}:${name}`;
              return (
                <li key={name} className="icon-cell">
                  {select.on ? (
                    <button
                      type="button"
                      className={cn(CARD_LINK, "icon-card-pick")}
                      data-icon={icon}
                      aria-pressed={select.bag.includes(icon)}
                      onClick={() => select.pick(icon)}
                    >
                      <Icon icon={icon} className="icon-cell-svg" />
                      <span className="icon-cell-name">{name}</span>
                    </button>
                  ) : (
                    <a
                      href={href(lang, iconPagePath(icon))}
                      className={CARD_LINK}
                      data-icon={icon}
                      aria-current={panel.icon === icon ? "true" : undefined}
                      onClick={(e) => panel.onCardClick(e, icon)}
                    >
                      <Icon icon={icon} className="icon-cell-svg" />
                      <span className="icon-cell-name">{name}</span>
                    </a>
                  )}
                </li>
              );
            })}
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
      {panel.icon === undefined ? null : (
        <IconPanel
          lang={lang}
          icon={panel.icon}
          focus={panel.focus}
          onClose={panel.close}
          onPick={(name) => panel.open(name)}
        />
      )}
    </div>
  );
}
