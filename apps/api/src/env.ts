// Что функция берёт у Cloudflare Workers — свои минимальные типы вместо @cloudflare/workers-types:
// новая зависимость ради нескольких строк не нужна. Функция только читает: у привязок R2 есть и
// запись, но код её не вызывает (ADR-0028).

/** Объект R2 с телом — часть R2ObjectBody. */
export interface StoredObject {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Привязка R2 — часть R2Bucket. */
export interface Bucket {
  get(key: string): Promise<StoredObject | null>;
}

/** Кэш дата-центра (Cache API) — часть Cache. */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Привязка ограничения частоты (Rate Limiting) — счёт свой в каждом дата-центре. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Привязки функции; имена задаёт metadata.json сборки (pnpm api build). Поиск (ADR-0049) — закрытый
 * бакет iconavo-search, лимит частоты и секреты, которые выкладка вписывает из окружения GitHub api;
 * без них /search отвечает 503, а иконки работают как прежде.
 */
export interface Env {
  CDN: Bucket;
  SEARCH?: Bucket;
  SEARCH_LIMIT?: RateLimiter;
  MEILISEARCH_URL?: string;
  MEILISEARCH_SEARCH_KEY?: string;
  POLZA_API_KEY?: string;
}

/** Контекст запроса — часть ExecutionContext. */
export interface Context {
  waitUntil(promise: Promise<unknown>): void;
}
