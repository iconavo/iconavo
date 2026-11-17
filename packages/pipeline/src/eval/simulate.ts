// Опыт этапа 2 шага 8 фазы 4 (ADR-0053): выдача сервиса, собранная локально из двух списков с
// оценками Meilisearch — «только слова» и «только смысл» (eval/service.ts). Чистые функции: списки с
// оценками на входе, имена карточек на выходе.
//
// M — копия слияния самого Meilisearch (hybrid): у карточки остаётся бо́льшая из двух взвешенных
// оценок, слова × (1 − доля), смысл × доля; два списка сливаются попарно, повтор карточки
// пропускается. Калибровка шкалы смысла (distribution эмбеддера) сдвигает оценку смысла: среднее —
// в 0,5, разброс — в 0,4. Без калибровки копия обязана повторить живую выдачу — так проверяется, что
// опыт честный.
//
// C — сумма слов и смысла, как у прототипа (ADR-0048): смысл нормирован между 1-м и 100-м местом,
// слова — оценка Meilisearch как есть (она уже «доля от лучшей возможной») или относительно лучшей
// в запросе.

import type { ScoredHit } from "@iconavo-ui/search";

/** Порядок при равных оценках — правила индекса после оценки: короткое имя, порядок наборов, имя. */
export interface Tie {
  parts: number;
  setOrder: number;
}
export type TieOf = (icon: string) => Tie;

/** Калибровка шкалы смысла — distribution эмбеддера Meilisearch. */
export interface Distribution {
  mean: number;
  sigma: number;
}

/** Порог «слова и так хороши» у Meilisearch: оценка слов × (1 − доля) не ниже 0,45 у всей страницы. */
export const GOOD_ENOUGH = 0.45;

/** Наименьшее положительное f32: так Meilisearch заменяет оценку ≤ 0 после сдвига. */
const F32_EPSILON = 2 ** -23;

/**
 * Сдвиг оценки смысла, как у Meilisearch (DistributionShift): среднее → 0,5, разброс → 0,4, итог — в
 * (0, 1]. Считается в f32, как у него.
 */
export function shiftScore(score: number, d: Distribution): number {
  const f = Math.fround;
  const factor = f(f(0.4) / f(d.sigma));
  const offset = f(f(0.5) - f(factor * f(d.mean)));
  let s = f(f(factor * f(score)) + offset);
  if (s <= 0) s = F32_EPSILON;
  if (s > 1) s = 1;
  return s;
}

/** Среднее и разброс оценок с точностью до 3 знаков (ADR-0053: первые 100 мест рабочей части). */
export function distributionOf(scores: readonly number[]): Distribution {
  if (scores.length === 0) throw new Error("нет оценок смысла для калибровки");
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const sigma = Math.sqrt(
    scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length,
  );
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { mean: round(mean), sigma: Math.max(0.001, round(sigma)) };
}

interface Weighted {
  icon: string;
  score: number;
}

/**
 * Сравнение голов двух списков, как compare_scores у Meilisearch: взвешенные оценки, при равенстве
 * (разница не больше f64 ε) — правила по возрастанию parts, setOrder, icon; меньшее значение идёт
 * первым. Больше нуля — первым идёт a.
 */
function compareHeads(a: Weighted, b: Weighted, tie: TieOf): number {
  if (Math.abs(a.score - b.score) > Number.EPSILON) return a.score - b.score;
  const ta = tie(a.icon);
  const tb = tie(b.icon);
  if (ta.parts !== tb.parts) return tb.parts - ta.parts;
  if (ta.setOrder !== tb.setOrder) return tb.setOrder - ta.setOrder;
  if (a.icon !== b.icon) return a.icon < b.icon ? 1 : -1;
  return 0;
}

export interface MergeOptions {
  /** Доля смысла (semanticRatio). */
  ratio: number;
  /** Мест на странице: от него зависит короткий путь «слова и так хороши». */
  limit: number;
  distribution?: Distribution;
}

/**
 * Выдача гибрида Meilisearch по двум спискам — без карточек точного имени, первые limit. Списки —
 * как отдаёт Meilisearch: по убыванию своих оценок.
 */
