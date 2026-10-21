// Текстовая часть прототипа поиска (шаг 12, ADR-0048): слова документа по полям — имя, теги автора,
// синонимы ru/en. Оценка слова — редкость слова (IDF, как в BM25) × вес поля × качество совпадения;
// берётся лучшее поле, а не сумма: у Material Symbols теги — это части имени, и сумма считала бы их
// дважды. Совпадения — как в Meilisearch: точное слово, опечатки, начало последнего слова запроса.
// Морфологии нет, как и в Meilisearch: формы слов и смысл берёт векторная часть.

import {
  FIELD_WEIGHTS,
  FIELDS,
  type Field,
  MATCH_QUALITY,
  type MatchKind,
  PREFIX_MAX_EXPANSIONS,
  PREFIX_MIN_LENGTH,
  STOP_WORDS,
  TYPO_MIN_LENGTH,
} from "./config.js";

const LATIN = /[a-z]/;
const MARK = /\p{M}/u;

/**
 * Слово для поиска: строчные буквы, ё→е, диакритика снимается только у латиницы (café → cafe), а
 * «й» остаётся буквой. Оставшиеся знаки над буквами (ударение) убираются.
 */
export function normalizeWord(text: string): string {
  const decomposed = text
    .normalize("NFC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .normalize("NFD");
  let out = "";
  let base = "";
  for (const ch of decomposed) {
    if (MARK.test(ch)) {
      if (!LATIN.test(base)) out += ch;
    } else {
      out += ch;
      base = ch;
    }
  }
  return out.normalize("NFC").replace(/\p{M}/gu, "");
}

/** Слова текста: всё, что не буква и не цифра, — разделитель. */
export function words(text: string): string[] {
  return normalizeWord(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");
}

/** Слова запроса без служебных («в», «для», «icon»…). */
export const queryWords = (query: string): string[] =>
  words(query).filter((w) => !STOP_WORDS.has(w));

/**
 * Расстояние между словами с перестановкой соседних букв (как опечатки в Meilisearch); опечатка в
 * первой букве считается за две. Больше max — возвращается max + 1, не досчитывая.
 */
export function typoDistance(a: string, b: string, max: number): number {
  const s = Array.from(a);
  const t = Array.from(b);
  if (Math.abs(s.length - t.length) > max) return max + 1;
  const first = s[0] === t[0] ? 0 : 1;
  const limit = max - first;
  if (limit < 0) return max + 1;
  const width = t.length + 1;
  let before = new Array<number>(width).fill(0);
  let prev = Array.from({ length: width }, (_, j) => j);
  let cur = new Array<number>(width).fill(0);
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        v = Math.min(v, (before[j - 2] as number) + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return max + 1;
    [before, prev, cur] = [prev, cur, before];
  }
  const d = (prev[t.length] as number) + (first > 0 && s.length > 0 ? 1 : 0);
  return d > max ? max + 1 : d;
}

/** Слова документа по полям. */
export type DocWords = Record<Field, readonly string[]>;

interface Posting {
  docs: number[];
  /** Биты полей по порядку FIELDS, где у документа есть слово. */
  fields: number[];
}

export interface TextIndex {
  docCount: number;
  postings: Map<string, Posting>;
  /** Редкость слова: ln(1 + (N − df + 0,5) / (df + 0,5)), как в BM25. */
  idf: Map<string, number>;
  /** Все слова по алфавиту — для начала слова. */
  sorted: string[];
  /** Слова по длине в буквах — для опечаток. */
  byLength: Map<number, string[]>;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildTextIndex(docs: readonly DocWords[]): TextIndex {
  const masks = new Map<string, Map<number, number>>();
  docs.forEach((doc, i) => {
    FIELDS.forEach((field, bit) => {
      for (const w of doc[field]) {
        let m = masks.get(w);
        if (!m) {
          m = new Map();
          masks.set(w, m);
        }
        m.set(i, (m.get(i) ?? 0) | (1 << bit));
      }
    });
  });
  const n = docs.length;
  const postings = new Map<string, Posting>();
  const idf = new Map<string, number>();
  const byLength = new Map<number, string[]>();
  for (const [w, m] of masks) {
    const entries = [...m].sort((x, y) => x[0] - y[0]);
    postings.set(w, {
      docs: entries.map((e) => e[0]),
      fields: entries.map((e) => e[1]),
    });
    idf.set(w, Math.log(1 + (n - m.size + 0.5) / (m.size + 0.5)));
    const len = Array.from(w).length;
    const list = byLength.get(len) ?? [];
    list.push(w);
    byLength.set(len, list);
  }
  const sorted = [...masks.keys()].sort(order);
  for (const list of byLength.values()) list.sort(order);
  return { docCount: n, postings, idf, sorted, byLength };
}

/** Что совпало у документа со словом запроса — для страницы поиска. */
export interface WordMatch {
  query: string;
  word: string;
  field: Field;
  kind: MatchKind;
}

export interface TextResult {
  /** Слова запроса без служебных. */
  words: string[];
  /** Оценка документа — сумма по словам запроса; 0 — документ не нашёлся. */
  scores: Float64Array;
  /** Лучшая возможная оценка запроса: каждое слово — точное совпадение в имени. */
  best: number;
  /** Совпадения найденных документов: по одному на слово запроса. */
  matches: Map<number, WordMatch[]>;
}

/** Слова словаря, похожие на слово запроса: точное, начало слова (у последнего), опечатки. */
export function expansions(
  index: TextIndex,
  word: string,
  last: boolean,
): Map<string, MatchKind> {
  const out = new Map<string, MatchKind>();
  const better = (w: string, kind: MatchKind) => {
    const had = out.get(w);
    if (had === undefined || MATCH_QUALITY[kind] > MATCH_QUALITY[had]) {
      out.set(w, kind);
    }
  };
  if (index.postings.has(word)) better(word, "exact");
  const length = Array.from(word).length;
  if (last && length >= PREFIX_MIN_LENGTH) {
    // Слова с этим началом идут в отсортированном словаре подряд.
    let lo = 0;
    let hi = index.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((index.sorted[mid] as string) < word) lo = mid + 1;
      else hi = mid;
    }
    const found: string[] = [];
    for (let i = lo; i < index.sorted.length; i++) {
      const w = index.sorted[i] as string;
      if (!w.startsWith(word)) break;
      if (w !== word) found.push(w);
    }
    found.sort((a, b) => a.length - b.length || order(a, b));
    for (const w of found.slice(0, PREFIX_MAX_EXPANSIONS)) better(w, "prefix");
  }
  if (length >= TYPO_MIN_LENGTH.one) {
    const max = length >= TYPO_MIN_LENGTH.two ? 2 : 1;
    const first = word[0];
    for (let len = length - max; len <= length + max; len++) {
      for (const w of index.byLength.get(len) ?? []) {
        // Опечатка в первой букве — за две: при одной допустимой такие слова не подходят.
        if (w === word || (max === 1 && w[0] !== first)) continue;
        // Больше max функция возвращает max + 1: при одной допустимой «2» — это «не подходит».
        const d = typoDistance(word, w, max);
        if (d > max) continue;
        if (d === 1) better(w, "typo1");
        else if (d === 2) better(w, "typo2");
      }
    }
  }
  return out;
}

const MAX_FIELD_WEIGHT = Math.max(...FIELDS.map((f) => FIELD_WEIGHTS[f]));

/** Самое весомое поле среди отмеченных битами. */
function bestField(mask: number): Field {
  let best: Field | undefined;
  for (let bit = 0; bit < FIELDS.length; bit++) {
    const field = FIELDS[bit] as Field;
    if (
      (mask & (1 << bit)) !== 0 &&
      (best === undefined || FIELD_WEIGHTS[field] > FIELD_WEIGHTS[best])
    ) {
      best = field;
    }
  }
  return best ?? "synonyms";
}

/**
 * Редкость слова запроса — одна на все похожие слова: своя, если слово есть в словаре, иначе — у самого
 * частого из похожих. Иначе редкая опечатка весила бы больше точного слова: так же поступает Lucene.
 */
function wordIdf(
  index: TextIndex,
  word: string,
  found: ReadonlyMap<string, MatchKind>,
): number {
  const own = index.idf.get(word);
  if (own !== undefined) return own;
  let min = Number.POSITIVE_INFINITY;
  for (const w of found.keys()) min = Math.min(min, index.idf.get(w) ?? min);
  return Number.isFinite(min) ? min : 0;
}

/**
 * Оценки документов по запросу. Лучшая возможная оценка — каждое слово точно в имени; слова, у
 * которых в словаре нет ничего похожего, в неё не входят: их не найдёт ни один документ.
 */
export function searchText(index: TextIndex, query: string): TextResult {
  const qWords = queryWords(query);
  const scores = new Float64Array(index.docCount);
  const matches = new Map<number, WordMatch[]>();
  let best = 0;
  qWords.forEach((q, qi) => {
    const found = expansions(index, q, qi === qWords.length - 1);
    if (found.size === 0) return;
    const idf = wordIdf(index, q, found);
    const bestOfWord = new Map<number, { score: number; match: WordMatch }>();
    for (const [w, kind] of found) {
      const posting = index.postings.get(w);
      if (!posting) continue;
      posting.docs.forEach((doc, k) => {
        const field = bestField(posting.fields[k] as number);
        const score = idf * FIELD_WEIGHTS[field] * MATCH_QUALITY[kind];
        const had = bestOfWord.get(doc);
        if (!had || score > had.score) {
          bestOfWord.set(doc, {
            score,
            match: { query: q, word: w, field, kind },
          });
        }
      });
    }
    best += idf * MAX_FIELD_WEIGHT;
    for (const [doc, { score, match }] of bestOfWord) {
      scores[doc] = (scores[doc] as number) + score;
      const list = matches.get(doc) ?? [];
      list.push(match);
      matches.set(doc, list);
    }
  });
  return { words: qWords, scores, best, matches };
}
