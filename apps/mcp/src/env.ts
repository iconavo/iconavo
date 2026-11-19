// Что MCP-сервер берёт у Cloudflare Workers (ADR-0044). Типы привязок — те же, что у edge API: код
// API работает внутри MCP с теми же хранилищами (шаг 10 фазы 4), а лимиты частоты — свои.

import type { Bucket, Context, RateLimiter } from "../../api/src/env.js";

export type { Bucket, Context, RateLimiter };

/**
 * Привязки функции iconavo-mcp; имена задаёт metadata.json сборки (pnpm mcp build). Секреты поиска
 * вписывает выкладка из окружения GitHub api, как у edge API; без них поиск отвечает ошибкой
 * инструмента «поиск недоступен».
 */
export interface Env {
  /** Бакет раздачи iconavo-cdn: манифест, файлы имён, каталог наборов. */
  CDN: Bucket;
  /** Закрытый бакет iconavo-search: версия индекса и векторы фраз. */
  SEARCH?: Bucket;
  /** 60 поисков в минуту с адреса человека — своё пространство счёта, не общее с API. */
  MCP_SEARCH_LIMIT?: RateLimiter;
  /** 300 сведений об иконке в минуту с адреса (get_icon) — как /icon edge API, свой счёт. */
  MCP_ICON_LIMIT?: RateLimiter;
  MEILISEARCH_URL?: string;
  MEILISEARCH_SEARCH_KEY?: string;
  POLZA_API_KEY?: string;
}
