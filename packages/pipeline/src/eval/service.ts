// Поисковый сервис в замере (ADR-0049): ответы Meilisearch на запросы эталона — теми же телами
// multi-search, что строит функция edge API (общий модуль поиска), поэтому в замере та же выдача, что у
// пользователя. Списки: «только слова» — выдача «сначала текст», и гибрид при каждой доле смысла из
// сетки; при доле из настроек — глубже, до 30-го места: по ним размечаются места 11–30 худших запросов
// (шаг 8 фазы 4, ADR-0053). Отдельно — списки «только слова» и «только смысл» с оценками Meilisearch:
// на каком месте подходящая иконка у каждой части поиска. Вектор запроса — Gemini от нормализованного
// текста, первые 1024 числа; кэш — тот же, что у прототипа (.cache/search/queries).

import {
  exactName,
  exactQuery,
  keywordQuery,
  type MultiSearchQuery,
  mainQuery,
  normalizeText,
  pageResults,
  parseMultiSearch,
  parseScoredHits,
  type ScoredHit,
  SEARCH_MODEL,
  SEMANTIC_RATIO,
  type SearchHit,
  semanticQuery,
  stripSetPrefix,
  truncateUnit,
} from "@iconavo-ui/search";
import type { EmbeddingClient } from "../embed/client.js";
import type { MeiliClient } from "../meili/client.js";
import { searchEmbeddingModel } from "../meili/embed.js";
import type { Catalog } from "../search/catalog.js";
import { queryVectors } from "../search/query-vectors.js";
import { ALPHA_GRID, CEILING_DEPTH, DEPTH, SCORED_DEPTH } from "./config.js";
import type { GoldenQuery } from "./golden.js";

/** Ключ списка сервиса: «text» — только слова, «ratio:0.3» — гибрид с долей смысла 0,3. */
export const serviceKey = (ratio?: number): string =>
  ratio === undefined ? "text" : `ratio:${ratio}`;

/** Запросов эталона в одном multi-search: тело ≈ 20 × 11 векторов × 10 КБ. */
export const QUERIES_PER_REQUEST = 20;

/** Списки с оценками Meilisearch — по каждому запросу эталона, без карточек точного имени. */
export interface ScoredLists {
  /** Только слова. */
  words: ScoredHit[][];
  /** Только смысл (доля 1). */
  meaning: ScoredHit[][];
  /** Карточки точного имени — по каждому запросу; они в выдаче всегда первые. */
  exact: string[][];
}

export interface ServiceLists {
  /** Ключ (serviceKey) → по каждому запросу эталона — «набор:имя» первых карточек. */
  lists: Map<string, string[][]>;
  scored: ScoredLists;
  notes: string[];
  /** Почему списков нет: нет векторов запросов, отказ Meilisearch. */
  error?: string;
  /** Векторов запросов посчитано сейчас (остальные — из кэша). */
  fetched: number;
}

export interface ServiceOptions {
  client: MeiliClient;
  catalog: Catalog;
  queries: readonly GoldenQuery[];
  queryDir: string;
  embedClient?: EmbeddingClient;
  ratios?: readonly number[];
  depth?: number;
  log?: (line: string) => void;
}

/**
 * Глубина списка: при доле смысла из настроек — до CEILING_DEPTH, у остальных — depth. Первая десятка
 * от глубины не зависит: две выдачи сливаются по оценкам, и десятка слияния — из десяток частей.
 */
const depthOf = (ratio: number | undefined, depth: number) =>
  ratio === SEMANTIC_RATIO ? Math.max(depth, CEILING_DEPTH) : depth;

