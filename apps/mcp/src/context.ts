// Что нужно инструментам MCP (шаг 10 фазы 4, ADR-0044). Внутри MCP работает тот же код, что отвечает
// на api.iconavo.dev, с теми же хранилищами R2 и тем же Meilisearch: один вызов инструмента — ровно
// один запрос к Workers, без похода к edge API через интернет. Свои у MCP только лимиты частоты (по
// адресу человека) и ожидание вектора запроса: ассистенту смысл важнее первых 0,25 с.
// Маршруты — одни на копию функции: загрузчики делят только готовые значения (ADR-0024). Всё, что
// относится к одному запросу, приходит в Call.

import type { Usage } from "@iconavo-ui/snippets/readme";
import type { EdgeCache } from "../../api/src/env.js";
import { createRoutes, type Routes } from "../../api/src/handler.js";
import type { MeiliConfig } from "../../api/src/search/meili.js";
import { SEARCH_DEADLINE_MS } from "./config.js";
import type { Bucket, Env, RateLimiter } from "./env.js";
import type { PngRenderer } from "./png.js";

/** Поиск get_matching_set — те же ключи и хранилища, что у маршрута /search. */
export interface SearchDeps {
  bucket?: Bucket;
  meili?: MeiliConfig;
  polzaKey?: string;
  fetch: typeof fetch;
  limiter?: RateLimiter;
}

export interface McpDeps {
  routes: Routes;
  /** Бакет раздачи: файлы имён для картинки-сетки и SVG. */
  bucket: Bucket;
  cache: EdgeCache;
  search: SearchDeps;
  /** Метка сборки — в ключах кэша и в заголовке X-Iconavo-Build. */
  build: string;
  now: () => number;
  /** Сообщения об ошибках — в журнал Workers, без адресов и текста запросов (ADR-0028). */
  log: (message: string) => void;
  render: PngRenderer;
  /** Строки установки и разделы README тега — вшиты при сборке (pnpm mcp build). */
  usage: Usage;
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
  usage: Usage;
  now?: () => number;
  /** Подменный fetch для тестов и превью. */
  fetch?: typeof fetch;
}

export function createDeps(env: Env, o: DepsOptions): McpDeps {
  const now = o.now ?? (() => Date.now());
  const meili =
    env.MEILISEARCH_URL && env.MEILISEARCH_SEARCH_KEY
      ? { url: env.MEILISEARCH_URL, key: env.MEILISEARCH_SEARCH_KEY }
      : undefined;
  const routes = createRoutes({
    bucket: env.CDN,
    cache: o.cache,
    build: o.build,
    now,
    log: o.log,
    search: {
      ...(env.SEARCH ? { bucket: env.SEARCH } : {}),
      ...(env.MCP_SEARCH_LIMIT ? { limiter: env.MCP_SEARCH_LIMIT } : {}),
      ...(env.MCP_ICON_LIMIT ? { iconLimiter: env.MCP_ICON_LIMIT } : {}),
      ...(meili ? { meili } : {}),
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
    search: {
      ...(env.SEARCH ? { bucket: env.SEARCH } : {}),
      ...(meili ? { meili } : {}),
      ...(env.POLZA_API_KEY ? { polzaKey: env.POLZA_API_KEY } : {}),
      fetch: o.fetch ?? ((input, init) => fetch(input, init)),
      ...(env.MCP_SEARCH_LIMIT ? { limiter: env.MCP_SEARCH_LIMIT } : {}),
    },
    build: o.build,
    now,
    log: o.log,
    render: o.render,
    usage: o.usage,
  };
}
