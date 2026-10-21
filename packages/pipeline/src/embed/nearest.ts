// Команда pnpm nearest (шаг 11, ADR-0047): вектор запроса той же моделью → скалярное произведение
// со всеми векторами иконок → ближайшие. Векторы длины 1, поэтому произведение — косинус угла между
// ними: 1 — смысл совпадает, около 0 — не связан. Модели грузятся по одной: векторы Qwen — 257 МБ.

import type { NormalizedIcon } from "../normalize/normalize.js";
import type { SourceConfig } from "../sources/config.js";
import { type EmbeddingClient, errorScope } from "./client.js";
import { type EmbeddingModel, MODELS, TOP_PAGE } from "./config.js";
import { loadTexts, type SetTexts } from "./run.js";
import { readStore } from "./store.js";
import { queryInput } from "./text.js";

export interface Neighbor {
  set: string;
  name: string;
  /** Похожесть: скалярное произведение векторов длины 1. */
  score: number;
  icon?: NormalizedIcon;
}

export interface VectorSet {
  id: string;
  names: readonly string[];
  /** names.length × dims чисел подряд. */
  vectors: Float32Array;
}

const keyOf = (n: { set: string; name: string }) => `${n.set}:${n.name}`;

/** k ближайших; при равной похожести — по «набор:имя», чтобы порядок не зависел от случая. */
export function topK(
  sets: readonly VectorSet[],
  dims: number,
  query: Float32Array,
  k: number,
): Neighbor[] {
  const best: Neighbor[] = [];
  const before = (a: Neighbor, b: Neighbor) =>
    a.score > b.score || (a.score === b.score && keyOf(a) < keyOf(b));
  for (const s of sets) {
    for (let row = 0; row < s.names.length; row++) {
      const offset = row * dims;
      let dot = 0;
      for (let j = 0; j < dims; j++) {
        dot += (query[j] as number) * (s.vectors[offset + j] as number);
      }
      const last = best[best.length - 1];
      if (best.length >= k && last && dot < last.score) continue;
      const candidate: Neighbor = {
        set: s.id,
        name: s.names[row] as string,
        score: dot,
      };
      if (best.length >= k && last && !before(candidate, last)) continue;
      let i = best.length;
      while (i > 0 && before(candidate, best[i - 1] as Neighbor)) i--;
      best.splice(i, 0, candidate);
      if (best.length > k) best.pop();
    }
  }
  return best;
}

/** Сколько иконок первых n совпало в двух списках. */
export function overlap(
  a: readonly Neighbor[],
  b: readonly Neighbor[],
  n: number,
): number {
  const keys = new Set(b.slice(0, n).map(keyOf));
  return a.slice(0, n).filter((x) => keys.has(keyOf(x))).length;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export interface QueryResult {
  query: string;
  neighbors: Neighbor[];
  /** Время ответа модели на этот запрос, мс. */
  ms: number;
}

export interface ModelNearest {
  model: EmbeddingModel;
  results: QueryResult[];
  /** Время ответа без первого, «разогревочного», запроса. */
  latencies: number[];
  /** Векторов загружено; сколько иконок с устаревшим вектором и сколько без вектора. */
  vectors: number;
  stale: number;
  absent: number;
  notes: string[];
  stop: string[];
}

export interface NearestReport {
  queries: string[];
  models: ModelNearest[];
  /** Наборы, которые не прочитались. */
  errors: { id: string; message: string }[];
  /** Остановка всего прогона: ключ, баланс. */
  stop: string[];
}

export interface NearestOptions {
  client: EmbeddingClient;
  storeDir: string;
  queries: readonly string[];
  models?: readonly EmbeddingModel[];
  k?: number;
  log?: (line: string) => void;
}

export const nearestStop = (r: NearestReport): boolean =>
  r.stop.length > 0 || r.models.some((m) => m.stop.length > 0);

/** Ближайшие иконки для каждого запроса по каждой модели. */
export async function nearestQueries(
  configs: readonly SourceConfig[],
  dataDir: string,
  options: NearestOptions,
): Promise<NearestReport> {
  const log = options.log ?? (() => {});
  const k = options.k ?? TOP_PAGE;
  const { texts, errors } = await loadTexts(configs, dataDir);
  const byId = new Map<string, SetTexts>(texts.map((t) => [t.config.id, t]));
  const report: NearestReport = {
    queries: [...options.queries],
    models: [],
    errors,
    stop: [],
  };
  for (const model of options.models ?? MODELS) {
    if (report.stop.length > 0) break;
    const mn: ModelNearest = {
      model,
      results: [],
      latencies: [],
      vectors: 0,
      stale: 0,
      absent: 0,
      notes: [],
      stop: [],
    };
    report.models.push(mn);
    const sets: VectorSet[] = [];
    for (const t of texts) {
      const read = await readStore(options.storeDir, model, t.config.id);
      if (read.kind !== "ok") {
        mn.absent += t.items.length;
        if (read.kind === "broken") {
          mn.notes.push(`${t.config.id}: ${read.reason}`);
        }
        continue;
      }
      const { index, vectors } = read.store;
      const stored = new Map(index.rows.map((r) => [r.name, r.textHash]));
      for (const it of t.items) {
        const hash = stored.get(it.name);
        if (hash === undefined) mn.absent++;
        else if (hash !== it.hash) mn.stale++;
      }
      mn.vectors += index.count;
      sets.push({
        id: t.config.id,
        names: index.rows.map((r) => r.name),
        vectors,
      });
    }
    if (mn.vectors === 0) {
      mn.notes.push(
        `нет векторов модели — запустите pnpm embed --model=${model.key}`,
      );
      continue;
    }
    if (mn.stale > 0 || mn.absent > 0) {
      mn.notes.push(
        `векторы устарели у ${mn.stale} иконок, нет у ${mn.absent} — запустите pnpm embed --model=${model.key}`,
      );
    }
    log(
      `${model.key}: векторов ${mn.vectors}, запросов ${report.queries.length}`,
    );
    for (const [i, query] of report.queries.entries()) {
      try {
        const res = await options.client.embed(model, [
          queryInput(model, query),
        ]);
        const vector = res.vectors[0];
        if (!vector) throw new Error("в ответе нет вектора");
        const neighbors = topK(sets, model.dims, vector, k);
        for (const n of neighbors) {
          const icon = byId.get(n.set)?.set.icons.get(n.name);
          if (icon) n.icon = icon;
        }
        mn.results.push({ query, neighbors, ms: res.ms });
        if (i > 0 || report.queries.length === 1) mn.latencies.push(res.ms);
      } catch (e) {
        const message = (e as Error).message;
        if (errorScope(e) === "run") report.stop.push(message);
        else mn.stop.push(message);
        break;
      }
    }
  }
  return report;
}
