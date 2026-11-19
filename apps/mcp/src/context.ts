// Что нужно инструментам MCP (шаг 10 фазы 4, ADR-0044). Внутри MCP работает тот же код, что отвечает
// на api.iconavo.dev, с теми же хранилищами R2 и тем же Meilisearch: один вызов инструмента — ровно
// один запрос к Workers, без похода к edge API через интернет. Свои у MCP только лимиты частоты (по
// адресу человека) и ожидание вектора запроса: ассистенту смысл важнее первых 0,25 с.
// Маршруты — одни на копию функции: загрузчики делят только готовые значения (ADR-0024). Всё, что
// относится к одному запросу, приходит в Call.

import type { EdgeCache } from "../../api/src/env.js";
import { createRoutes, type Routes } from "../../api/src/handler.js";
import { SEARCH_DEADLINE_MS } from "./config.js";
import type { Bucket, Env } from "./env.js";
import type { PngRenderer } from "./png.js";

export interface McpDeps {
  routes: Routes;
  /** Бакет раздачи: файлы имён для картинки-сетки. */
  bucket: Bucket;
  cache: EdgeCache;
  /** Метка сборки — в ключах кэша и в заголовке X-Iconavo-Build. */
  build: string;
  now: () => number;
  /** Сообщения об ошибках — в журнал Workers, без адресов и текста запросов (ADR-0028). */
  log: (message: string) => void;
  render: PngRenderer;
}

/** Один запрос клиента MCP. */
export interface Call {
  /** Запрос клиента: адрес человека для лимитов частоты — cf-connecting-ip. */
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface DepsOptions {
  cache: EdgeCache;
  build: string;
  log: (message: string) => void;
  render: PngRenderer;
  now?: () => number;
  /** Подменный fetch для тестов и превью. */
  fetch?: typeof fetch;
}

export function createDeps(env: Env, o: DepsOptions): McpDeps {
  const now = o.now ?? (() => Date.now());
  const routes = createRoutes({
    bucket: env.CDN,
    cache: o.cache,
    build: o.build,
    now,
    log: o.log,
    search: {
      ...(env.SEARCH ? { bucket: env.SEARCH } : {}),
      ...(env.MCP_SEARCH_LIMIT ? { limiter: env.MCP_SEARCH_LIMIT } : {}),
      ...(env.MEILISEARCH_URL && env.MEILISEARCH_SEARCH_KEY
        ? {
            meili: {
              url: env.MEILISEARCH_URL,
              key: env.MEILISEARCH_SEARCH_KEY,
            },
          }
        : {}),
      ...(env.POLZA_API_KEY ? { polzaKey: env.POLZA_API_KEY } : {}),
      ...(o.fetch ? { fetch: o.fetch } : {}),
      deadlineMs: SEARCH_DEADLINE_MS,
      waitForModel: true,
    },
  });
  return {
    routes,
    bucket: env.CDN,
    cache: o.cache,
    build: o.build,
    now,
    log: o.log,
    render: o.render,
  };
}
