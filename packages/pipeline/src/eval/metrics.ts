// Метрики замера (ADR-0021, ADR-0048): Hit@5 — есть ли подходящая иконка в первой пятёрке, MRR@10 —
// насколько высоко стоит первая подходящая, P@5 — сколько из пятёрки подходят. Интервал Уилсона
// показывает погрешность доли, точный тест Мак-Немара — надёжна ли разница двух вариантов на одних и
// тех же запросах. Подбор α и длины вектора — по правилам, записанным до замера.

import { HIT_K, MRR_K } from "./config.js";

export const hitAt = (
  ranked: readonly string[],
  fits: ReadonlySet<string>,
  k = HIT_K,
): boolean => ranked.slice(0, k).some((id) => fits.has(id));

/** 1 / место первой подходящей в первых k; нет такой — 0. */
export function reciprocalRank(
  ranked: readonly string[],
  fits: ReadonlySet<string>,
  k = MRR_K,
): number {
  const i = ranked.slice(0, k).findIndex((id) => fits.has(id));
  return i === -1 ? 0 : 1 / (i + 1);
}

/** Доля подходящих в первых k; мест меньше k — пустые не подходят. */
export const precisionAt = (
  ranked: readonly string[],
  fits: ReadonlySet<string>,
  k = HIT_K,
): number => ranked.slice(0, k).filter((id) => fits.has(id)).length / k;

/** Интервал Уилсона для доли successes из n, 95% по умолчанию. */
export function wilson(
  successes: number,
  n: number,
  z = 1.96,
): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface Summary {
  n: number;
  /** Запросов с подходящей иконкой в пятёрке. */
  hits: number;
  hit: number;
  low: number;
  high: number;
  mrr: number;
  p5: number;
}

export interface Row {
  ranked: readonly string[];
  fits: ReadonlySet<string>;
}

export function summarize(rows: readonly Row[]): Summary {
  const n = rows.length;
  const hits = rows.filter((r) => hitAt(r.ranked, r.fits)).length;
  const mean = (f: (r: Row) => number) =>
    n === 0 ? 0 : rows.reduce((s, r) => s + f(r), 0) / n;
  const { low, high } = wilson(hits, n);
  return {
    n,
    hits,
    hit: n === 0 ? 0 : hits / n,
    low,
    high,
    mrr: mean((r) => reciprocalRank(r.ranked, r.fits)),
    p5: mean((r) => precisionAt(r.ranked, r.fits)),
  };
}

/** Биномиальные коэффициенты без переполнения: сумма вероятностей хвоста считается в логарифмах. */
function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

export interface Paired {
  /** Нашёл только первый, только второй. */
  onlyA: number;
  onlyB: number;
  /** Точный двусторонний тест Мак-Немара: вероятность такой разницы случайно. */
  p: number;
}

/** Сравнение двух вариантов на одних и тех же запросах: где нашёл только один из них. */
export function paired(a: readonly boolean[], b: readonly boolean[]): Paired {
  let onlyA = 0;
  let onlyB = 0;
  a.forEach((x, i) => {
    const y = b[i] === true;
    if (x && !y) onlyA++;
    if (!x && y) onlyB++;
  });
  const n = onlyA + onlyB;
  const k = Math.min(onlyA, onlyB);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return { onlyA, onlyB, p: n === 0 ? 1 : Math.min(1, 2 * tail) };
}

export interface CurvePoint {
  alpha: number;
  hit: number;
  mrr: number;
}

const EPS = 1e-9;

/**
 * Доля смысловой части (ADR-0048): лучшие по Hit@5 точки сетки идут плато; из плато с лучшим средним
 * MRR@10 берётся середина. У чётного плато из двух средних — с лучшим MRR, при равенстве — меньшая α.
 */
export function pickAlpha(curve: readonly CurvePoint[]): number {
  if (curve.length === 0) throw new Error("пустая кривая α");
  const sorted = [...curve].sort((x, y) => x.alpha - y.alpha);
  const max = Math.max(...sorted.map((p) => p.hit));
  const runs: CurvePoint[][] = [];
  let run: CurvePoint[] = [];
  for (const p of sorted) {
    if (p.hit >= max - EPS) run.push(p);
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  const meanMrr = (r: CurvePoint[]) =>
    r.reduce((s, p) => s + p.mrr, 0) / r.length;
  let best = runs[0] as CurvePoint[];
  for (const r of runs.slice(1)) {
    if (meanMrr(r) > meanMrr(best) + EPS) best = r;
  }
  const mid = (best.length - 1) / 2;
  const lo = best[Math.floor(mid)] as CurvePoint;
  const hi = best[Math.ceil(mid)] as CurvePoint;
  return hi.mrr > lo.mrr + EPS ? hi.alpha : lo.alpha;
}

export interface LengthPoint {
  length: number;
  hit: number;
  mrr: number;
}

/**
 * Длина вектора (ADR-0048): самая короткая, у которой Hit@5 и MRR@10 не хуже полной длины больше
 * чем на допуск.
 */
export function pickLength(
  points: readonly LengthPoint[],
  tolerance: { hit: number; mrr: number },
): number {
  const sorted = [...points].sort((x, y) => x.length - y.length);
  const full = sorted[sorted.length - 1];
  if (!full) throw new Error("нет длин вектора");
  const ok = sorted.find(
    (p) =>
      p.hit >= full.hit - tolerance.hit - EPS &&
      p.mrr >= full.mrr - tolerance.mrr - EPS,
  );
  return (ok ?? full).length;
}
