// Поисковый сервис в замере (ADR-0049): ответы Meilisearch на запросы эталона — теми же телами
// multi-search, что строит функция edge API (общий модуль поиска), поэтому в замере та же выдача, что у
// пользователя. Списки: «только слова» — выдача «сначала текст», и гибрид при каждой доле смысла из
// сетки; при доле из настроек — глубже, до 30-го места: по ним размечаются места 11–30 худших запросов
// (шаг 8 фазы 4, ADR-0053). Отдельно — списки «только слова» и «только смысл» с оценками Meilisearch:
// на каком месте подходящая иконка у каждой части поиска. Вектор запроса — Gemini от нормализованного
// текста, первые 1024 числа; кэш — тот же, что у прототипа (.cache/search/queries).

import {
  EMBEDDER,
  exactName,
  exactQuery,
  INDEX_UID,
  keywordQuery,
  LIMIT_MAX,
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
import { VECTOR_NORM_RANK } from "../search/config.js";
import { queryVectors } from "../search/query-vectors.js";
import { ALPHA_GRID, CEILING_DEPTH, DEPTH, SCORED_DEPTH } from "./config.js";
import type { GoldenQuery } from "./golden.js";
import {
  convexSum,
  type Distribution,
  distributionOf,
  meiliMerge,
  type TieOf,
} from "./simulate.js";

/** Ключ списка сервиса: «text» — только слова, «ratio:0.3» — гибрид с долей смысла 0,3. */
export const serviceKey = (ratio?: number): string =>
  ratio === undefined ? "text" : `ratio:${ratio}`;

/**
 * Семейства опыта этапа 2 (ADR-0053): m — слияние Meilisearch с калибровкой шкалы смысла, c-abs и
 * c-rel — сумма слов и смысла с оценкой слов как есть и относительно лучшей в запросе.
 */
export const FAMILIES = ["m", "c-abs", "c-rel"] as const;
export type Family = (typeof FAMILIES)[number];
export const familyKey = (family: Family, x: number): string =>
  `${family}:${x}`;

/** Расхождение копии слияния Meilisearch с живой выдачей. */
export interface ReplicaMismatch {
  ratio: number;
  query: string;
  live: string[];
  replica: string[];
}

/** Опыт этапа 2: калибровка шкалы смысла и проверка копии слияния. */
export interface ExploreLists {
  /** Калибровка по рабочей части; нет — индекс уже с калибровкой или оценок рабочей части нет. */
  distribution?: Distribution;
  /**
   * Живой индекс уже с калибровкой: «как сейчас» — с ней, оценки смысла в списках уже сдвинуты, и
   * семейство M (калибровка поверх калибровки) не считается.
   */
  calibrated: boolean;
  /** Семейства опыта этого запуска. */
  families: Family[];
  /** Сколько пар «запрос × доля» сверено с живой выдачей. */
  checked: number;
  mismatches: ReplicaMismatch[];
}

/** Запросов эталона в одном multi-search: тело ≈ 20 × 11 векторов × 10 КБ. */
export const QUERIES_PER_REQUEST = 20;

/** Списки с оценками Meilisearch — по каждому запросу эталона, без карточек точного имени. */
export interface ScoredLists {
  /** Только слова. */
  words: ScoredHit[][];
  /** Только смысл (доля 1). */
  meaning: ScoredHit[][];
  /**
   * Только смысл той же глубины, что у живых запросов гибрида (10 и 30), — для сверки копии
   * слияния: поиск соседей приближённый, первые места зависят от глубины. Только с explore.
   */
  meaningAt?: Map<number, ScoredHit[][]>;
  /** Карточки точного имени — по каждому запросу; они в выдаче всегда первые. */
  exact: string[][];
}

export interface ServiceLists {
  /** Ключ (serviceKey) → по каждому запросу эталона — «набор:имя» первых карточек. */
  lists: Map<string, string[][]>;
  scored: ScoredLists;
  /** Опыт этапа 2 — только с explore. */
  explore?: ExploreLists;
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
  /** Опыт этапа 2 (ADR-0053): семейства M, C-abs и C-rel из списков с оценками. */
  explore?: boolean;
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

  // Глубины живых запросов гибрида: «смысл» той же глубины — для сверки копии слияния (explore).
  const liveDepths = options.explore
    ? [...new Set(ratios.map((r) => depthOf(r, depth)))]
    : [];
  /** Списков с оценками на запрос эталона: слова, смысл и смысл каждой живой глубины. */
  const per = 2 + liveDepths.length;
  if (options.explore) {
    out.scored.meaningAt = new Map(liveDepths.map((l) => [l, []]));
  }
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
      const vector = vectors[i] as Float32Array;
      scoredBody.push(
        keywordQuery(scored),
        semanticQuery({ ...scored, vector }),
        // Поиск соседей приближённый: первые места зависят от глубины запроса. Копия слияния
        // сверяется со «смыслом» той же глубины, что у живого запроса.
        ...liveDepths.map((limit) =>
          semanticQuery({ ...scored, limit, vector }),
        ),
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
      const at = per * k;
      const keep = (list: ScoredHit[] | undefined) =>
        (list ?? []).filter((h) => known(h.icon));
      out.scored.exact.push(exactHits.map((h) => h.icon).filter(known));
      out.scored.words.push(keep(scored[at]));
      out.scored.meaning.push(keep(scored[at + 1]));
      liveDepths.forEach((limit, j) => {
        out.scored.meaningAt?.get(limit)?.push(keep(scored[at + 2 + j]));
      });
    });
    options.log?.(`  сервис: ответы на ${end} из ${queries.length} запросов`);
  }
  if (unknown.size > 0) {
    out.notes.push(
      `в индексе сервиса есть карточки, которых нет в data/: ${[...unknown].slice(0, 5).join(", ")}${unknown.size > 5 ? "…" : ""} — запустите pnpm search-index`,
    );
  }
  if (options.explore) {
    let calibrated = false;
    try {
      const settings = await options.client.settings(INDEX_UID);
      const embedders = settings.embedders as
        | Record<string, { distribution?: unknown } | undefined>
        | undefined;
      calibrated = embedders?.[EMBEDDER]?.distribution != null;
    } catch (e) {
      out.error = `Meilisearch: настройки индекса — ${(e as Error).message}`;
      return out;
    }
    explore(out, options, ratios, depth, calibrated);
  }
  return out;
}

