// Настройки edge API (ADR-0024, ADR-0023): метка сборки, лимиты, кэш и заголовки.

/** Метка сборки: pnpm api build заменяет её первыми 8 знаками SHA-256 бандла — ровно одно вхождение. */
export const BUILD = "__ICONAVO_BUILD__";

/**
 * Поколение кэша — часть ключа. Поднять — новые ключи во всех дата-центрах без другой правки кода:
 * ключи кэша свои, по адресу их не сбросить (ADR-0023). 2 — с 26 октября 2026: повторный замер
 * скорости поиска без векторов запросов, оставшихся в кэше от первого замера.
 */
export const CACHE_GENERATION = 2;

/** Начало ключей кэша: путь вне адресов API. */
export const CACHE_ORIGIN = "https://api.iconavo.dev/__cache";

/**
 * Имён в одной пачке или CSS — не больше. Ядро режет пачки по 500 символов адреса и по этому лимиту
 * (ADR-0030), это 20–40 имён; лимит держит в узде чтение R2 мимо кэша и 10 мс процессора бесплатного
 * тарифа.
 */
export const MAX_ICONS = 100;
/** Самое длинное имя в пяти наборах — 59 знаков. */
export const MAX_NAME_LENGTH = 64;
/** Самое длинное осмысленное значение параметра, кроме icons, — hsla(…) с пробелами. */
export const MAX_VALUE_LENGTH = 64;
/**
 * Манифест в памяти — минуту, в кэше дата-центра — ещё 30 секунд (META_CACHE): новый выпуск набора
 * виден через API не позже чем через полторы минуты.
 */
export const MANIFEST_TTL_MS = 60_000;
/**
 * Манифест и версия индекса поиска — и в кэше дата-центра: копии функции в одном дата-центре делят
 * их, и холодная копия не ждёт R2. Замер скорости поиска 26 октября 2026: два чтения по ≈ 0,1 с
 * перед каждым запросом, попавшим на холодную копию.
 */
export const META_CACHE = "public, max-age=30";
/** Запросов к R2 одновременно — лимит соединений одного вызова Workers. */
export const READ_CONCURRENCY = 6;

/** Манифест и файлы имён — та же раскладка, что на cdn.iconavo.dev (ADR-0022). */
export const MANIFEST_KEY = "manifest.json";
export const VERSION_PATTERN = /^[0-9a-f]{8}$/;

/** Cache-Control: ответ — неделя, как у Iconify; ошибка запроса — 5 минут; сбой — без кэша. */
export const CACHE_OK = "public, max-age=604800";
export const CACHE_CLIENT_ERROR = "public, max-age=300";
export const CACHE_SERVER_ERROR = "no-store";

export const TYPES = {
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  css: "text/css; charset=utf-8",
} as const;

/** Та же политика, что у SVG на статике: открытый напрямую файл не выполнит код. */
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** Поиск /search (ADR-0049). */
/** Версия индекса из бакета поиска — в памяти минуту, как манифест. */
export const SEARCH_INDEX_TTL_MS = 60_000;
/**
 * Срок первого ответа от начала запроса: не успела смысловая часть — приходит выдача по словам с
 * пометкой pending, а полная досчитывается в фоне (ADR-0040: 0,3 с для 95% поисков).
 */
export const SEARCH_DEADLINE_MS = 250;
/** Ожидание Meilisearch и модели векторов в фоне. */
export const MEILI_TIMEOUT_MS = 5_000;
export const MODEL_TIMEOUT_MS = 10_000;
/**
 * Модель не дала вектор MODEL_FAILURES_TO_PAUSE раз подряд — MODEL_RETRY_MS новые запросы без фразы в
 * бакете получают text, не зовя Polza.
 */
export const MODEL_FAILURES_TO_PAUSE = 3;
export const MODEL_RETRY_MS = 30_000;
/**
 * Кэш ответа поиска: копия на CDN — неделя, её ключ меняется с версией индекса; браузеру — 5 минут:
 * в адресе версии индекса нет. Неполная выдача (pending, text) не кэшируется нигде.
 */
export const SEARCH_CACHE_EDGE = "public, max-age=604800";
export const SEARCH_CACHE_BROWSER = "public, max-age=300";
/** Вектор нового запроса — в кэше дата-центра 30 дней. */
export const QUERY_VECTOR_CACHE = "public, max-age=2592000";
/** Векторы запросов — Polza (решение владельца 26 октября 2026). */
export const POLZA_EMBEDDINGS_URL = "https://polza.ai/api/v1/embeddings";

/** На каждом ответе, включая ошибки (ADR-0023). */
export const COMMON_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers":
    "Server-Timing, X-Cache, X-Iconavo-Build, X-Iconavo-Index, X-Iconavo-Version",
  "cross-origin-resource-policy": "cross-origin",
  "x-content-type-options": "nosniff",
};

/** Ответ на предварительный запрос CORS — как у Iconify. */
export const PREFLIGHT_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers":
    "Origin, X-Requested-With, Content-Type, Accept, Accept-Encoding",
  "access-control-max-age": "86400",
};

export const ALLOWED_METHODS = "GET, HEAD, OPTIONS";
