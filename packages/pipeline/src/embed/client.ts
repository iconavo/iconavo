// Единственное место, где конвейер обращается к Polza AI (ADR-0047): POST /embeddings встроенным
// fetch. Сбои сети, истёкшее ожидание и перегрузка — повтор с паузой; ключ и баланс — остановка
// всего прогона; другой отказ — остановка модели. Ключ приходит параметром и никуда не печатается.

import type { FetchFn } from "../sources/npm.js";
import {
  API_URL,
  BACKOFF_MS,
  type EmbeddingModel,
  MAX_ATTEMPTS,
  RETRY_AFTER_MAX_MS,
  TIMEOUT_MS,
} from "./config.js";
import { parseEmbeddings } from "./parse.js";

export interface EmbedResult {
  /** Векторы в порядке текстов, каждый длины 1. */
  vectors: Float32Array[];
  /** Токены и рубли из ответа; нет — undefined. */
  tokens?: number;
  rub?: number;
  /** Время удачной попытки до получения ответа целиком, мс. */
  ms: number;
}

/** Та часть API, которая нужна эмбеддингам; в тестах его подменяют (client.testing.ts). */
export interface EmbeddingClient {
  embed(model: EmbeddingModel, inputs: readonly string[]): Promise<EmbedResult>;
}

/** Что останавливает ошибка: весь прогон (ключ, баланс, доступ) или только эту модель. */
export type StopScope = "run" | "model";

export const apiError = (message: string, scope: StopScope) =>
  Object.assign(new Error(message), { scope });

/** Ошибка без пометки — ошибка модели: остальные модели прогона продолжают. */
export const errorScope = (e: unknown): StopScope =>
  (e as { scope?: StopScope }).scope === "run" ? "run" : "model";

/** Ответы, после которых нет смысла продолжать ни одну модель. */
const RUN_STOPS: Record<number, string> = {
  401: "ключ POLZA_API_KEY не подошёл — проверьте его в .env",
  402: "на балансе Polza не хватает денег или превышен лимит",
  403: "у ключа нет доступа",
};

/** Временные отказы: повтор с паузой. */
const retryable = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

/** Пауза перед следующей попыткой: из Retry-After (секунды или дата), иначе 1, 2, 4, 8 с. */
export function retryDelay(header: string | null, attempt: number): number {
  if (header !== null && header.trim() !== "") {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(header) - Date.now();
    if (Number.isFinite(ms))
      return Math.min(Math.max(0, ms), RETRY_AFTER_MAX_MS);
  }
  return (
    BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ??
    RETRY_AFTER_MAX_MS
  );
}

export interface PolzaOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export function polzaEmbeddingClient(options: PolzaOptions): EmbeddingClient {
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const url = `${options.baseUrl ?? API_URL}/embeddings`;
  const key = options.apiKey;
  // Начало ответа для сообщения об ошибке: в одну строку и без ключа, даже если сервер его повторил.
  const snippet = (text: string) =>
    (key === "" ? text : text.replaceAll(key, "…"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
  return {
    async embed(model, inputs) {
      let last = "";
      for (let attempt = 1; ; attempt++) {
        let wait: number | undefined;
        const started = now();
        try {
          const res = await fetchFn(url, {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ model: model.id, input: inputs }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const text = await res.text();
          const ms = now() - started;
          if (res.ok) {
            let json: unknown;
            try {
              json = JSON.parse(text);
            } catch {
              json = undefined;
            }
            if (json !== undefined) {
              const parsed = parseEmbeddings(json, inputs.length, model.dims);
              return { ...parsed, ms };
            }
            last = `ответ не JSON: ${snippet(text)}`;
          } else {
            const reason = `HTTP ${res.status}${text.trim() === "" ? "" : ` — ${snippet(text)}`}`;
            const fatal = RUN_STOPS[res.status];
            if (fatal !== undefined) {
              throw apiError(`${model.id}: ${fatal} (${reason})`, "run");
            }
            if (!retryable(res.status)) {
              throw apiError(
                `${model.id}: запрос отклонён (${reason})`,
                "model",
              );
            }
            last = reason;
            wait = retryDelay(res.headers.get("retry-after"), attempt);
          }
        } catch (e) {
          const name = (e as Error).name;
          if (name === "TimeoutError" || name === "AbortError") {
            last = `нет ответа за ${Math.round(timeoutMs / 1000)} с`;
          } else if (
            e instanceof TypeError &&
            (e.message === "fetch failed" || "cause" in e)
          ) {
            // Так fetch в Node сообщает о сбое соединения; причина — в cause.
            const cause = (e as { cause?: { code?: string } }).cause?.code;
            last = `сбой сети${cause ? ` (${cause})` : ""}: ${e.message}`;
          } else {
            // Ответ не по формату, отказ API — без повторов.
            throw (e as { scope?: StopScope }).scope
              ? e
              : apiError(`${model.id}: ${(e as Error).message}`, "model");
          }
        }
        if (attempt >= maxAttempts) {
          throw apiError(
            `${model.id}: ${last} — не получилось за ${maxAttempts} попыток`,
            "model",
          );
        }
        await sleep(wait ?? retryDelay(null, attempt));
      }
    },
  };
}
