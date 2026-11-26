// Чтение базы аналитики для отчёта pnpm analytics (шаг 2 фазы 5, ADR-0043): живая база D1 — через HTTP
// API Cloudflare ключом только для чтения (ANALYTICS_READ_TOKEN, Account · D1 · Read; запись таким ключом
// Cloudflare отклоняет), тесты — та же база поверх node:sqlite. SQL один: оба — SQLite.

import type { D1Like, SqlValue } from "@iconavo-ui/analytics/db";
import { retryable, retryDelay } from "../embed/client.js";
import type { FetchFn } from "../sources/npm.js";

/** Строки запроса. */
export interface Reader {
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/** Сбой чтения с причиной для человека: ключ, база, сеть. */
export class ReaderError extends Error {}

/** База node:sqlite (sqliteD1) — для тестов. */
export function dbReader(db: D1Like): Reader {
  return {
    all: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      (
        await db
          .prepare(sql)
          .bind(...params)
          .all<T>()
      ).results,
  };
}

export interface HttpReaderOptions {
  accountId: string;
  databaseId: string;
  token: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  attempts?: number;
}

interface QueryAnswer {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { results?: unknown[]; success?: boolean }[];
}

const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;

/** Живая база D1: POST …/d1/database/{id}/query — по запросу на вызов, повторы на 429 и 5xx. */
export function httpReader(o: HttpReaderOptions): Reader {
  const fetchFn = o.fetch ?? fetch;
  const sleep =
    o.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const url = `https://api.cloudflare.com/client/v4/accounts/${o.accountId}/d1/database/${o.databaseId}/query`;
  return {
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      const attempts = o.attempts ?? ATTEMPTS;
      for (let attempt = 1; ; attempt++) {
        let res: Response;
        try {
          res = await fetchFn(url, {
            method: "POST",
            headers: {
              authorization: `Bearer ${o.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ sql, params }),
            signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
          });
        } catch (e) {
          if (attempt >= attempts) {
            throw new ReaderError(
              `Cloudflare не ответил: ${(e as Error).message}`,
            );
          }
          await sleep(retryDelay(null, attempt));
          continue;
        }
        if (retryable(res.status) && attempt < attempts) {
          await sleep(retryDelay(res.headers.get("retry-after"), attempt));
          continue;
        }
        let body: QueryAnswer;
        try {
          body = (await res.json()) as QueryAnswer;
        } catch {
          throw new ReaderError(`Cloudflare ответил ${res.status} не JSON`);
        }
        if (res.status === 401 || res.status === 403) {
          throw new ReaderError(
            `ключ ANALYTICS_READ_TOKEN не принят (${res.status}): нужен API-токен Cloudflare с правом Account · D1 · Read (ADR-0043)`,
          );
        }
        const rows = body.result?.[0]?.results;
        if (!res.ok || body.success !== true || !Array.isArray(rows)) {
          const message = (body.errors ?? [])
            .map((e) => e.message ?? String(e.code))
            .join("; ");
          throw new ReaderError(
            `Cloudflare ответил ${res.status}${message === "" ? "" : `: ${message.slice(0, 300)}`}`,
          );
        }
        return rows as T[];
      }
    },
  };
}
