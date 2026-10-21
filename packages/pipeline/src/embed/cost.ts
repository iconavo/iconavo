// Стоимость эмбеддингов (ADR-0047): оценка до отправки по числу символов и факт по usage ответов.
// Polza считает в рублях: usage.cost_rub — уже списанная сумма.

import { type EmbeddingModel, EST_CHARS_PER_TOKEN } from "./config.js";

/** Расход: запросы, тексты, токены, символы отправленных текстов и рубли. */
export interface Spent {
  requests: number;
  texts: number;
  tokens: number;
  chars: number;
  rub: number;
  /** Часть рублей, посчитанная по цене из конфига: Polza не вернула cost_rub. */
  rubCalculated: number;
}

export const noSpent = (): Spent => ({
  requests: 0,
  texts: 0,
  tokens: 0,
  chars: 0,
  rub: 0,
  rubCalculated: 0,
});

export const addSpent = (a: Spent, b: Spent): Spent => ({
  requests: a.requests + b.requests,
  texts: a.texts + b.texts,
  tokens: a.tokens + b.tokens,
  chars: a.chars + b.chars,
  rub: a.rub + b.rub,
  rubCalculated: a.rubCalculated + b.rubCalculated,
});

/** Оценка в рублях за тексты общей длиной chars символов — с запасом. */
export const estimateRub = (model: EmbeddingModel, chars: number): number =>
  (chars / EST_CHARS_PER_TOKEN / 1e6) * model.rubPerMillion;

/** Рубли по токенам и цене из конфига. */
export const rubOfTokens = (model: EmbeddingModel, tokens: number): number =>
  (tokens / 1e6) * model.rubPerMillion;

/** «0,0123 ₽» до рубля, «12,34 ₽» от рубля; запятая — как в остальных отчётах. */
export const formatRub = (rub: number): string =>
  `${(rub >= 1 ? rub.toFixed(2) : rub.toFixed(4)).replace(".", ",")} ₽`;
