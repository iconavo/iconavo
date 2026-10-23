// Что функция берёт у Cloudflare Workers — свои минимальные типы вместо @cloudflare/workers-types:
// новая зависимость ради нескольких строк не нужна. Функция только читает: у привязки R2 есть и
// запись, но код её не вызывает (ADR-0028).

/** Объект R2 с телом — часть R2ObjectBody. */
export interface StoredObject {
  text(): Promise<string>;
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

/** Привязки функции; имя CDN задаёт metadata.json сборки (pnpm api build). */
export interface Env {
  CDN: Bucket;
}

/** Контекст запроса — часть ExecutionContext. */
export interface Context {
  waitUntil(promise: Promise<unknown>): void;
}
