// Клиент Meilisearch поверх встроенного fetch (ADR-0049): индекс, настройки, документы, задачи и
// multi-search. Повторы и остановки — общие с хранилищами раздачи (cdn/storage.ts): временные отказы,
// сбои сети и истёкшее ожидание повторяются с паузой; ключ не подошёл — «СТОП» всего прогона; другой
// отказ — «СТОП» с текстом ошибки Meilisearch. Изменения Meilisearch делает задачами: клиент ждёт их
// завершения и превращает неудачную задачу в ошибку. Ключ никуда не печатается.

import { requestWithRetries } from "../cdn/storage.js";
import { retryable } from "../embed/client.js";
import type { FetchFn } from "../sources/npm.js";
import {
  DOCUMENTS_PAGE,
  MEILI_MAX_ATTEMPTS,
  MEILI_TIMEOUT_MS,
  SEARCH_ENV,
  TASK_POLL_MS,
  TASK_TIMEOUT_MS,
} from "./config.js";

/** Ответы, после которых нет смысла продолжать. */
export const MEILI_RUN_STOPS: Record<number, string> = {
  401: `ключ Meilisearch не подошёл — проверьте ${SEARCH_ENV.adminKey} (для показа хватит ${SEARCH_ENV.readKey}) и ${SEARCH_ENV.url}`,
  403: `у ключа Meilisearch нет прав на это действие — для записи нужен Default Admin API Key в ${SEARCH_ENV.adminKey}`,
};

export interface MeiliTask {
  uid: number;
  status: string;
  type: string;
  error?: { message?: string; code?: string } | null;
}

export interface MeiliIndex {
  uid: string;
  primaryKey: string | null;
}

/** То, что нужно роботу индекса и замеру; в тестах его подменяют (fake.testing.ts). */
export interface MeiliClient {
  /** Индекс; нет индекса — undefined. */
  index(uid: string): Promise<MeiliIndex | undefined>;
  createIndex(uid: string, primaryKey: string): Promise<number>;
  settings(uid: string): Promise<Record<string, unknown>>;
  updateSettings(uid: string, settings: object): Promise<number>;
  /** Все документы индекса, только поля fields. */
  documents(
    uid: string,
    fields: readonly string[],
  ): Promise<Record<string, unknown>[]>;
  /** Добавить или заменить документы целиком. */
  addDocuments(uid: string, documents: readonly object[]): Promise<number>;
  deleteDocuments(uid: string, ids: readonly string[]): Promise<number>;
  /** Дождаться задачи; неудачная или отменённая задача — исключение. */
  waitTask(taskUid: number): Promise<MeiliTask>;
  multiSearch(queries: readonly object[]): Promise<unknown>;
}

export interface MeiliOptions {
  url: string;
  apiKey: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  taskPollMs?: number;
  taskTimeoutMs?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Номер задачи из ответа 202. */
function taskUidOf(json: unknown, label: string): number {
  if (isObject(json) && Number.isInteger(json.taskUid)) {
    return json.taskUid as number;
  }
  throw new Error(`${label}: в ответе Meilisearch нет taskUid`);
}

export function meiliClient(options: MeiliOptions): MeiliClient {
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const base = options.url.replace(/\/+$/, "");
  const rules = {
    runStops: MEILI_RUN_STOPS,
    retryable,
    secrets: [options.apiKey],
    sleep,
    timeoutMs: options.timeoutMs ?? MEILI_TIMEOUT_MS,
    maxAttempts: options.maxAttempts ?? MEILI_MAX_ATTEMPTS,
  };
  const pollMs = options.taskPollMs ?? TASK_POLL_MS;
  const taskTimeoutMs = options.taskTimeoutMs ?? TASK_TIMEOUT_MS;

  /** Запрос с JSON-ответом; allow404 — 404 даёт undefined. */
  function call(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    allow404 = false,
  ): Promise<unknown> {
    return requestWithRetries(
      `Meilisearch ${method} ${path.split("?")[0]}`,
      (signal) =>
        fetchFn(`${base}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        }),
      async (res) => {
        const text = await res.text();
        if (res.status === 404) return undefined;
        return text === "" ? undefined : JSON.parse(text);
      },
      { ...rules, allow404 },
    );
  }

  const indexPath = (uid: string) => `/indexes/${encodeURIComponent(uid)}`;

  return {
    async index(uid) {
      const json = await call("GET", indexPath(uid), undefined, true);
      if (json === undefined) return undefined;
      if (!isObject(json) || typeof json.uid !== "string") {
        throw new Error("Meilisearch: ответ об индексе не по форме");
      }
      return {
        uid: json.uid,
        primaryKey:
          typeof json.primaryKey === "string" ? json.primaryKey : null,
      };
    },
    async createIndex(uid, primaryKey) {
      return taskUidOf(
        await call("POST", "/indexes", { uid, primaryKey }),
        "создание индекса",
      );
    },
    async settings(uid) {
      const json = await call("GET", `${indexPath(uid)}/settings`);
      if (!isObject(json)) {
        throw new Error("Meilisearch: настройки индекса не по форме");
      }
      return json;
    },
    async updateSettings(uid, settings) {
      return taskUidOf(
        await call("PATCH", `${indexPath(uid)}/settings`, settings),
        "настройки индекса",
      );
    },
    async documents(uid, fields) {
      const out: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += DOCUMENTS_PAGE) {
        const query = new URLSearchParams({
          fields: fields.join(","),
          limit: String(DOCUMENTS_PAGE),
          offset: String(offset),
        });
        const json = await call("GET", `${indexPath(uid)}/documents?${query}`);
        if (!isObject(json) || !Array.isArray(json.results)) {
          throw new Error("Meilisearch: список документов не по форме");
        }
        for (const doc of json.results) {
          if (!isObject(doc)) {
            throw new Error("Meilisearch: документ не по форме");
          }
          out.push(doc);
        }
        const total = Number(json.total);
        if (
          json.results.length < DOCUMENTS_PAGE ||
          (Number.isFinite(total) && out.length >= total)
        ) {
          return out;
        }
      }
    },
    async addDocuments(uid, documents) {
      return taskUidOf(
        await call(
          "POST",
          `${indexPath(uid)}/documents?primaryKey=id`,
          documents,
        ),
        "запись документов",
      );
    },
    async deleteDocuments(uid, ids) {
      return taskUidOf(
        await call("POST", `${indexPath(uid)}/documents/delete-batch`, ids),
        "удаление документов",
      );
    },
    async waitTask(taskUid) {
      const started = now();
      for (;;) {
        const json = await call("GET", `/tasks/${taskUid}`);
        if (!isObject(json) || typeof json.status !== "string") {
          throw new Error(`Meilisearch: задача ${taskUid} не по форме`);
        }
        const task = json as unknown as MeiliTask;
        if (task.status === "succeeded") return task;
        if (task.status === "failed" || task.status === "canceled") {
          const reason = task.error?.message ?? task.status;
          throw new Error(
            `Meilisearch: задача ${taskUid} (${task.type}) не выполнена — ${reason}`,
          );
        }
        if (now() - started > taskTimeoutMs) {
          throw new Error(
            `Meilisearch: задача ${taskUid} (${task.type}) не завершилась за ${Math.round(taskTimeoutMs / 60_000)} мин`,
          );
        }
        await sleep(pollMs);
      }
    },
    async multiSearch(queries) {
      return call("POST", "/multi-search", { queries });
    },
  };
}