/** Списки сервиса по запросам эталона: только слова и гибрид при каждой доле смысла. */
export async function serviceLists(
  options: ServiceOptions,
): Promise<ServiceLists> {
  const { catalog, queries } = options;
  const ratios = options.ratios ?? ALPHA_GRID;
  const depth = options.depth ?? DEPTH;
  const keys = [serviceKey(), ...ratios.map((r) => serviceKey(r))];
  const out: ServiceLists = {
    lists: new Map(keys.map((k) => [k, []])),
    scored: { words: [], meaning: [], exact: [] },
    notes: [],
    fetched: 0,
  };
  const isSet = (id: string) => catalog.sets.some((s) => s.id === id);
  const texts = queries.map((q) =>
    normalizeText(stripSetPrefix(q.query, isSet)),
  );
  const exact = queries.map((q) => exactName(q.query));

  const qv = await queryVectors(searchEmbeddingModel(), texts, {
    dir: options.queryDir,
    ...(options.embedClient ? { client: options.embedClient } : {}),
  });
  out.fetched = qv.fetched;
  if (qv.vectors.some((v) => v === undefined)) {
    out.error = `нет векторов запросов сервиса — ${qv.error ?? "неизвестная причина"}`;
    return out;
  }
  const vectors = qv.vectors.map((v) =>
    truncateUnit(v as Float32Array, SEARCH_MODEL.dims),
  );

  const unknown = new Set<string>();
  const known = (id: string) => {
    if (catalog.byId.has(id)) return true;
    unknown.add(id);
    return false;
  };
  for (let start = 0; start < queries.length; start += QUERIES_PER_REQUEST) {
    const end = Math.min(queries.length, start + QUERIES_PER_REQUEST);
    const body: MultiSearchQuery[] = [];
    /** Списки с оценками: по два на запрос эталона, по порядку. */
    const scoredBody: MultiSearchQuery[] = [];
    /** По запросу эталона: место точного запроса и мест основной выдачи каждого ключа. */
    const plan: { exact?: number; main: Map<string, number> }[] = [];
    for (let i = start; i < end; i++) {
      const name = exact[i];
      const q = texts[i] as string;
      const step: { exact?: number; main: Map<string, number> } = {
        main: new Map(),
      };
      if (name !== undefined) {
        step.exact = body.length;
        body.push(exactQuery(name, {}));
      }
      const base = {
        q,
        filters: {},
        ...(name === undefined ? {} : { exclude: name }),
        start: 0,
      };
      step.main.set(serviceKey(), body.length);
      body.push(mainQuery({ ...base, limit: depth }));
      for (const r of ratios) {
        step.main.set(serviceKey(r), body.length);
        body.push(
          mainQuery({
            ...base,
            limit: depthOf(r, depth),
            vector: vectors[i],
            semanticRatio: r,
          }),
        );
      }
      plan.push(step);
      const scored = {
        q,
        filters: {},
        ...(name === undefined ? {} : { exclude: name }),
        limit: SCORED_DEPTH,
      };
      scoredBody.push(
        keywordQuery(scored),
        semanticQuery({ ...scored, vector: vectors[i] as Float32Array }),
      );
    }
    let results: SearchHit[][];
    let scored: ScoredHit[][];
    try {
      results = parseMultiSearch(
        await options.client.multiSearch(body),
        body.length,
      );
      scored = parseMultiSearch(
        await options.client.multiSearch(scoredBody),
        scoredBody.length,
        parseScoredHits,
      );
    } catch (e) {
      out.error = `Meilisearch: ${(e as Error).message}`;
      return out;
    }
    plan.forEach((step, k) => {
      const exactHits =
        step.exact === undefined ? [] : (results[step.exact] ?? []);
      for (const [key, at] of step.main) {
        const ratio = key === serviceKey() ? undefined : Number(key.slice(6));
        const limit = depthOf(ratio, depth);
        const ids = pageResults(exactHits, results[at] ?? [], 0, limit)
          .map((r) => r.icon)
          .filter(known);
        (out.lists.get(key) as string[][]).push(ids);
      }
      out.scored.exact.push(exactHits.map((h) => h.icon).filter(known));
      out.scored.words.push((scored[2 * k] ?? []).filter((h) => known(h.icon)));
      out.scored.meaning.push(
        (scored[2 * k + 1] ?? []).filter((h) => known(h.icon)),
      );
    });
    options.log?.(`  сервис: ответы на ${end} из ${queries.length} запросов`);
  }
  if (unknown.size > 0) {
    out.notes.push(
      `в индексе сервиса есть карточки, которых нет в data/: ${[...unknown].slice(0, 5).join(", ")}${unknown.size > 5 ? "…" : ""} — запустите pnpm search-index`,
    );
  }
  return out;
}

/** Место (с 1) первой подходящей карточки в списке; нет — undefined. */
export function firstFit(
  list: readonly string[],
  fits: ReadonlySet<string>,
): number | undefined {
  const i = list.findIndex((id) => fits.has(id));
  return i === -1 ? undefined : i + 1;
}

/** Список части поиска, как его видит человек: точные имена впереди, без повторов. */
export function withExact(
  exact: readonly string[],
  scored: readonly ScoredHit[],
): string[] {
  const seen = new Set(exact);
  return [...exact, ...scored.map((h) => h.icon).filter((id) => !seen.has(id))];
}
