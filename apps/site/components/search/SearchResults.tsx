"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { API } from "../../lib/api";
import { DICTIONARIES, type Lang, STYLE_KEYS } from "../../lib/i18n";
import {
  allCommercial,
  hasFilters,
  knownPages,
  pageWindow,
  parseSearchAnswer,
  REPEAT_DELAYS_MS,
  readSearchState,
  retryAfterSeconds,
  type SearchAnswer,
  type SearchState,
  STYLES,
  searchApiUrl,
} from "../../lib/search";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { type Chip, Chips, plainClick } from "../catalog/Chips";
import { Pagination } from "../catalog/Pagination";
import { SelectToggle, useSelect } from "../catalog/SelectToggle";
import { IconPanel } from "../icon/IconPanel";
import { usePanel } from "../icon/usePanel";
import { PageLink } from "../PageLink";
import { Button } from "../ui/button";
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

/** Карточек в блоке «без фильтров», когда с фильтрами пусто. */
const UNFILTERED_LIMIT = 24;

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
 * Выдача поиска (шаг 3 фазы 4, ADR-0040): запрос, фильтры и страница — в адресе, их пишет поле поиска
 * (SearchHero) и чипсы. Ищет браузер: адрес edge API /search, отмена устаревшего запроса.
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
  examples,
}: {
  lang: Lang;
  /** Наборы в порядке витрины. */
  sets: SearchSet[];
  /** SPDX лицензий каталога. */
  licenses: string[];
  /** Примеры запросов до ввода. */
  examples: string[];
}) {
  const t = DICTIONARIES[lang];
  const { query, ready, hrefOf, navigate } = useUrlQuery();
  // Боковая панель иконки (шаг 4 фазы 4): открыта, пока в адресе есть icon.
  const panel = usePanel(query, navigate);
  const select = useSelect();
  const known = useMemo(
    () => ({ sets: sets.map((s) => s.id), licenses }),
    [sets, licenses],
  );
  const state = readSearchState(query, known);
  const key = state.q === "" ? "" : searchApiUrl(API, state);
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

  const phase: Phase =
    view.key === key
      ? view.phase
      : key === ""
        ? { kind: "idle" }
        : { kind: "loading" };

  // Отсчёт после 429 — раз в секунду, пока ждём.
  useEffect(() => {
    if (phase.kind !== "limited") return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase.kind]);

  // С фильтрами пусто — то же без фильтров, одной небольшой страницей.
  const empty =
    phase.kind === "answer" &&
    !phase.repeating &&
    phase.answer.semantic === "full" &&
    phase.answer.cards.length === 0 &&
    state.page === 1 &&
    hasFilters(state);
  const unfilteredKey = empty
    ? searchApiUrl(API, { q: state.q, page: 1 }, UNFILTERED_LIMIT)
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

  const slot = pageWindow(state.page);
  const setTitles = Object.fromEntries(sets.map((s) => [s.id, s.title]));
  const change = (changes: Record<string, string | undefined>) =>
    withParams(query, { ...changes, page: undefined });
  const chip = (
    key: string,
    label: string,
    param: "style" | "set" | "license" | "commercial",
    value: string | undefined,
    current: boolean,
  ): Chip => ({
    key,
    label,
    href: hrefOf(change({ [param]: value })),
    current,
    onSelect: () => navigate(change({ [param]: value })),
  });
  const goPage = (page: number) => {
    navigate(
      withParams(query, { page: page === 1 ? undefined : String(page) }),
    );
    top.current?.scrollIntoView({ block: "start" });
  };
  const reset: SearchState = { q: state.q, page: 1 };
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
            select={select}
          />
        ) : (
          <ResultGrid
            lang={lang}
            cards={stale.cards}
            setTitles={setTitles}
            current={panel.icon}
            onOpen={panel.onCardClick}
            select={select}
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
            select={select}
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
            select={select}
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
            select={select}
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
                      q: reset.q || undefined,
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
                  select={select}
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

  const commercial = allCommercial(licenses);
  const final =
    phase.kind === "answer" && !phase.repeating ? phase.answer : undefined;
  return (
    <div
      className="with-panel"
      data-panel={panel.icon === undefined ? undefined : ""}
    >
      <section
        ref={top}
        className="search-results"
        aria-labelledby="search-results-title"
        data-search={phaseName(phase)}
        data-semantic={
          phase.kind === "answer" ? phase.answer.semantic : undefined
        }
      >
        <h2 id="search-results-title" className="sr-only">
          {t.searchResults}
        </h2>
        <div className="filters">
          <Chips
            label={t.searchStyle}
            chips={[
              chip(
                "",
                t.styleAny,
                "style",
                undefined,
                state.style === undefined,
              ),
              ...STYLES.map((s) =>
                chip(s, t[STYLE_KEYS[s]], "style", s, state.style === s),
              ),
            ]}
          />
          <Chips
            label={t.filterSet}
            chips={[
              chip("", t.filterAll, "set", undefined, state.set === undefined),
              ...sets.map((s) =>
                chip(s.id, s.title, "set", s.id, state.set === s.id),
              ),
            ]}
          />
          <Chips
            label={t.filterLicense}
            chips={[
              chip(
                "",
                t.filterAll,
                "license",
                undefined,
                state.license === undefined,
              ),
              ...licenses.map((l) =>
                chip(l, l, "license", l, state.license === l),
              ),
            ]}
          />
        </div>
        {commercial ? (
          <p className="search-commercial">
            {t.searchCommercial}{" "}
            <PageLink lang={lang} path="/licenses">
              {t.searchCommercialLink}
            </PageLink>
          </p>
        ) : (
          <Chips
            label={t.searchCommercialLabel}
            chips={[
              chip(
                "commercial",
                t.searchCommercialOnly,
                "commercial",
                state.commercial ? undefined : "1",
                state.commercial === true,
              ),
            ]}
          />
        )}
        <p className="search-status" role="status">
          {status}
          {query.get("timing") === "1" && timing !== undefined ? (
            <span className="search-timing">
              {t.searchTiming.replace("{ms}", String(Math.round(timing)))}
            </span>
          ) : null}
        </p>
        <SelectToggle lang={lang} select={select} />
        {body}
        {final !== undefined && (state.page > 1 || final.hasNext) ? (
          <Pagination
            lang={lang}
            page={state.page}
            pages={knownPages(state.page, final.hasNext)}
            hrefOf={(p) =>
              hrefOf(
                withParams(query, { page: p === 1 ? undefined : String(p) }),
              )
            }
            onSelect={goPage}
          />
        ) : null}
      </section>
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
