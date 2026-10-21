// Чат Polza для судьи эталона (шаг 12, ADR-0048): POST /chat/completions встроенным fetch. Повторы,
// паузы и остановки — как у эмбеддингов (embed/client.ts): сбой сети и перегрузка — повтор, ключ и
// баланс — остановка всего прогона, другой отказ — ошибка запроса. Если сервер не принял
// необязательное поле (схему ответа, усилие мышления), запрос уходит без него — как у генератора
// эталона (tools/eval/generate-queries.mjs). Ключ приходит параметром и никуда не печатается.

import {
  apiError,
  RUN_STOPS,
  retryable,
  retryDelay,
  type StopScope,
} from "../embed/client.js";
import { API_URL, MAX_ATTEMPTS } from "../embed/config.js";
import type { FetchFn } from "../sources/npm.js";
import { TIMEOUT_MS } from "./config.js";

export interface ChatResult {
  /** Текст ответа модели. */
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Списанные рубли из usage.cost_rub. */
  rub?: number;
  /** Время удачной попытки, мс. */
  ms: number;
}

/** Та часть API, которая нужна судье; в тестах его подменяют (client.testing.ts). */
export interface ChatClient {
  complete(body: Record<string, unknown>): Promise<ChatResult>;
}

export interface ChatOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
}

/** Поля, без которых запрос всё равно имеет смысл: по очереди убираются при отказе 400 и 422. */
const OPTIONAL = ["reasoning", "response_format"] as const;

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_rub?: number | null;
  cost?: number | null;
}

/** Текст ответа: строка или части с type text. */
function contentText(json: unknown): string | undefined {
  const message = (json as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => (p as { text?: unknown })?.text)
      .filter((t): t is string => typeof t === "string");
    return parts.length > 0 ? parts.join("") : undefined;
  }
  return undefined;
}

export function polzaChatClient(options: ChatOptions): ChatClient {
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const url = `${options.baseUrl ?? API_URL}/chat/completions`;
  const key = options.apiKey;
  const snippet = (text: string) =>
    (key === "" ? text : text.replaceAll(key, "…"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);

  /** Одна попытка тела с повторами при сбоях; 400 и 422 возвращаются как «не принято». */
  async function send(
    body: Record<string, unknown>,
  ): Promise<ChatResult | { rejected: string }> {
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
          body: JSON.stringify(body),
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
          const answer = json === undefined ? undefined : contentText(json);
          if (answer !== undefined) {
            const usage = (json as { usage?: Usage }).usage ?? {};
            const out: ChatResult = { text: answer, ms };
            if (usage.prompt_tokens !== undefined) {
              out.promptTokens = usage.prompt_tokens;
            }
            if (usage.completion_tokens !== undefined) {
              out.completionTokens = usage.completion_tokens;
            }
            const rub = usage.cost_rub ?? usage.cost;
            if (rub !== undefined && rub !== null) out.rub = rub;
            return out;
          }
          last = `в ответе нет текста: ${snippet(text)}`;
        } else {
          const reason = `HTTP ${res.status}${text.trim() === "" ? "" : ` — ${snippet(text)}`}`;
          const fatal = RUN_STOPS[res.status];
          if (fatal !== undefined) {
            throw apiError(
              `${String(body.model)}: ${fatal} (${reason})`,
              "run",
            );
          }
          if (res.status === 400 || res.status === 422) {
            return { rejected: reason };
          }
          if (!retryable(res.status)) {
            throw apiError(
              `${String(body.model)}: запрос отклонён (${reason})`,
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
          const cause = (e as { cause?: { code?: string } }).cause?.code;
          last = `сбой сети${cause ? ` (${cause})` : ""}: ${e.message}`;
        } else {
          throw (e as { scope?: StopScope }).scope
            ? e
            : apiError(
                `${String(body.model)}: ${(e as Error).message}`,
                "model",
              );
        }
      }
      if (attempt >= maxAttempts) {
        throw apiError(
          `${String(body.model)}: ${last} — не получилось за ${maxAttempts} попыток`,
          "model",
        );
      }
      await sleep(wait ?? retryDelay(null, attempt));
    }
  }

  return {
    async complete(body) {
      let current = { ...body };
      let rejected = "";
      for (let i = 0; i <= OPTIONAL.length; i++) {
        const result = await send(current);
        if (!("rejected" in result)) return result;
        rejected = result.rejected;
        const field = OPTIONAL[i];
        if (field === undefined) break;
        current = Object.fromEntries(
          Object.entries(current).filter(([k]) => k !== field),
        );
      }
      throw apiError(
        `${String(body.model)}: запрос не принят (${rejected})`,
        "model",
      );
    },
  };
}
