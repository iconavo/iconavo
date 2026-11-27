// Что функция берёт у Cloudflare Workers — свои минимальные типы вместо @cloudflare/workers-types:
// новая зависимость ради нескольких строк не нужна. Хранилища раздачи и поиска функция только читает:
// у привязок R2 есть и запись, но код её не вызывает (ADR-0028). Пишет она только в базу аналитики.

import type { D1Like } from "@iconavo-ui/d1";

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
  /** Лимит частоты /icon (шаг 4 фазы 4): 300 в минуту с адреса мимо кэша. */
  ICON_LIMIT?: RateLimiter;
  MEILISEARCH_URL?: string;
  MEILISEARCH_SEARCH_KEY?: string;
  POLZA_API_KEY?: string;
  /**
   * База аналитики iconavo-analytics (шаг 2 фазы 5, ADR-0043): приём событий /event и итоги дня по
   * расписанию. Нет — /event отвечает 503, остальное работает как прежде.
   */
  ANALYTICS?: D1Like;
  /** Лимит частоты /event: 60 пачек в минуту с адреса. */
  EVENT_LIMIT?: RateLimiter;
  /** Страницы, с которых /event берёт события, через запятую. Только у превью: в Cloudflare его нет. */
  EVENT_ORIGINS?: string;
  /**
   * Ключ чтения базы аналитики для отчёта pnpm analytics — `POST /analytics/query` (шаг 3 фазы 5,
   * ADR-0055): секрет окружения GitHub api. Нет — адреса для отчёта нет.
   */
  ANALYTICS_REPORT_KEY?: string;
}

/** Контекст запроса — часть ExecutionContext. */
export interface Context {
  waitUntil(promise: Promise<unknown>): void;
}
