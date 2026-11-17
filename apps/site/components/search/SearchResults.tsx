"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API } from "../../lib/api";
import { pageSizeFor } from "../../lib/catalog";
import type { SidebarGroup } from "../../lib/catalog-view";
import { filterSheetStore } from "../../lib/filter-sheet";
import { useGridColumns } from "../../lib/grid-columns";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PAGE_PANEL_ID } from "../../lib/panel-layout";
import {
  activeFilters,
  filtersOf,
  hasFilters,
  knownPages,
  pageWindow,
  parseSearchAnswer,
  REPEAT_DELAYS_MS,
  readSearchState,
  retryAfterSeconds,
  SEARCH_PAGE_SIZE,
  type SearchAnswer,
  searchApiUrl,
  withFilters,
} from "../../lib/search";
import { queryText, useUrlQuery, withParams } from "../../lib/url-query";
import { plainClick } from "../catalog/Chips";
import { GridBar } from "../catalog/GridBar";
import { Pagination } from "../catalog/Pagination";
import { SelectionBar, useSelection } from "../catalog/Selection";
import { IconPanel } from "../icon/IconPanel";
import { usePanel } from "../icon/usePanel";
import { PanelLayout } from "../panel/PanelLayout";
import { Button } from "../ui/button";
import { FilterSheet } from "./FilterSheet";
import { ResultGrid } from "./ResultGrid";

/** Полные ответы этой вкладки: «назад» и смена страниц — без новых запросов и без лимита. */
const MEMORY_LIMIT = 50;
const memory = new Map<string, SearchAnswer>();

