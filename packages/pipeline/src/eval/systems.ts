// Варианты замера (шаг 12, ADR-0048): один список на pnpm judge и pnpm eval. Судья размечает всё, что
// попадает в первые десятки этих вариантов, поэтому замер всегда опирается на размеченное. Главные
// варианты — «Текст», «Смысл» и «Гибрид» каждой модели; служебные — сетка α, длины вектора и фильтр
// по наборам для выбранной модели.

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

export type Role = "main" | "alpha" | "length" | "set";

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
}

export interface Choice {
  /** Доля смысловой части каждой модели — подобранная или из настроек. */
  alpha: ReadonlyMap<string, number>;
  /** Длина вектора каждой модели для главного гибрида. */
  length: ReadonlyMap<string, number>;
  /** Модель для фильтра по наборам; нет — фильтра нет. */
  chosen?: string;
}

/** α и длина из настроек поиска (search/config.ts). */
export function configChoice(
  models: readonly EmbeddingModel[],
  chosen?: string,
): Choice {
  const alpha = new Map<string, number>();
  const length = new Map<string, number>();
  for (const m of models) {
    alpha.set(m.key, MODEL_SEARCH[m.key]?.alpha ?? 0.5);
    length.set(m.key, MODEL_SEARCH[m.key]?.length ?? m.dims);
  }
  return chosen === undefined ? { alpha, length } : { alpha, length, chosen };
}

const fraction = (n: number) => n.toFixed(1).replace(".", ",");

/** Длины модели для замера: укороченные из конфига и полная. */
export const modelLengths = (m: EmbeddingModel): number[] => [
  ...(LENGTHS[m.key] ?? []).filter((l) => l < m.dims),
  m.dims,
];

/** Все варианты замера. */
export function systems(
  models: readonly EmbeddingModel[],
  choice: Choice,
  sets: readonly string[],
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
    if (choice.chosen === m.key) {
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
  for (const def of defs.filter((d) => d.model === undefined)) {
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
    const own = defs.filter((d) => d.model === model.key);
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
 * Доля смысловой части каждой модели по рабочей части (ADR-0048). Только когда первые десятки
 * сетки α на рабочей части размечены целиком: иначе подбор шёл бы по неполной разметке.
 */
export function tuneAlphas(
  rankings: Rankings,
  queries: readonly GoldenQuery[],
  labels: Labels,
  models: readonly EmbeddingModel[],
): Map<string, Tuned> | undefined {
  const work = queries
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.split === "work");
  if (work.length === 0) return undefined;
  const out = new Map<string, Tuned>();
  for (const m of models) {
    const curve: CurvePoint[] = [];
    for (const a of ALPHA_GRID) {
      const list = rankings.lists.get(`alpha:${m.key}@${a}`);
      if (!list) return undefined;
      const rows = [];
      for (const { q, i } of work) {
        const ranked = list[i] ?? [];
        const known = labels.byQuery.get(q.id);
        if (ranked.length === 0 || ranked.some((id) => !known?.has(id))) {
          return undefined;
        }
        const fits = fitsOf(labels, q.id);
        if (fits.size > 0) rows.push({ ranked, fits });
      }
      const s = summarize(rows);
      curve.push({ alpha: a, hit: s.hit, mrr: s.mrr });
    }
    out.set(m.key, { alpha: pickAlpha(curve), curve });
  }
  return out;
}