/** Ничьи слияния — как правила индекса: parts — из каталога, setOrder — место набора в реестре. */
export function tieOf(catalog: Catalog): TieOf {
  const setOrder = new Map(catalog.sets.map((s, k) => [s.id, k]));
  return (icon) => ({
    parts: catalog.parts[catalog.byId.get(icon) ?? -1] ?? 1,
    setOrder: setOrder.get(icon.slice(0, icon.indexOf(":"))) ?? 0,
  });
}

/** Выдача, как её видит человек: точные имена впереди, без повторов, первые limit. */
const page = (
  exact: readonly string[],
  main: readonly string[],
  limit: number,
) => [...exact, ...main.filter((id) => !exact.includes(id))].slice(0, limit);

/**
 * Опыт этапа 2 (ADR-0053): калибровка шкалы смысла по рабочей части, проверка копии слияния
 * Meilisearch на всех долях сетки и списки семейств M, C-abs и C-rel. Страница — как на сайте, 96
 * мест: от неё зависит короткий путь «слова и так хороши»; в списки идут первые depth.
 */
function explore(
  out: ServiceLists,
  options: ServiceOptions,
  ratios: readonly number[],
  depth: number,
  calibrated: boolean,
) {
  const { queries } = options;
  const tie = tieOf(options.catalog);
  const { words, meaning, exact } = out.scored;
  const work = queries.flatMap((q, i) => (q.split === "work" ? [i] : []));
  // Индекс уже с калибровкой — оценки смысла в списках сдвинуты, своя калибровка поверх неё
  // бессмысленна; нет оценок рабочей части — считать не из чего. Тогда ни калибровки, ни семейства M
  // (ревизия фазы 5, И-21).
  const scores = calibrated
    ? []
    : work.flatMap((i) =>
        (meaning[i] ?? []).slice(0, VECTOR_NORM_RANK).map((h) => h.score),
      );
  const distribution = scores.length > 0 ? distributionOf(scores) : undefined;
  const families: Family[] =
    distribution === undefined
      ? FAMILIES.filter((f) => f !== "m")
      : [...FAMILIES];
  const result: ExploreLists = {
    ...(distribution === undefined ? {} : { distribution }),
    calibrated,
    families,
    checked: 0,
    mismatches: [],
  };
  // Копия без калибровки обязана повторить живую выдачу — с той же глубиной, что у живого запроса.
  for (const r of ratios) {
    const live = out.lists.get(serviceKey(r)) ?? [];
    const limit = depthOf(r, depth);
    const sameDepth = out.scored.meaningAt?.get(limit) ?? meaning;
    queries.forEach((q, i) => {
      const replica = page(
        exact[i] ?? [],
        meiliMerge(words[i] ?? [], sameDepth[i] ?? [], tie, {
          ratio: r,
          limit,
        }),
        limit,
      );
      const shown = live[i] ?? [];
      result.checked++;
      if (replica.join(" ") !== shown.join(" ")) {
        result.mismatches.push({
          ratio: r,
          query: q.id,
          live: shown,
          replica,
        });
      }
    });
  }
  // M — та же глубина, что у «как сейчас» (живой гибрид, depth мест): после перехода на калибровку
  // замер сервиса покажет ровно эти списки. Суммам нужна сотня мест смысла — у них глубокий список и
  // страница сайта.
  const sameDepth = out.scored.meaningAt?.get(depth) ?? meaning;
  for (const x of ratios) {
    const lists = {
      m: [] as string[][],
      "c-abs": [] as string[][],
      "c-rel": [] as string[][],
    };
    queries.forEach((_q, i) => {
      const w = words[i] ?? [];
      const m = meaning[i] ?? [];
      const ex = exact[i] ?? [];
      if (distribution !== undefined) {
        lists.m.push(
          page(
            ex,
            meiliMerge(w, sameDepth[i] ?? [], tie, {
              ratio: x,
              limit: depth,
              distribution,
            }),
            depth,
          ),
        );
      }
      for (const text of ["abs", "rel"] as const) {
        lists[`c-${text}`].push(
          page(
            ex,
            convexSum(w, m, tie, {
              alpha: x,
              text,
              limit: LIMIT_MAX,
              normRank: VECTOR_NORM_RANK,
            }),
            depth,
          ),
        );
      }
    });
    for (const family of families) {
      out.lists.set(familyKey(family, x), lists[family]);
    }
  }
  out.explore = result;
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