export function meiliMerge(
  words: readonly ScoredHit[],
  meaning: readonly ScoredHit[],
  tie: TieOf,
  o: MergeOptions,
): string[] {
  // Крайние доли — не слияние: 0 — только слова, без добора по смыслу (так отвечает живой индекс:
  // запрос без слов даёт пустую выдачу); 1 — только смысл.
  if (o.ratio === 0) return words.slice(0, o.limit).map((h) => h.icon);
  if (o.ratio === 1) return meaning.slice(0, o.limit).map((h) => h.icon);
  // Доли — f32, как у Meilisearch: semanticRatio и 1 − semanticRatio.
  const ratio = Math.fround(o.ratio);
  const rest = Math.fround(1 - ratio);
  const page = words.slice(0, o.limit);
  if (
    page.length >= o.limit &&
    page.every((h) => h.score * rest >= GOOD_ENOUGH)
  ) {
    return page.map((h) => h.icon);
  }
  const sem: Weighted[] = meaning.map((h) => ({
    icon: h.icon,
    score:
      (o.distribution === undefined
        ? h.score
        : shiftScore(h.score, o.distribution)) * ratio,
  }));
  const kw: Weighted[] = words.map((h) => ({
    icon: h.icon,
    score: h.score * rest,
  }));
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  let j = 0;
  while (out.length < o.limit && (i < sem.length || j < kw.length)) {
    const a = sem[i];
    const b = kw[j];
    const takeSemantic =
      a !== undefined && (b === undefined || compareHeads(a, b, tie) >= 0);
    const next = (takeSemantic ? a : b) as Weighted;
    if (takeSemantic) i++;
    else j++;
    if (!seen.has(next.icon)) {
      seen.add(next.icon);
      out.push(next.icon);
    }
  }
  return out;
}

export interface SumOptions {
  /** Доля смысла α: итог = α · смысл + (1 − α) · слова. */
  alpha: number;
  /** abs — оценка слов как есть; rel — относительно лучшей в запросе. */
  text: "abs" | "rel";
  limit: number;
  /** Нормировка смысла — между 1-м и этим местом (у прототипа — 100). */
  normRank: number;
}

/**
 * Сумма слов и смысла, как у прототипа (ADR-0048), — без карточек точного имени, первые limit. При
 * равных суммах выше карточка с большей оценкой смысла, затем слов, затем parts, setOrder и имя.
 */
export function convexSum(
  words: readonly ScoredHit[],
  meaning: readonly ScoredHit[],
  tie: TieOf,
  o: SumOptions,
): string[] {
  const top = meaning[0]?.score;
  const floor = meaning[Math.min(o.normRank, meaning.length) - 1]?.score;
  const semantic = new Map<string, number>();
  for (const h of meaning) {
    let v = 0;
    if (top !== undefined && floor !== undefined) {
      v =
        top > floor
          ? Math.min(1, Math.max(0, (h.score - floor) / (top - floor)))
          : h.score >= top
            ? 1
            : 0;
    }
    semantic.set(h.icon, v);
  }
  const best = words[0]?.score ?? 0;
  const text = new Map<string, number>();
  for (const h of words) {
    text.set(
      h.icon,
      o.text === "abs" ? h.score : best > 0 ? h.score / best : 0,
    );
  }
  const raw = new Map(meaning.map((h) => [h.icon, h.score]));
  const items = [...new Set([...meaning, ...words].map((h) => h.icon))].map(
    (icon) => ({
      icon,
      score:
        o.alpha * (semantic.get(icon) ?? 0) +
        (1 - o.alpha) * (text.get(icon) ?? 0),
      semantic: raw.get(icon) ?? Number.NEGATIVE_INFINITY,
      text: text.get(icon) ?? 0,
      tie: tie(icon),
    }),
  );
  items.sort(
    (a, b) =>
      b.score - a.score ||
      b.semantic - a.semantic ||
      b.text - a.text ||
      a.tie.parts - b.tie.parts ||
      a.tie.setOrder - b.tie.setOrder ||
      (a.icon < b.icon ? -1 : a.icon > b.icon ? 1 : 0),
  );
  return items.slice(0, o.limit).map((x) => x.icon);
}
