// Стоимость прогона (ADR-0020): оценка до отправки по константам и факт по usage из ответов.

import { BATCH_PRICES, EST_INPUT_TOKENS, EST_OUTPUT_TOKENS } from "./config.js";

/** Поля usage ответа, которые влияют на счёт. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface CostTotal {
  usd: number;
  requests: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** Оценка в долларах для requests запросов — с запасом. */
export const estimateCost = (requests: number): number =>
  (requests *
    (EST_INPUT_TOKENS * BATCH_PRICES.input +
      EST_OUTPUT_TOKENS * BATCH_PRICES.output)) /
  1e6;

/** Факт по ответам: кэш промпта не используется, но его поля учтены на всякий случай. */
export function sumCost(usages: readonly TokenUsage[]): CostTotal {
  const total: CostTotal = {
    usd: 0,
    requests: usages.length,
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
  };
  for (const u of usages) {
    total.input += u.input_tokens;
    total.output += u.output_tokens;
    total.cacheWrite += u.cache_creation_input_tokens ?? 0;
    total.cacheRead += u.cache_read_input_tokens ?? 0;
  }
  total.usd =
    (total.input * BATCH_PRICES.input +
      total.output * BATCH_PRICES.output +
      total.cacheWrite * BATCH_PRICES.cacheWrite +
      total.cacheRead * BATCH_PRICES.cacheRead) /
    1e6;
  return total;
}

/** «$0,0183» для мелких сумм, «$5,74» от доллара; запятая — как в остальных отчётах. */
export const formatUsd = (usd: number): string =>
  `$${(usd >= 1 ? usd.toFixed(2) : usd.toFixed(4)).replace(".", ",")}`;
