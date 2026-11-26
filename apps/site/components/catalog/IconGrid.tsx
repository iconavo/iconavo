"use client";

import { Icon } from "@iconavo-ui/react";
import { type MouseEvent, memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { iconOpened, styleChanged } from "../../lib/analytics";
import {
  type Category,
  cardsInStyle,
  categoriesOf,
  categoryCards,
  filterCards,
  getNames,
  PAGE_SIZE,
  type PanelSet,
  pageCount,
  pageOf,
  pageParam,
  pageSizeFor,
  type SetCards,
  setCards,
  shownName,
} from "../../lib/catalog";
import { useGridColumns } from "../../lib/grid-columns";
import { useKeptPage, usePerPage } from "../../lib/grid-settings";
import { DICTIONARIES, href, type Lang, STYLE_KEYS } from "../../lib/i18n";
import { iconPagePath } from "../../lib/icon";
import { PAGE_PANEL_ID } from "../../lib/panel-layout";
// Хосты иконок — для ядра браузера: страницы и категории сетка грузит сама (lib/iconavo.ts).
import "../../lib/iconavo";
import { isStyle, type Style } from "../../lib/search";
import { useStableCallback } from "../../lib/stable-callback";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { IconPanel } from "../icon/IconPanel";
import { CARD_LINK, usePanel } from "../icon/usePanel";
import { PanelLayout } from "../panel/PanelLayout";
import { Chips, plainClick } from "./Chips";
import { GridBar } from "./GridBar";
import { GridToolbar } from "./GridToolbar";
import { Pagination } from "./Pagination";
import { CardTools, SelectionBar, useSelection } from "./Selection";

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
 * Карточка сетки. С памятью (memo): открытие панели и смена иконки в ней меняют отметку у двух карточек, и
 * заново рисуются только они, а не вся страница сетки — щелчок по иконке отвечает быстрее (18 ноября
 * 2026). Поэтому пропсы — простые значения и обработчики с постоянной ссылкой.
 */
const GridCard = memo(function GridCard({
  lang,
  icon,
  name,
  current,
  picked,
  full,
  onOpen,
  onToggle,
}: {
  lang: Lang;
  /** Полное имя: набор:иконка. */
  icon: string;
  name: string;
  /** Иконка открыта в панели. */
  current: boolean;
  picked: boolean;
  /** Выбрано 100 — новые не выбираются. */
  full: boolean;
  onOpen: (e: MouseEvent<HTMLAnchorElement>, icon: string) => void;
  onToggle: (icon: string) => void;
}) {
  return (
    <li className="icon-cell" data-picked={picked ? "" : undefined}>
      <a
        href={href(lang, iconPagePath(icon))}
        className={CARD_LINK}
        data-icon={icon}
        aria-current={current ? "true" : undefined}
        onClick={(e) => onOpen(e, icon)}
      >
        <Icon icon={icon} className="icon-cell-svg" />
        <span className="icon-cell-name">{name}</span>
      </a>
      <CardTools
        lang={lang}
        name={icon}
        label={name}
        picked={picked}
        full={full}
        onToggle={onToggle}
      />
    </li>
  );
});

/**
 * Сетка набора (шаги 2 и 3 фазы 4, вид — по макету Figma «Iconavo — Макеты»): карточки — база со своими
 * вариантами (ADR-0052), около 96 на страницу целыми рядами (решение владельца 13 ноября 2026: число
 * колонок — от ширины окна, ни боковая панель, ни панель иконки их не меняют, app/globals.css); поиск по набору, стиль, категория автора и номер страницы —
 * в адресе (?q=…&style=…&category=…&page=…). Первая страница всех карточек — в серверном HTML с
 * иконками, без мигания. Остальное — в браузере: список имён он один раз берёт у edge API (/collection)
 * и собирает карточки тем же правилом, что индекс поиска; поиск по набору отбирает их по имени
 * (filterCards); иконки грузит ядро пакета, пачками; пока грузятся — скелетоны. Карточка показывает
 * главное имя выбранного стиля, без стиля — как у автора. Карточка — ссылка на страницу иконки: обычный
 * щелчок открывает боковую панель, с Ctrl — страницу в новой вкладке (шаг 4 фазы 4). При наведении у
 * карточки — кнопка «в рюкзак» и чекбокс выбора; выбранные скачиваются строкой над поиском (сценарий
 * «Выделение» макета, components/catalog/Selection.tsx).
 */
export function IconGrid({
  lang,
  prefix,
  setName,
  first,
  total,
  allCount,
  categories,
  styles,
  panelSets,
}: {
  lang: Lang;
  prefix: string;
  /** Сведения о наборе для панели иконки: она рисуется сразу целиком; нет — панель спросит каталог сама. */
  panelSets?: Readonly<Record<string, PanelSet>> | undefined;
  /** Название набора — в подсказке поля поиска. */
  setName: string;
  /** Начало списка карточек — на первую страницу при любой ширине (FIRST_PAGE_MAX): имена баз. */
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
  // Карточкам — та же ссылка на обработчик при любой отрисовке (GridCard с памятью). Обычный щелчок
  // открывает панель — событие аналитики «открыта из набора» (шаг 2 фазы 5).
  const openCard = useStableCallback(
    (e: MouseEvent<HTMLAnchorElement>, name: string) => {
      if (plainClick(e)) iconOpened(name, "set");
      panel.onCardClick(e, name);
    },
  );
  const selection = useSelection();
  const slug = query.get("category");
  const category = categories.find((c) => c.slug === slug);
  const styleParam = query.get("style");
  const style =
    isStyle(styleParam) && styles.some((s) => s.style === styleParam)
      ? styleParam
      : undefined;
  const q = (query.get("q") ?? "").trim();
  const [loaded, setLoaded] = useState<Loaded>();
  // Сбой загрузки списка имён — у адреса, где он случился: «назад», «вперёд» и любой другой переход
  // спрашивают список ещё раз, а не показывают старую ошибку (ревизия фазы 5, С-10).
  const queryKey = query.toString();
  const [failedAt, setFailedAt] = useState<string>();
  const failed = failedAt === queryKey;
  const top = useRef<HTMLDivElement>(null);
  // Колонок (от ширины окна) и иконок на странице; до гидратации — 96, а строки с номерами страниц
  // невидимы (GridBar).
  // Панель — во всю высоту страницы (lib/panel-layout.ts): её место справа от всей страницы набора.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(PAGE_PANEL_ID));
  }, []);
  const columns = useGridColumns();
  // Иконок на странице — из настроек сетки (ADR-0054), целыми рядами.
  const perPage = usePerPage();
  const size =
    columns === undefined ? undefined : pageSizeFor(columns, perPage);
  const pageSize = size ?? PAGE_SIZE;

  const list =
    loaded === undefined
      ? undefined
      : filterCards(
          cardsInStyle(
            category === undefined
              ? loaded.set.cards
              : categoryCards(
                  loaded.categories.find((c) => c.slug === category.slug)
                    ?.names ?? [],
                  loaded.set,
                ),
            style,
          ),
          q,
        );
  // Сколько карточек в выборке, пока список имён не пришёл: число набора, категории или стиля. Категория и
  // стиль вместе — не больше меньшего из них: точное число станет известно со списком (ревизия фазы 5, С-32).
  const styleSize =
    style === undefined
      ? total
      : (styles.find((s) => s.style === style)?.size ?? total);
  const known = Math.min(category?.size ?? total, styleSize);
  const pages = pageCount(list?.length ?? (q !== "" ? 1 : known), pageSize);
  const page = pageParam(query.get("page"), pages);
  // Сменили число на странице — первая иконка страницы остаётся на экране.
  useKeptPage(perPage, size, page, (p) =>
    navigate(withParams(query, { page: p === 1 ? undefined : String(p) }), {
      replace: true,
    }),
  );
  // Пока список имён грузится — скелетоны на месте карточек этой страницы (решение владельца 23 ноября 2026,
  // плавная прокрутка): высота страницы не меняется, и подъём к началу сетки при смене страницы доезжает
  // до места. Прежде на это время сетка становилась строкой «Загружаю…», страница схлопывалась до высоты
  // окна, и браузер прижимал прокрутку к самому верху.
  const waiting =
    q !== ""
      ? pageSize
      : Math.max(0, Math.min(pageSize, known - (page - 1) * pageSize));
  // Первая страница всех карточек — из серверного HTML, если её хватает на ряды этой ширины.
  const initial =
    category === undefined &&
    style === undefined &&
    page === 1 &&
    q === "" &&
    (pageSize <= first.length || first.length >= total);

  useEffect(() => {
    if (initial || loaded !== undefined || failed) return;
    let cancelled = false;
    getNames(prefix)
      .then((c) => {
        if (cancelled) return;
        setLoaded({ set: setCards(c), categories: categoriesOf(c) });
      })
      .catch(() => {
        if (!cancelled) setFailedAt(queryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [initial, loaded, prefix, failed, queryKey]);

  // Переход — и после сбоя: у нового адреса сбоя нет, список спрашивается ещё раз (failedAt).
  const go = (changes: Record<string, string | undefined>) => {
    navigate(withParams(query, changes));
    top.current?.scrollIntoView({ block: "start" });
  };
  // Поиск по набору: запись истории заменяется, страница — первая, прокрутки нет.
  const search = (text: string) => {
    navigate(
      withParams(query, { q: text === "" ? undefined : text, page: undefined }),
      { replace: true },
    );
  };
  const shown = initial
    ? first.slice(0, pageSize)
    : list &&
      pageOf(list, page, pageSize).map((card) => shownName(card, style));
  const pageHref = (p: number) =>
    hrefOf(withParams(query, { page: p === 1 ? undefined : String(p) }));
  const panelNode =
    panel.icon === undefined ? null : (
      <IconPanel
        lang={lang}
        icon={panel.icon}
        sets={panelSets}
        focus={panel.focus}
        onClose={panel.close}
        onPick={(name) => panel.open(name)}
      />
    );
  const pagination = (label?: string) => (
    <Pagination
      lang={lang}
      page={page}
      pages={pages}
      hrefOf={pageHref}
      onSelect={(p) => go({ page: p === 1 ? undefined : String(p) })}
      label={label}
    />
  );

  return (
    <div className="set-browser" ref={top}>
      <SelectionBar lang={lang} selection={selection} />
      <GridToolbar lang={lang} setName={setName} query={q} onQuery={search} />
      <div className="grid-filters">
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
                onSelect: () => {
                  styleChanged(s.style, "set");
                  go({ style: s.style, page: undefined });
                },
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
      </div>
      <PanelLayout
        open={panel.icon !== undefined}
        slot={slot}
        icon={panel.icon}
      >
        <div className="grid-area" ref={selection.anchor}>
          <GridBar lang={lang} top perPage={size}>
            {pagination(t.pagesTop)}
          </GridBar>
          {failed ? (
            <p className="grid-status" role="alert">
              {t.gridError}
            </p>
          ) : shown === undefined ? (
            <>
              <p className="sr-only" role="status">
                {t.gridLoading}
              </p>
              <ul className="icon-grid grid-skeletons" aria-hidden="true">
                {Array.from({ length: waiting }, (_, i) => (
                  <li
                    // У пустых клеток нет имени: ключ — место в сетке.
                    // biome-ignore lint/suspicious/noArrayIndexKey: клетки без данных, порядок постоянный
                    key={i}
                    className="icon-cell result-skeleton grid-skeleton"
                  >
                    <span className="result-skeleton-icon" />
                    <span className="result-skeleton-line" />
                  </li>
                ))}
              </ul>
            </>
          ) : shown.length === 0 && q !== "" ? (
            <p className="grid-status grid-empty" role="status">
              {/* Подстановка функцией: «$&» и «$1» в запросе — просто текст (ревизия фазы 5, С-34). */}
              {t.setNothing
                .replace("{set}", () => setName)
                .replace("{q}", () => q)}{" "}
              <button
                type="button"
                className="grid-clear"
                onClick={() => search("")}
              >
                {t.setSearchClear}
              </button>
            </p>
          ) : (
            <ul className="icon-grid" data-page={page}>
              {shown.map((name) => {
                const icon = `${prefix}:${name}`;
                return (
                  <GridCard
                    key={name}
                    lang={lang}
                    icon={icon}
                    name={name}
                    current={panel.icon === icon}
                    picked={selection.picked.includes(icon)}
                    full={selection.full}
                    onOpen={openCard}
                    onToggle={selection.toggle}
                  />
                );
              })}
            </ul>
          )}
          <GridBar lang={lang} perPage={size}>
            {pagination()}
          </GridBar>
        </div>
        {slot === null ? panelNode : null}
      </PanelLayout>
      {slot !== null && panelNode !== null
        ? createPortal(panelNode, slot)
        : null}
    </div>
  );
}
