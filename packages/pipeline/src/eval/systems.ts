// Варианты замера (шаг 12, ADR-0048): один список на pnpm judge и pnpm eval. Судья размечает всё, что
// попадает в первые десятки этих вариантов, поэтому замер всегда опирается на размеченное. Главные
// варианты — «Текст», «Смысл» и «Гибрид» каждой модели; служебные — сетка α, длины вектора и фильтр
// по наборам для выбранной модели. Поисковый сервис (ADR-0049) — «Сервис» и «Сервис, только слова»
// плюс сетка доли смысла; их списки приходят из Meilisearch готовыми (eval/service.ts).

import { SEARCH_MODEL } from "@iconavo-ui/search";
import type { EmbeddingModel } from "../embed/config.js";
import type { Catalog } from "../search/catalog.js";
import { MODEL_SEARCH } from "../search/config.js";
import {
  type Mode,
  type Prepared,
  prepare,
  rankPrepared,
  textQuery,
} from "../search/hybrid.js";
import { searchText, type TextIndex, type TextResult } from "../search/text.js";
import { cosines, loadModelVectors } from "../search/vectors.js";
import { ALPHA_GRID, DEPTH, LENGTHS, SET_DEPTH } from "./config.js";
import { fitsOf, type GoldenQuery, type Labels } from "./golden.js";
import { type CurvePoint, pickAlpha, summarize } from "./metrics.js";

export type Role = "main" | "alpha" | "length" | "set" | "ratio";

export interface System {
  key: string;
  /** Подпись в отчёте. */
  title: string;
  mode: Mode;
  model?: string;
  alpha: number;
  /** Длина вектора; нет — полная. */
  length?: number;
  set?: string;
  /** Сколько первых карточек размечается и хранится. */
  depth: number;
  role: Role;
  /** Списки варианта приходят готовыми — от поискового сервиса, а не из прототипа. */
  remote?: true;
}

/** Ключи вариантов поискового сервиса. */
export const SERVICE_KEY = "service:gemini";
export const SERVICE_TEXT_KEY = "service-text:gemini";
export const ratioKey = (ratio: number) => `ratio:gemini@${ratio}`;

export interface Choice {
  /** Доля смысловой части каждой модели — подобранная или из настроек. */
  alpha: ReadonlyMap<string, number>;
  /** Длина вектора каждой модели для главного гибрида. */
  length: ReadonlyMap<string, number>;
  /** Модель для замера с фильтром по наборам; нет — такого замера нет. */
  perSetModel?: string;
}

/** α и длина из настроек поиска (search/config.ts). */
export function configChoice(
  models: readonly EmbeddingModel[],
  perSetModel?: string,
): Choice {
  const alpha = new Map<string, number>();
  const length = new Map<string, number>();
  for (const m of models) {
    alpha.set(m.key, MODEL_SEARCH[m.key]?.alpha ?? 0.5);
    length.set(m.key, MODEL_SEARCH[m.key]?.length ?? m.dims);
  }
  return perSetModel === undefined
    ? { alpha, length }
    : { alpha, length, perSetModel };
}

const fraction = (n: number) => n.toFixed(1).replace(".", ",");

/** Длины модели для замера: укороченные из конфига и полная. */
export const modelLengths = (m: EmbeddingModel): number[] => [
  ...(LENGTHS[m.key] ?? []).filter((l) => l < m.dims),
  m.dims,
];

