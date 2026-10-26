// Поисковый сервис в замере (ADR-0049): ответы Meilisearch на запросы эталона — теми же телами
// multi-search, что строит функция edge API (общий модуль поиска), поэтому в замере та же выдача, что у
// пользователя. Списки: «только слова» — выдача «сначала текст», и гибрид при каждой доле смысла из
// сетки. Вектор запроса — Gemini от нормализованного текста, первые 1024 числа; кэш — тот же, что у
// прототипа (.cache/search/queries).

import {
  exactName,
  exactQuery,
  type MultiSearchQuery,
  mainQuery,
  normalizeText,
  pageResults,
  parseMultiSearch,
  SEARCH_MODEL,
  stripSetPrefix,
  truncateUnit,
} from "@iconavo-ui/search";
import type { EmbeddingClient } from "../embed/client.js";
import type { MeiliClient } from "../meili/client.js";
import { searchEmbeddingModel } from "../meili/embed.js";
import type { Catalog } from "../search/catalog.js";
import { queryVectors } from "../search/query-vectors.js";
import { ALPHA_GRID, DEPTH } from "./config.js";
import type { GoldenQuery } from "./golden.js";

/** Ключ списка сервиса: «text» — только слова, «ratio:0.3» — гибрид с долей смысла 0,3. */
export const serviceKey = (ratio?: number): string =>
  ratio === undefined ? "text" : `ratio:${ratio}`;

/** Запросов эталона в одном multi-search: тело ≈ 20 × 11 векторов × 10 КБ. */
export const QUERIES_PER_REQUEST = 20;

export interface ServiceLists {
  /** Ключ (serviceKey) → по каждому запросу эталона — «набор:имя» первых карточек. */
  lists: Map<string, string[][]>;
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
  for (let start = 0; start < queries.length; start += QUERIES_PER_REQUEST) {
    const body: MultiSearchQuery[] = [];
    /** По запросу эталона: место точного запроса и мест основной выдачи каждого ключа. */
    const plan: { exact?: number; main: Map<string, number> }[] = [];
    for (
      let i = start;
      i < Math.min(queries.length, start + QUERIES_PER_REQUEST);
      i++
    ) {
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
        limit: depth,
      };
      step.main.set(serviceKey(), body.length);
      body.push(mainQuery(base));
      for (const r of ratios) {
        step.main.set(serviceKey(r), body.length);
        body.push(mainQuery({ ...base, vector: vectors[i], semanticRatio: r }));
      }
      plan.push(step);
    }
    let results: ReturnType<typeof parseMultiSearch>;
    try {
      results = parseMultiSearch(
        await options.client.multiSearch(body),
        body.length,
      );
    } catch (e) {
      out.error = `Meilisearch: ${(e as Error).message}`;
      return out;
    }
    for (const step of plan) {
      const exactHits =
        step.exact === undefined ? [] : (results[step.exact] ?? []);
      for (const [key, at] of step.main) {
        const ids = pageResults(exactHits, results[at] ?? [], 0, depth)
          .map((r) => r.icon)
          .filter((id) => {
            if (catalog.byId.has(id)) return true;
            unknown.add(id);
            return false;
          });
        (out.lists.get(key) as string[][]).push(ids);
      }
    }
    options.log?.(
      `  сервис: ответы на ${Math.min(queries.length, start + QUERIES_PER_REQUEST)} из ${queries.length} запросов`,
    );
  }
  if (unknown.size > 0) {
    out.notes.push(
      `в индексе сервиса есть карточки, которых нет в data/: ${[...unknown].slice(0, 5).join(", ")}${unknown.size > 5 ? "…" : ""} — запустите pnpm search-index`,
    );
  }
  return out;
}
