// Замер скорости поиска — pnpm api bench (ADR-0049, ADR-0040). Протокол записан в ADR-0049 до замера:
// 100 запросов контрольной части эталона к живому /search; проход «холодный» (новая сборка функции —
// новые ключи кэша); не больше 50 запросов в минуту (лимит — 60); мера — время до первого ответа,
// полного или pending; цель — 95% не дольше 0,3 с. Для справки: доля полных ответов, откуда взялся
// вектор, время до полной выдачи у pending и повторный проход — уже из кэша.

import { CHECK_ORIGIN } from "../cdn/config.js";
import type { GoldenQuery } from "../eval/golden.js";
import { esc, htmlPage } from "../report/html.js";
import { textTable } from "../report/table.js";
import type { FetchFn } from "../sources/npm.js";

/** ≈ 46 запросов в минуту, вместе с повторами pending: ниже лимита в 60. */
export const BENCH_PACE_MS = 1300;
/** Сколько ждать полной выдачи после pending. */
export const BENCH_FULL_WAIT_MS = 10_000;
/** Цель ADR-0040: 95% ответов не дольше 0,3 с. */
export const BENCH_TARGET_MS = 300;
export const BENCH_SHARE = 0.95;
/** Карточек в ответе: первая десятка, как у замера качества. */
export const BENCH_LIMIT = 10;

export interface BenchSample {
  id: string;
  query: string;
  lang: string;
  status?: number;
  /** Время до первого ответа, мс. */
  ms?: number;
  semantic?: string;
  /** X-Cache: HIT — из кэша дата-центра. */
  cache?: string;
  /** Откуда вектор (Server-Timing): cache, store, model, pending, error. */
  vector?: string;
  /** Время внутри функции (Server-Timing total). */
  serverMs?: number;
  /** У pending — от первого запроса до полной выдачи. */
  fullMs?: number;
  error?: string;
}

export interface BenchReport {
  base: string;
  /** Время начала, ISO. */
  at: string;
  cold: BenchSample[];
  warm: BenchSample[];
  paceMs: number;
  ms: number;
}