/** Все варианты замера; service — доля смысла сервиса, нет — сервис не меряется. */
export function systems(
  models: readonly EmbeddingModel[],
  choice: Choice,
  sets: readonly string[],
  service?: { ratio: number },
): System[] {
  const out: System[] = [
    {
      key: "text",
      title: "Текст",
      mode: "text",
      alpha: 0,
      depth: DEPTH,
      role: "main",
    },
  ];
  for (const m of models) {
    const alpha = choice.alpha.get(m.key) ?? 0.5;
    const length = choice.length.get(m.key) ?? m.dims;
    out.push(
      {
        key: `vector:${m.key}`,
        title: `Смысл ${m.key}`,
        mode: "vector",
        model: m.key,
        alpha: 1,
        depth: DEPTH,
        role: "main",
      },
      {
        key: `hybrid:${m.key}`,
        title: `Гибрид ${m.key}`,
        mode: "hybrid",
        model: m.key,
        alpha,
        length,
        depth: DEPTH,
        role: "main",
      },
    );
    for (const a of ALPHA_GRID) {
      out.push({
        key: `alpha:${m.key}@${a}`,
        title: `Гибрид ${m.key}, α ${fraction(a)}`,
        mode: "hybrid",
        model: m.key,
        alpha: a,
        depth: DEPTH,
        role: "alpha",
      });
    }
    for (const l of modelLengths(m)) {
      out.push({
        key: `length:${m.key}/${l}`,
        title: `Гибрид ${m.key}, длина ${l}`,
        mode: "hybrid",
        model: m.key,
        alpha,
        length: l,
        depth: DEPTH,
        role: "length",
      });
    }
    if (choice.perSetModel === m.key) {
      for (const set of sets) {
        out.push({
          key: `set:${m.key}|${set}`,
          title: `Гибрид ${m.key}, только ${set}`,
          mode: "hybrid",
          model: m.key,
          alpha,
          length,
          set,
          depth: SET_DEPTH,
          role: "set",
        });
      }
    }
  }
  if (service !== undefined) {
    out.push(
      {
        key: SERVICE_KEY,
        title: "Сервис",
        mode: "hybrid",
        alpha: service.ratio,
        length: SEARCH_MODEL.dims,
        depth: DEPTH,
        role: "main",
        remote: true,
      },
      {
        key: SERVICE_TEXT_KEY,
        title: "Сервис, только слова",
        mode: "text",
        alpha: 0,
        depth: DEPTH,
        role: "main",
        remote: true,
      },
    );
    for (const r of ALPHA_GRID) {
      out.push({
        key: ratioKey(r),
        title: `Сервис, доля смысла ${fraction(r)}`,
        mode: "hybrid",
        alpha: r,
        length: SEARCH_MODEL.dims,
        depth: DEPTH,
        role: "ratio",
        remote: true,
      });
    }
  }
  return out;
}

export interface RankingInput {
  catalog: Catalog;
  text: TextIndex;
  queries: readonly GoldenQuery[];
  /** Векторы запросов по ключу модели — в порядке queries. */
  vectors: ReadonlyMap<string, readonly (Float32Array | undefined)[]>;
  models: readonly EmbeddingModel[];
  storeDir: string;
  /** Готовые списки сервиса по ключу eval/service.ts (serviceKey); нет — варианты сервиса пусты. */
  remote?: ReadonlyMap<string, readonly string[][]>;
  log?: (line: string) => void;
}

export interface Rankings {
  /** Ключ варианта → по каждому запросу (в порядке queries) — «набор:имя» первых depth карточек. */
  lists: Map<string, string[][]>;
  /** Заметки загрузки векторов: устаревшие и отсутствующие. */
  notes: string[];
}

/**
 * Первые карточки каждого варианта по каждому запросу. Векторы грузятся по одной модели: в памяти —
 * векторы одной модели, до 257 МБ у Qwen.
 */
export async function rankAll(
  input: RankingInput,
  defs: readonly System[],
): Promise<Rankings> {
  const { catalog, queries } = input;
  const log = input.log ?? (() => {});
  const lists = new Map<string, string[][]>(defs.map((d) => [d.key, []]));
  const notes: string[] = [];
  const ids = (ranked: { doc: number }[]) =>
    ranked.map((r) => catalog.docs[r.doc]?.id as string);
  const texts = queries.map((q) =>
    searchText(input.text, textQuery(catalog, q.query)),
  );
  // Варианты сервиса — готовыми списками: «только слова» и гибрид при своей доле смысла.
  for (const def of defs.filter((d) => d.remote)) {
    const key = def.mode === "text" ? "text" : `ratio:${def.alpha}`;
    const list = input.remote?.get(key);
    lists.set(
      def.key,
      list ? list.map((ids) => [...ids]) : queries.map(() => []),
    );
  }
  for (const def of defs.filter((d) => d.model === undefined && !d.remote)) {
    const list = lists.get(def.key) as string[][];
    queries.forEach((q, i) => {
      const p = prepare(
        catalog,
        q.query,
        texts[i] as TextResult,
        undefined,
        def.set,
      );
      list.push(ids(rankPrepared(p, def.mode, def.alpha, def.depth)));
    });
  }
  for (const model of input.models) {
    const own = defs.filter((d) => d.model === model.key && !d.remote);
    if (own.length === 0) continue;
    const lengths = own
      .map((d) => d.length)
      .filter((l): l is number => l !== undefined);
    const mv = await loadModelVectors(catalog, model, input.storeDir, lengths);
    notes.push(...mv.notes.map((n) => `${model.key}: ${n}`));
    log(`${model.key}: варианты замера по ${queries.length} запросам`);
    const vectors = input.vectors.get(model.key) ?? [];
    queries.forEach((q, i) => {
      const vector = vectors[i];
      const cos = vector ? cosines(mv, vector) : undefined;
      const prepared = new Map<string, Prepared>();
      for (const def of own) {
        const k = mv.lengths.indexOf(def.length ?? model.dims);
        const key = `${k}|${def.set ?? ""}`;
        let p = prepared.get(key);
        if (!p) {
          p = prepare(
            catalog,
            q.query,
            texts[i] as TextResult,
            cos?.[Math.max(0, k)],
            def.set,
          );
          prepared.set(key, p);
        }
        // Без вектора запроса гибрид и смысл не считаются — список пуст, замер его не примет.
        (lists.get(def.key) as string[][]).push(
          cos ? ids(rankPrepared(p, def.mode, def.alpha, def.depth)) : [],
        );
      }
    });
  }
  return { lists, notes };
}

