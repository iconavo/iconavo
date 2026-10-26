// Настройки поискового сервиса (ADR-0027, ADR-0049): модель векторов, индекс Meilisearch, доля смысла,
// лимиты запроса и раскладка закрытого бакета iconavo-search. Общие для функции edge API и конвейера:
// фразы каталога заранее и запрос пользователя должны считаться одинаково.

/** Модель векторов поиска (ADR-0010): id в Polza, длины вектора и ключ в путях бакета. */
export const SEARCH_MODEL = {
  id: "google/gemini-embedding-001",
  /** Длина вектора, которую модель отдаёт без параметра dimensions. */
  fullDims: 3072,
  /** Первые числа вектора, снова приведённые к длине 1 (ADR-0048). */
  dims: 1024,
  key: "gemini-1024",
} as const;

/** Индекс Meilisearch и имя эмбеддера в нём. */
export const INDEX_UID = "icons";
export const EMBEDDER = "gemini";

/**
 * Доля смысловой части в гибриде Meilisearch (semanticRatio): 0 — только слова, 1 — только смысл.
 * Подбирается замером по рабочей части эталона по правилам ADR-0049; до замера — 0,5, значение
 * Meilisearch по умолчанию.
 */
export const SEMANTIC_RATIO = 0.5;

/**
 * Точных совпадений имени — не больше: одно имя бывает в каждом наборе по разу, а наборов к запуску
 * 15–25 (roadmap). Столько же основная выдача берёт про запас, чтобы страницы шли без пропусков.
 */
export const EXACT_LIMIT = 50;

/** Длина запроса в символах; длиннее — ошибка 400. */
export const QUERY_MAX_LENGTH = 100;

/** Результатов на страницу: по умолчанию как у Iconify, не больше 96 (ADR-0040). */
export const LIMIT_DEFAULT = 64;
export const LIMIT_MAX = 96;

/** Дальше этой позиции Meilisearch не отдаёт (настройка pagination.maxTotalHits). */
export const MAX_TOTAL_HITS = 1000;

/** Раскладка бакета iconavo-search (ADR-0049). */
export const STORE_KEYS = {
  /** Версия индекса: робот пишет её последней, функция перечитывает раз в минуту. */
  index: "index.json",
  /** Векторы иконок набора и оглавление к ним, как в .cache/embeddings (ADR-0047). */
  iconVectors: (set: string) => `icons/${SEARCH_MODEL.key}/${set}.f32`,
  iconIndex: (set: string) => `icons/${SEARCH_MODEL.key}/${set}.json`,
  /** Вектор фразы каталога или запроса — по ключу vectorHash. */
  phrase: (hash: string) => `phrases/${SEARCH_MODEL.key}/${hash}.f32`,
  phrasePrefix: `phrases/${SEARCH_MODEL.key}/`,
} as const;