export interface BenchOptions {
  base: string;
  queries: readonly GoldenQuery[];
  paceMs?: number;
  fullWaitMs?: number;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

const serverTiming = (header: string | null, name: string) =>
  new RegExp(`${name};(?:desc="([^"]*)";)?dur=(\\d+)`).exec(header ?? "");

export async function benchSearch(o: BenchOptions): Promise<BenchReport> {
  const fetchFn = o.fetch ?? fetch;
  const sleep =
    o.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = o.now ?? (() => performance.now());
  const pace = o.paceMs ?? BENCH_PACE_MS;
  const fullWait = o.fullWaitMs ?? BENCH_FULL_WAIT_MS;
  const started = now();
  let last = Number.NEGATIVE_INFINITY;

  /** Запрос не чаще раза в pace мс — вместе с повторами pending. */
  async function request(path: string) {
    const wait = last + pace - now();
    if (wait > 0) await sleep(wait);
    last = now();
    const t0 = now();
    try {
      const res = await fetchFn(`${o.base}${path}`, {
        headers: { origin: CHECK_ORIGIN },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      return { res, text, ms: now() - t0, t0 };
    } catch (e) {
      return { error: (e as Error).message, ms: now() - t0, t0 };
    }
  }

  const semanticOf = (text: string) => {
    try {
      return String((JSON.parse(text) as { semantic?: unknown }).semantic);
    } catch {
      return undefined;
    }
  };

  async function pass(kind: "cold" | "warm"): Promise<BenchSample[]> {
    const out: BenchSample[] = [];
    for (const [i, q] of o.queries.entries()) {
      const path = `/search?query=${encodeURIComponent(q.query)}&limit=${BENCH_LIMIT}`;
      const sample: BenchSample = { id: q.id, query: q.query, lang: q.lang };
      const r = await request(path);
      sample.ms = r.ms;
      if ("error" in r) {
        sample.error = r.error;
      } else {
        sample.status = r.res.status;
        const semantic = semanticOf(r.text);
        if (semantic !== undefined) sample.semantic = semantic;
        const cache = r.res.headers.get("x-cache");
        if (cache !== null) sample.cache = cache;
        const timing = r.res.headers.get("server-timing");
        const vector = serverTiming(timing, "vector");
        if (vector?.[1] !== undefined) sample.vector = vector[1];
        const total = serverTiming(timing, "total");
        if (total) sample.serverMs = Number(total[2]);
        if (r.res.status !== 200) sample.error = `ответ ${r.res.status}`;
        // pending — ждать полную выдачу: она досчитывается в фоне и ложится в кэш.
        if (kind === "cold" && semantic === "pending") {
          while (now() - r.t0 < fullWait) {
            const again = await request(path);
            if ("error" in again || again.res.status !== 200) continue;
            if (semanticOf(again.text) === "full") {
              sample.fullMs = now() - r.t0;
              break;
            }
          }
        }
      }
      out.push(sample);
      if ((i + 1) % 10 === 0) {
        o.log?.(
          `  ${kind === "cold" ? "холодный" : "повтор"}: ${i + 1} из ${o.queries.length}`,
        );
      }
    }
    return out;
  }

  const at = new Date().toISOString();
  const cold = await pass("cold");
  const warm = await pass("warm");
  return { base: o.base, at, cold, warm, paceMs: pace, ms: now() - started };
}

/** Перцентиль по ближайшему рангу. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] as number;
}

export interface BenchSummary {
  n: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Доля ответов не дольше BENCH_TARGET_MS. */
  within: number;
  semantic: Record<string, number>;
  vector: Record<string, number>;
  /** У pending — время до полной выдачи. */
  fullP50?: number;
  fullP95?: number;
  /** pending, которые так и не стали полными. */
  neverFull: number;
}

export function benchSummary(samples: readonly BenchSample[]): BenchSummary {
  const ok = samples.filter((s) => s.error === undefined && s.ms !== undefined);
  const times = ok.map((s) => s.ms as number);
  const count = (key: (s: BenchSample) => string | undefined) => {
    const out: Record<string, number> = {};
    for (const s of ok) {
      const k = key(s) ?? "—";
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const full = ok
    .filter((s) => s.fullMs !== undefined)
    .map((s) => s.fullMs as number);
  return {
    n: samples.length,
    errors: samples.length - ok.length,
    p50: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    p99: percentile(times, 0.99),
    max: times.length === 0 ? Number.NaN : Math.max(...times),
    within:
      times.length === 0
        ? 0
        : times.filter((t) => t <= BENCH_TARGET_MS).length / samples.length,
    semantic: count((s) => s.semantic),
    vector: count(
      (s) => s.vector ?? (s.cache === "HIT" ? "кэш ответа" : undefined),
    ),
    ...(full.length === 0
      ? {}
      : { fullP50: percentile(full, 0.5), fullP95: percentile(full, 0.95) }),
    neverFull: ok.filter(
      (s) => s.semantic === "pending" && s.fullMs === undefined,
    ).length,
  };
}

const msText = (ms: number) =>
  Number.isNaN(ms) ? "—" : `${Math.round(ms)} мс`;
const pctText = (x: number) => `${(x * 100).toFixed(0)}%`;
const countsText = (c: Record<string, number>) =>
  Object.entries(c)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");

/** Цель ADR-0040 на холодном проходе: 95% не дольше 0,3 с. */
export const benchMet = (r: BenchReport) =>
  benchSummary(r.cold).p95 <= BENCH_TARGET_MS &&
  benchSummary(r.cold).errors === 0;

/** Строки для терминала. */
export function formatBench(r: BenchReport): string[] {
  const rows = (["cold", "warm"] as const).map((k) => {
    const s = benchSummary(r[k]);
    return [
      k === "cold" ? "холодный" : "повтор",
      String(s.n),
      msText(s.p50),
      msText(s.p95),
      msText(s.p99),
      pctText(s.within),
      String(s.errors),
    ];
  });
  const cold = benchSummary(r.cold);
  return [
    `Замер скорости поиска ${r.base}/search — ${r.cold.length} запросов, не чаще раза в ${(r.paceMs / 1000).toFixed(1).replace(".", ",")} с`,
    textTable(
      ["Проход", "Запросов", "P50", "P95", "P99", "≤ 0,3 с", "Ошибок"],
      rows,
    ),
    `Полнота первого ответа (холодный): ${countsText(cold.semantic)}`,
    `Откуда вектор (холодный): ${countsText(cold.vector)}`,
    ...(cold.fullP50 === undefined
      ? []
      : [
          `pending → полная выдача: P50 ${msText(cold.fullP50)}, P95 ${msText(cold.fullP95 ?? Number.NaN)}; так и не стали полными — ${cold.neverFull}`,
        ]),
    benchMet(r)
      ? `Цель ADR-0040 выполнена: 95% первых ответов не дольше 0,3 с (P95 ${msText(cold.p95)}).`
      : `Цель ADR-0040 не выполнена: P95 первых ответов ${msText(cold.p95)}, ошибок ${cold.errors}.`,
  ];
}

/** Страница отчёта .cache/reports/api/bench.html. */
export function renderBenchPage(r: BenchReport): string {
  const table = (samples: readonly BenchSample[]) =>
    `<table><thead><tr><th>Запрос</th><th>Язык</th><th class="num">Ответ</th><th class="num">Время</th><th>Полнота</th><th>Кэш</th><th>Вектор</th><th class="num">В функции</th><th class="num">До полной</th></tr></thead><tbody>${samples
      .map(
        (s) =>
          `<tr><td>${esc(s.query)}</td><td>${esc(s.lang)}</td><td class="num">${s.status ?? esc(s.error ?? "—")}</td><td class="num${(s.ms ?? 0) > BENCH_TARGET_MS ? " stop" : ""}">${msText(s.ms ?? Number.NaN)}</td><td>${esc(s.semantic ?? "—")}</td><td>${esc(s.cache ?? "—")}</td><td>${esc(s.vector ?? "—")}</td><td class="num">${s.serverMs === undefined ? "—" : `${s.serverMs} мс`}</td><td class="num">${s.fullMs === undefined ? "—" : msText(s.fullMs)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  const lines = formatBench(r);
  return htmlPage(
    "Скорость поиска",
    "",
    `<h1>Скорость поиска</h1>
<p class="muted">${esc(r.base)}/search · ${esc(r.at)} · ADR-0049, ADR-0040. Мера — время до первого ответа (полного или pending), цель — 95% не дольше 0,3 с.</p>
<pre>${esc(lines.join("\n"))}</pre>
<h2>Холодный проход</h2>
${table(r.cold)}
<h2>Повтор — из кэша</h2>
${table(r.warm)}`,
  );
}
