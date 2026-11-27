// Чтение базы аналитики для отчёта pnpm analytics: живая база — через функцию edge API
// (`POST /analytics/query` с ключом ANALYTICS_REPORT_KEY; шаг 3 фазы 5, решение владельца 27 ноября 2026,
// ADR-0055, ADR-0028), тесты — та же база поверх node:sqlite. SQL один: оба — SQLite. Прежний путь —
// HTTP API Cloudflare с ключом D1 — убран: право D1 у ключа нельзя сузить до одной базы, и он читал бы
// базу аккаунтов с почтами людей.

import { REPORT_PATH, type ReportValue } from "@iconavo-ui/analytics";
import type { D1Like } from "@iconavo-ui/d1";
import { retryable, retryDelay } from "../embed/client.js";
import type { FetchFn } from "../sources/npm.js";

/** Строки запроса. */
export interface Reader {
  all<T>(sql: string, params?: readonly ReportValue[]): Promise<T[]>;
}

/** Сбой чтения с причиной для человека: ключ, функция, сеть. */
export class ReaderError extends Error {}

/** База node:sqlite (sqliteD1) — для тестов. */
export function dbReader(db: D1Like): Reader {
  return {
    all: async <T>(sql: string, params: readonly ReportValue[] = []) =>
      (
        await db
          .prepare(sql)
          .bind(...params)
          .all<T>()
      ).results,
  };
}

/** Адрес edge API по умолчанию. */
export const REPORT_BASE = "https://api.iconavo.dev";

export interface ApiReaderOptions {
  /** https://api.iconavo.dev или превью http://127.0.0.1:порт. */
  base?: string;
  key: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  attempts?: number;
}

interface QueryAnswer {
  results?: unknown;
  error?: unknown;
  message?: unknown;
}

const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;

/** Почему функция не отдала строки — по коду ответа; ключа в тексте нет. */
function failure(status: number, body: QueryAnswer | undefined): string {
  const message =
    typeof body?.message === "string" ? `: ${body.message.slice(0, 300)}` : "";
  if (status === 401) {
    return "ключ ANALYTICS_REPORT_KEY не принят (401): в .env и в секрете окружения GitHub api он должен быть один и тот же (ADR-0055)";
  }
  if (status === 404) {
    return "у функции edge API нет ключа отчёта (404): секрет ANALYTICS_REPORT_KEY окружения GitHub api — и «Edge API» с «выложить заново» (ADR-0055)";
  }
  if (status === 400) return `запрос отчёта отклонён (400)${message}`;
  return `edge API ответил ${status}${message}`;
}

/** Живая база: POST {base}/analytics/query — по запросу на вызов, повторы на сбой сети, 429 и 5xx. */
export function apiReader(o: ApiReaderOptions): Reader {
  const fetchFn = o.fetch ?? fetch;
  const sleep =
    o.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const url = new URL(REPORT_PATH, o.base ?? REPORT_BASE).href;
  return {
    async all<T>(sql: string, params: readonly ReportValue[] = []) {
      const attempts = o.attempts ?? ATTEMPTS;
      for (let attempt = 1; ; attempt++) {
        let res: Response;
        try {
          res = await fetchFn(url, {
            method: "POST",
            headers: {
              authorization: `Bearer ${o.key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ sql, params }),
            signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
          });
        } catch (e) {
          if (attempt >= attempts) {
            throw new ReaderError(
              `edge API не ответил: ${(e as Error).message}`,
            );
          }
          await sleep(retryDelay(null, attempt));
          continue;
        }
        if (retryable(res.status) && attempt < attempts) {
          await sleep(retryDelay(res.headers.get("retry-after"), attempt));
          continue;
        }
        let body: QueryAnswer | undefined;
        try {
          body = (await res.json()) as QueryAnswer;
        } catch {
          body = undefined;
        }
        if (!res.ok) throw new ReaderError(failure(res.status, body));
        if (!Array.isArray(body?.results)) {
          throw new ReaderError(`edge API ответил ${res.status} без строк`);
        }
        return body.results as T[];
      }
    },
  };
}
