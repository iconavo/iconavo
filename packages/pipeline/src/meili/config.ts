// Настройки робота поискового индекса (ADR-0049): ключи, закрытый бакет, живой манифест раздачи,
// пачки, повторы, ожидание задач Meilisearch и лимит стоимости прогона.

/** Имена ключей в окружении; pnpm search-index читает .env сам. R2_ACCOUNT_ID — общий с раздачей. */
export const SEARCH_ENV = {
  url: "MEILISEARCH_URL",
  adminKey: "MEILISEARCH_ADMIN_KEY",
  readKey: "MEILISEARCH_READ_KEY",
  r2AccessKeyId: "SEARCH_R2_ACCESS_KEY_ID",
  r2SecretAccessKey: "SEARCH_R2_SECRET_ACCESS_KEY",
} as const;

/**
 * Закрытый бакет поиска без публичного адреса (решение владельца 26 октября 2026): векторы иконок и
 * фраз и версия индекса. Робот поиска не получает ключ записи от раздачи.
 */
export const SEARCH_BUCKET = "iconavo-search";

/** Подсказки к ответам 401 и 403 бакета поиска. */
export const SEARCH_R2_RUN_STOPS: Record<number, string> = {
  401: `ключ бакета поиска не подошёл — проверьте ${SEARCH_ENV.r2AccessKeyId} и ${SEARCH_ENV.r2SecretAccessKey}`,
  403: `у ключа нет доступа к бакету ${SEARCH_BUCKET} — нужен токен «Object Read & Write» на этот бакет; проверьте и R2_ACCOUNT_ID`,
};

/** Живой манифест раздачи: индекс не обгоняет иконки на CDN (ADR-0049). */
export const LIVE_MANIFEST_URL = "https://cdn.iconavo.dev/manifest.json";

/** Документов в одной записи: вектор — 1024 числа текстом, ≈ 20 КБ, так что пачка ≈ 10 МБ. */
export const DOCUMENTS_BATCH = 500;

/** Документов на страницу при чтении индекса. */
export const DOCUMENTS_PAGE = 1000;

/** Ожидание одного ответа Meilisearch и число попыток. */
export const MEILI_TIMEOUT_MS = 60_000;
export const MEILI_MAX_ATTEMPTS = 5;

/** Задача индексации: опрос раз в секунду, ждать не дольше 30 минут. */
export const TASK_POLL_MS = 1000;
export const TASK_TIMEOUT_MS = 30 * 60_000;

/** Пачек Polza одновременно (как у pnpm embed) и записей в бакет одновременно (как у выгрузки). */
export const EMBED_CONCURRENCY = 4;
export const PUT_CONCURRENCY = 32;

/**
 * Лимит стоимости прогона в рублях по умолчанию. Весь каталог с нуля: векторы иконок ≈ 34 ₽
 * (ADR-0047) и фразы ≈ 5 ₽ — по оценке с запасом выходит меньше.
 */
export const DEFAULT_SEARCH_MAX_RUB = 60;

/** Изменённых документов в отчёте — не больше. */
export const REPORT_SAMPLES = 50;

/** Типы файлов в бакете: векторы и оглавления; кэш браузера им не нужен — бакет закрытый. */
export const VECTOR_TYPE = "application/octet-stream";
export const JSON_TYPE = "application/json; charset=utf-8";
export const STORE_CACHE = "no-store";
