// Слияние прототипа поиска (шаг 12, ADR-0048): выпуклая сумма α·смысл + (1−α)·текст по всем
// карточкам. Текст — доля от лучшей возможной оценки запроса, не больше 1: единственное совпадение по
// опечатке не становится «идеальным». Смысл — место косинуса между 1-м и 100-м результатом запроса:
// у трёх моделей одна шкала. Точное совпадение имени — всегда первым (ADR-0009, ADR-0040) и в
// нормировку не входит. Варианты: «Текст» — текст и точное имя, «Смысл» — только векторы.

import type { Catalog } from "./catalog.js";
import { VECTOR_NORM_RANK } from "./config.js";
import type { TextResult } from "./text.js";

export type Mode = "hybrid" | "vector" | "text";

/** Запрос как имя иконки: «Shopping Cart» → `shopping-cart`, «lucide:House» → `lucide:house`. */
export const nameForm = (query: string): string =>
  query
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

/**
 * Текст запроса для текстовой части: у `набор:имя` — только имя, префикс набора словом не ищется.
 */
export function textQuery(catalog: Catalog, query: string): string {
  const m = /^s*([a-z0-9-]+):(.*)$/i.exec(query);
  const set = m?.[1]?.toLowerCase();
  return m && catalog.sets.some((s) => s.id === set) ? (m[2] ?? "") : query;
}

/** Карточки, у которых имя, вариант, оттенок или алиас совпали с запросом; с `набор:` — только этот набор. */
export function exactDocs(catalog: Catalog, query: string): number[] {
  const form = nameForm(query);
  if (form === "") return [];
  const colon = form.indexOf(":");
  if (colon !== -1) {
    const doc = catalog.names.get(form);
    return doc === undefined ? [] : [doc];
  }
  return [...(catalog.bareNames.get(form) ?? [])].sort((a, b) => a - b);
}

/** Карточки-кандидаты одного запроса с оценками, приведёнными к шкале 0…1. */
export interface Prepared {
  /** Номера документов с учётом фильтра по набору. */
  docs: number[];
  /** Частей в имени карточки — по номеру документа (Catalog.parts). */
  parts: Uint8Array;
  exact: Set<number>;
  /** Доля от лучшей возможной текстовой оценки, 0…1 — по номеру документа. */
  text: Float64Array;
  /** Сырой косинус и место между 1-м и 100-м результатом, 0…1; нет векторов — undefined. */
  cosine?: Float32Array;
  vector?: Float64Array;
}

/**
 * Кандидаты запроса: оценки обеих частей на одной шкале. cos — косинусы одной длины вектора по
 * номерам документов; нет — только текстовая часть.
 */
export function prepare(
  catalog: Catalog,
  query: string,
  text: TextResult,
  cos: Float32Array | undefined,
  set?: string,
): Prepared {
  const docs: number[] = [];
  catalog.docs.forEach((doc, i) => {
    if (set === undefined || doc.set === set) docs.push(i);
  });
  const exact = new Set(
    exactDocs(catalog, query).filter(
      (d) => set === undefined || catalog.docs[d]?.set === set,
    ),
  );
  const t = new Float64Array(catalog.docs.length);
  if (text.best > 0) {
    for (const d of docs) {
      t[d] = Math.min(1, (text.scores[d] as number) / text.best);
    }
  }
  const p: Prepared = { docs, parts: catalog.parts, exact, text: t };
  if (!cos) return p;
  // Косинусы кандидатов без точных имён — по возрастанию: числовая сортировка массива чисел.
  const pool = new Float64Array(docs.length);
  let size = 0;
  for (const d of docs) {
    const c = cos[d] as number;
    if (!exact.has(d) && Number.isFinite(c)) pool[size++] = c;
  }
  const sorted = pool.subarray(0, size).sort();
  const top = size > 0 ? sorted[size - 1] : undefined;
  const floor =
    size > 0 ? sorted[size - Math.min(VECTOR_NORM_RANK, size)] : undefined;
  const v = new Float64Array(catalog.docs.length);
  if (top !== undefined && floor !== undefined) {
    for (const d of docs) {
      const c = cos[d] as number;
      if (!Number.isFinite(c)) continue;
      v[d] =
        top > floor
          ? Math.min(1, Math.max(0, (c - floor) / (top - floor)))
          : c >= top
            ? 1
            : 0;
    }
  }
  p.cosine = cos;
  p.vector = v;
  return p;
}

export interface Ranked {
  doc: number;
  /** Итоговая оценка варианта: доля текста, косинус или сумма с весами. */
  score: number;
  exact: boolean;
  /** Доля текстовой оценки 0…1 и косинус, если векторы есть. */
  text: number;
  cosine?: number;
}

/**
 * Первые limit карточек варианта. В гибриде без векторов — как «Текст»: поиск не возвращает
 * ошибку, если сервис эмбеддингов недоступен (ADR-0027).
 */
export function rankPrepared(
  p: Prepared,
  mode: Mode,
  alpha: number,
  limit: number,
): Ranked[] {
  const effective: Mode = mode === "hybrid" && !p.vector ? "text" : mode;
  const useExact = effective !== "vector";
  const out: Ranked[] = [];
  const cosineOf = (d: number) => {
    const c = p.cosine?.[d];
    return c !== undefined && Number.isFinite(c) ? c : undefined;
  };
  // Порядок: точные имена, затем оценка, косинус, текст, короткое имя и место в каталоге —
  // без случайностей.
  const before = (a: Ranked, b: Ranked) => {
    if (a.exact !== b.exact) return a.exact;
    if (a.score !== b.score) return a.score > b.score;
    const ca = a.cosine ?? Number.NEGATIVE_INFINITY;
    const cb = b.cosine ?? Number.NEGATIVE_INFINITY;
    if (ca !== cb) return ca > cb;
    if (a.text !== b.text) return a.text > b.text;
    const pa = p.parts[a.doc] ?? 0;
    const pb = p.parts[b.doc] ?? 0;
    if (pa !== pb) return pa < pb;
    return a.doc < b.doc;
  };
  for (const d of p.docs) {
    const exact = useExact && p.exact.has(d);
    const text = p.text[d] as number;
    const cosine = cosineOf(d);
    let score: number;
    if (effective === "text") {
      if (text <= 0 && !exact) continue;
      score = text;
    } else if (effective === "vector") {
      if (cosine === undefined) continue;
      score = cosine;
    } else {
      score = alpha * ((p.vector?.[d] ?? 0) as number) + (1 - alpha) * text;
    }
    const last = out[out.length - 1];
    // Быстрый отказ без нового объекта: заведомо хуже последнего в полном списке.
    if (out.length >= limit && last) {
      if (last.exact && !exact) continue;
      if (last.exact === exact && score < last.score) continue;
    }
    const item: Ranked = { doc: d, score, exact, text };
    if (cosine !== undefined) item.cosine = cosine;
    if (out.length >= limit && last && !before(item, last)) continue;
    let i = out.length;
    while (i > 0 && before(item, out[i - 1] as Ranked)) i--;
    out.splice(i, 0, item);
    if (out.length > limit) out.pop();
  }
  return out;
}