/** Пары «запрос × карточка» из первых мест вариантов, у которых ещё нет вердикта. */
export function unlabeled(
  rankings: Rankings,
  defs: readonly System[],
  queries: readonly GoldenQuery[],
  labels: Labels,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const def of defs) {
    const list = rankings.lists.get(def.key) ?? [];
    queries.forEach((q, i) => {
      const known = labels.byQuery.get(q.id);
      for (const id of (list[i] ?? []).slice(0, def.depth)) {
        if (known?.has(id)) continue;
        const set = out.get(q.id) ?? new Set<string>();
        set.add(id);
        out.set(q.id, set);
      }
    });
  }
  return out;
}

export interface Tuned {
  alpha: number;
  /** Hit@5 и MRR@10 на рабочей части по сетке α. */
  curve: CurvePoint[];
}

/**
 * Кривая по сетке на рабочей части: только когда первые десятки всех точек размечены целиком, иначе
 * подбор шёл бы по неполной разметке. Пустой список у прототипа значит «нет вектора запроса», а у
 * сервиса — честное «ничего не нашлось»: при доле смысла 0 ищутся только слова (allowEmpty).
 */
function workCurve(
  rankings: Rankings,
  queries: readonly GoldenQuery[],
  labels: Labels,
  keyOf: (a: number) => string,
  allowEmpty = false,
): CurvePoint[] | undefined {
  const work = queries
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.split === "work");
  if (work.length === 0) return undefined;
  const curve: CurvePoint[] = [];
  for (const a of ALPHA_GRID) {
    const list = rankings.lists.get(keyOf(a));
    if (!list) return undefined;
    const rows = [];
    for (const { q, i } of work) {
      const ranked = list[i] ?? [];
      const known = labels.byQuery.get(q.id);
      if (
        (ranked.length === 0 && !allowEmpty) ||
        ranked.some((id) => !known?.has(id))
      ) {
        return undefined;
      }
      const fits = fitsOf(labels, q.id);
      if (fits.size > 0) rows.push({ ranked, fits });
    }
    const s = summarize(rows);
    curve.push({ alpha: a, hit: s.hit, mrr: s.mrr });
  }
  return curve;
}

/** Доля смысла сервиса по рабочей части — по тому же правилу, что α прототипа (ADR-0049). */
export function tuneRatio(
  rankings: Rankings,
  queries: readonly GoldenQuery[],
  labels: Labels,
): Tuned | undefined {
  const curve = workCurve(rankings, queries, labels, ratioKey, true);
  return curve ? { alpha: pickAlpha(curve), curve } : undefined;
}

/**
 * Доля смысловой части каждой модели по рабочей части (ADR-0048). Только когда первые десятки
 * сетки α на рабочей части размечены целиком: иначе подбор шёл бы по неполной разметке.
 */
export function tuneAlphas(
  rankings: Rankings,
  queries: readonly GoldenQuery[],
  labels: Labels,
  models: readonly EmbeddingModel[],
): Map<string, Tuned> | undefined {
  const out = new Map<string, Tuned>();
  for (const m of models) {
    const curve = workCurve(
      rankings,
      queries,
      labels,
      (a) => `alpha:${m.key}@${a}`,
    );
    if (!curve) return undefined;
    out.set(m.key, { alpha: pickAlpha(curve), curve });
  }
  return out;
}