function remember(key: string, answer: SearchAnswer) {
  memory.delete(key);
  memory.set(key, answer);
  if (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

/** Рядов в блоке «без фильтров», когда с фильтрами пусто. */
const UNFILTERED_ROWS = 3;

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  /** repeating — выдача по словам, полная досчитывается; slow — повторы кончились, а полной нет. */
  | { kind: "answer"; answer: SearchAnswer; repeating: boolean; slow: boolean }
  | { kind: "limited"; until: number }
  | { kind: "failed" };

/** Что видно на странице: для data-search и проверки сайта. */
const phaseName = (p: Phase) =>
  p.kind === "answer" ? (p.repeating ? "partial" : "final") : p.kind;

export interface SearchSet {
  id: string;
  title: string;
}

/**
 * Выдача поиска (шаг 3 фазы 4, ADR-0040; редизайн по макету «Сценарий поиска иконок», 17 ноября 2026):
 * запрос, фильтры и страница — в адресе, их пишут поле поиска (SearchHero), вкладки левой панели
 * (SidebarTabs) и шторка фильтра на телефоне (FilterSheet). Ищет браузер: адрес edge API /search, отмена
 * устаревшего запроса. Страница — целые ряды сетки, как у набора (pageSizeFor): пока браузер не посчитал
 * колонки, запроса нет — на месте выдачи скелетоны; над сеткой и под ней — строки номеров страниц.
 * - Выдача по словам (pending) видна сразу, полная встаёт в те же клетки (решение владельца): повторы
 *   через 1,2, 1,5 и 2,5 с, пока страница добита скелетонами.
 * - 429 — сообщение и отсчёт по Retry-After, затем поиск повторяется сам.
 * - Пусто: по словам ничего — близкие по смыслу с подсказкой (matched); с фильтрами пусто — сброс и то
 *   же без фильтров; только слова — пометка.
 * - ?timing=1 — время первого ответа: проверка цели 0,3 с без DevTools.
 */
export function SearchResults({
  lang,
  sets,
  licenses,
  groups,
  examples,
}: {
  lang: Lang;
  /** Наборы в порядке витрины. */
  sets: SearchSet[];
  /** SPDX лицензий каталога. */
  licenses: string[];
  /** Наборы по группам с числом иконок — для шторки фильтра. */
  groups: SidebarGroup[];
  /** Примеры запросов до ввода. */
  examples: string[];
}) {
  const t = DICTIONARIES[lang];
  const { query, ready, hrefOf, navigate } = useUrlQuery();
  // Боковая панель иконки (шаг 4 фазы 4): открыта, пока в адресе есть icon.
  const panel = usePanel(query, navigate);
  // Панель — во всю высоту страницы (lib/panel-layout.ts): её место справа от всей страницы поиска.
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPanelSlot(document.getElementById(PAGE_PANEL_ID));
  }, []);
  const selection = useSelection();
  const known = useMemo(
    () => ({ sets: sets.map((s) => s.id), licenses }),
    [sets, licenses],
  );
  const state = readSearchState(query, known);
  // Страница — целые ряды: колонки — только от ширины окна (lib/grid-columns.ts), как у набора.
  const columns = useGridColumns();
  const size = columns === undefined ? undefined : pageSizeFor(columns);
  const key =
    state.q === "" || size === undefined ? "" : searchApiUrl(API, state, size);
  // Счётчик на кнопке фильтра (телефон) — по фильтрам этой выдачи.
  const selected = activeFilters(state);
  useEffect(() => {
    filterSheetStore.setCount(selected);
  }, [selected]);
  useEffect(() => () => filterSheetStore.setCount(0), []);
  const [view, setView] = useState<{ key: string; phase: Phase }>({
    key: "",
    phase: { kind: "idle" },
  });
  const [attempt, setAttempt] = useState(0);
  const [timing, setTiming] = useState<number>();
  const [, setTick] = useState(0);
  const last = useRef<SearchAnswer>(undefined);
  const top = useRef<HTMLElement>(null);

  useEffect(() => {
    void attempt;
    if (!ready) return;
    if (key === "") {
      setView({ key, phase: { kind: "idle" } });
      return;
    }
    const kept = memory.get(key);
    if (kept !== undefined) {
      last.current = kept;
      setView({
        key,
        phase: { kind: "answer", answer: kept, repeating: false, slow: false },
      });
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let repeats = 0;
    let first = true;
    const started = performance.now();
    setView({ key, phase: { kind: "loading" } });
    const run = async (): Promise<void> => {
      let response: Response;
      try {
        response = await fetch(key, { signal: controller.signal });
      } catch {
        if (!controller.signal.aborted) {
          setView({ key, phase: { kind: "failed" } });
        }
        return;
      }
      if (response.status === 429) {
        const seconds = retryAfterSeconds(response.headers.get("retry-after"));
        setView({
          key,
          phase: { kind: "limited", until: Date.now() + seconds * 1000 },
        });
        timer = setTimeout(() => void run(), seconds * 1000);
        return;
      }
      let answer: SearchAnswer | undefined;
      try {
        answer = response.ok
          ? parseSearchAnswer(await response.json())
          : undefined;
      } catch {
        answer = undefined;
      }
      if (controller.signal.aborted) return;
      if (answer === undefined) {
        setView({ key, phase: { kind: "failed" } });
        return;
      }
      if (first) {
        first = false;
        setTiming(performance.now() - started);
      }
      last.current = answer;
      const delay = REPEAT_DELAYS_MS[repeats];
      if (answer.semantic === "pending" && delay !== undefined) {
        repeats += 1;
        setView({
          key,
          phase: { kind: "answer", answer, repeating: true, slow: false },
        });
        timer = setTimeout(() => void run(), delay);
        return;
      }
      if (answer.semantic === "full") remember(key, answer);
      setView({
        key,
        phase: {
          kind: "answer",
          answer,
          repeating: false,
          slow: answer.semantic === "pending",
        },
      });
    };
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, ready, attempt]);

  // Без запроса — примеры; запрос есть, а колонки ещё не посчитаны или ответа нет — загрузка.
  const phase: Phase =
    state.q === ""
      ? { kind: "idle" }
      : view.key === key && key !== ""
        ? view.phase
        : { kind: "loading" };

  // Отсчёт после 429 — раз в секунду, пока ждём.
  useEffect(() => {
    if (phase.kind !== "limited") return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase.kind]);

  // С фильтрами пусто — то же без фильтров, несколькими рядами.
  const empty =
    phase.kind === "answer" &&
    !phase.repeating &&
    phase.answer.semantic === "full" &&
    phase.answer.cards.length === 0 &&
    state.page === 1 &&
    hasFilters(state);
  const unfilteredKey =
    empty && columns !== undefined
      ? searchApiUrl(
          API,
          { q: state.q, sets: [], licenses: [], page: 1 },
          size,
          columns * UNFILTERED_ROWS,
        )
      : "";
  const [unfiltered, setUnfiltered] = useState<{
    key: string;
    answer: SearchAnswer;
  }>();
  useEffect(() => {
    if (unfilteredKey === "") return;
    const kept = memory.get(unfilteredKey);
    if (kept !== undefined) {
      setUnfiltered({ key: unfilteredKey, answer: kept });
      return;
    }
    const controller = new AbortController();
    fetch(unfilteredKey, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((json: unknown) => {
        const answer = parseSearchAnswer(json);
        if (answer === undefined) return;
        if (answer.semantic === "full") remember(unfilteredKey, answer);
        setUnfiltered({ key: unfilteredKey, answer });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [unfilteredKey]);

  const slot = pageWindow(state.page, size ?? SEARCH_PAGE_SIZE);
  const setTitles = Object.fromEntries(sets.map((s) => [s.id, s.title]));
  const goPage = (page: number) => {
    navigate(
      withParams(query, { page: page === 1 ? undefined : String(page) }),
    );
    top.current?.scrollIntoView({ block: "start" });
  };
  const resetHref = hrefOf(
    withParams(new URLSearchParams(), {
      q: state.q || undefined,
      icon: panel.icon,
    }),
  );
  const retry = (
    <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
      {t.searchRetry}
    </Button>
  );

  let status: ReactNode = null;
  let body: ReactNode;
  const stale = last.current;
  switch (phase.kind) {
    case "idle":
      body = (
        <div className="search-idle">
          <p>{t.searchHint}</p>
          <p>
            {t.searchExamples}{" "}
            {examples.map((example, i) => {
              const next = withParams(new URLSearchParams(), {
                q: example,
                icon: panel.icon,
              });
              return (
                <span key={example}>
                  {i > 0 ? " · " : null}
                  <a
                    href={hrefOf(next)}
                    onClick={(e) => {
                      if (!plainClick(e)) return;
                      e.preventDefault();
                      navigate(next);
                    }}
                  >
                    {example}
                  </a>
                </span>
              );
            })}
          </p>
        </div>
      );
      break;
    case "loading":
      body =
        stale === undefined ? (
          <ResultGrid
            lang={lang}
            cards={[]}
            skeletons={slot.limit}
            setTitles={setTitles}
            current={panel.icon}
            onOpen={panel.onCardClick}
            selection={selection}
          />
        ) : (
          <ResultGrid
            lang={lang}
            cards={stale.cards}
            setTitles={setTitles}
            current={panel.icon}
            onOpen={panel.onCardClick}
            selection={selection}
            busy
          />
        );
      break;
    case "limited": {
      const seconds = Math.max(0, Math.ceil((phase.until - Date.now()) / 1000));
      status = (
        <>
          {t.searchLimited}{" "}
          <span aria-hidden="true">
            {t.searchLimitedIn.replace("{s}", String(seconds))}
          </span>
        </>
      );
      body =
        stale === undefined ? null : (
          <ResultGrid
            lang={lang}
            cards={stale.cards}
            setTitles={setTitles}
            current={panel.icon}
            onOpen={panel.onCardClick}
            selection={selection}
          />
        );
      break;
    }
    case "failed":
      status = (
        <>
          {t.searchFailed} {retry}
        </>
      );
      body =
        stale === undefined ? null : (
          <ResultGrid
            lang={lang}
            cards={stale.cards}
            setTitles={setTitles}
            current={panel.icon}
            onOpen={panel.onCardClick}
            selection={selection}
          />
        );
      break;
    case "answer": {
      const { answer } = phase;
      const cards = answer.cards;
      if (phase.repeating) status = t.searchRefining;
      else if (phase.slow) {
        status = (
          <>
            {t.searchSlow} {retry}
          </>
        );
      } else if (answer.semantic === "text" && cards.length > 0) {
        status = t.searchWordsOnly;
      } else if (!answer.matched && cards.length > 0 && state.page === 1) {
        status = t.searchNoWords;
      }
      if (cards.length > 0 || phase.repeating) {
        body = (
          <ResultGrid
            lang={lang}
            cards={cards}
            skeletons={
              phase.repeating ? Math.max(0, slot.limit - cards.length) : 0
            }
            setTitles={setTitles}
            current={panel.icon}
            onOpen={panel.onCardClick}
            selection={selection}
          />
        );
      } else if (state.page > 1) {
        body = (
          <p>
            {t.searchNoMore}{" "}
            <a
              href={hrefOf(withParams(query, { page: undefined }))}
              onClick={(e) => {
                if (!plainClick(e)) return;
                e.preventDefault();
                goPage(1);
              }}
            >
              {t.searchFirstPage}
            </a>
          </p>
        );
      } else if (hasFilters(state)) {
        const other =
          unfiltered?.key === unfilteredKey ? unfiltered : undefined;
        body = (
          <>
            <p>
              {t.searchNoneFiltered}{" "}
              <a
                href={resetHref}
                onClick={(e) => {
                  if (!plainClick(e)) return;
                  e.preventDefault();
                  navigate(
                    withParams(new URLSearchParams(), {
                      q: state.q || undefined,
                      icon: panel.icon,
                    }),
                  );
                }}
              >
                {t.searchResetFilters}
              </a>
            </p>
            {other !== undefined && other.answer.cards.length > 0 ? (
              <section aria-labelledby="search-unfiltered">
                <h2 id="search-unfiltered" className="search-subtitle">
                  {t.searchUnfiltered}
                </h2>
                <ResultGrid
                  lang={lang}
                  cards={other.answer.cards}
                  setTitles={setTitles}
                  current={panel.icon}
                  onOpen={panel.onCardClick}
                  selection={selection}
                />
              </section>
            ) : null}
          </>
        );
      } else {
        body = (
          <p>
            {t.searchNothing} {t.searchRephrase}
          </p>
        );
      }
      break;
    }
  }

  const final =
    phase.kind === "answer" && !phase.repeating ? phase.answer : undefined;
  const pages =
    final !== undefined &&
    size !== undefined &&
    (state.page > 1 || final.hasNext)
      ? knownPages(state.page, final.hasNext, size)
      : 0;
  // Строки номеров страниц — над сеткой и под ней, как у набора; номера — когда выдача полная.
  const bar = (above: boolean) =>
    state.q === "" ? null : (
      <GridBar lang={lang} top={above} perPage={size}>
        {pages > 1 ? (
          <Pagination
            lang={lang}
            page={state.page}
            pages={pages}
            hrefOf={(p) =>
              hrefOf(
                withParams(query, { page: p === 1 ? undefined : String(p) }),
              )
            }
            onSelect={goPage}
            {...(above ? { label: t.pagesTop } : {})}
          />
        ) : null}
      </GridBar>
    );
  const panelNode =
    panel.icon === undefined ? null : (
      <IconPanel
        lang={lang}
        icon={panel.icon}
        focus={panel.focus}
        onClose={panel.close}
        onPick={(name) => panel.open(name)}
      />
    );
  return (
    <>
      <PanelLayout
        open={panel.icon !== undefined}
        slot={panelSlot}
        icon={panel.icon}
      >
        <section
          ref={top}
          className="search-results"
          aria-labelledby="search-results-title"
          data-search={phaseName(phase)}
          // Адрес, по которому нарисована выдача: адрес страницы меняется сразу, а выдача — со следующей
          // отрисовкой; проверка сайта сверяет оба и не принимает прежнюю выдачу за новую.
          data-query={queryText(query)}
          data-semantic={
            phase.kind === "answer" ? phase.answer.semantic : undefined
          }
        >
          <h2 id="search-results-title" className="sr-only">
            {t.searchResults}
          </h2>
          {bar(true)}
          {/* Строка статуса — в зазоре между строкой номеров и сеткой: место под неё есть всегда, и
              сообщение не сдвигает выдачу (ADR-0040). */}
          <p className="search-status" role="status">
            {status}
            {query.get("timing") === "1" && timing !== undefined ? (
              <span className="search-timing">
                {t.searchTiming.replace("{ms}", String(Math.round(timing)))}
              </span>
            ) : null}
          </p>
          <SelectionBar lang={lang} selection={selection} />
          {/* search-body — место выдачи: по нему её находит проверка сайта (pnpm site --check). */}
          <div ref={selection.anchor} className="search-body">
            {body}
          </div>
          {bar(false)}
        </section>
        {panelSlot === null ? panelNode : null}
      </PanelLayout>
      {panelSlot !== null && panelNode !== null
        ? createPortal(panelNode, panelSlot)
        : null}
      <FilterSheet
        lang={lang}
        groups={groups}
        licenses={licenses}
        value={filtersOf(state)}
        onApply={(filters) => navigate(withFilters(query, filters))}
      />
    </>
  );
}
