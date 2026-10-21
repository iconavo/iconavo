// Настройки эмбеддингов (шаг 11, ADR-0047): адрес Polza AI, три модели-кандидата, формат текста
// иконки, пачки, повторы и лимит стоимости.

/** OpenAI-совместимый API агрегатора Polza AI; ключ — POLZA_API_KEY. */
export const API_URL = "https://polza.ai/api/v1";

export interface EmbeddingModel {
  /** Короткий ключ: папка в .cache/embeddings и значение --model. */
  key: string;
  /** id модели в Polza. */
  id: string;
  /** Длина вектора, которую модель отдаёт без параметра dimensions; другая длина — ошибка. */
  dims: number;
  /** Рублей за миллион входных токенов. */
  rubPerMillion: number;
  /** Текстов в одном запросе. */
  batchSize: number;
  /** Инструкция к поисковому запросу (к тексту иконки — никогда); нет — запрос уходит как есть. */
  queryInstruction?: string;
}

/**
 * Кандидаты из ADR-0007. Цены — открытый каталог Polza на 21 октября 2026
 * (https://polza.ai/api/v1/models/catalog?type=embedding): официальная цена провайдера, пересчитанная
 * примерно по 117 ₽ за доллар — $0,13, $0,15 и $0,01 за миллион токенов.
 */
export const MODELS: readonly EmbeddingModel[] = [
  {
    key: "openai",
    id: "openai/text-embedding-3-large",
    dims: 3072,
    rubPerMillion: 15.207348,
    batchSize: 100,
  },
  {
    key: "gemini",
    id: "google/gemini-embedding-001",
    dims: 3072,
    rubPerMillion: 17.54694,
    batchSize: 100,
  },
  {
    key: "qwen",
    id: "qwen/qwen3-embedding-8b",
    dims: 4096,
    rubPerMillion: 1.169796,
    batchSize: 100,
    // Карточка модели: инструкция — только у запроса и по-английски; без неё поиск хуже на 1–5%.
    queryInstruction:
      "Given a search query for an icon, retrieve icons whose description matches the query",
  },
];

/** Версия формата текста иконки (text.ts): имя, теги, описание и синонимы en, затем ru. */
export const TEXT_VERSION = 1;

/** Пачек одной модели одновременно. */
export const CONCURRENCY = 4;

/**
 * Векторы набора пишутся на диск и по ходу — каждые 10 пачек: если прогон оборвут, пропадут
 * только пачки после последней записи. 21 октября 2026 первый полный прогон остановили на
 * середине набора — оплаченные 2 000 векторов пропали.
 */
export const SAVE_EVERY_BATCHES = 10;

/** Ожидание одного ответа: пачка Qwen из 100 векторов — около 8 МБ JSON. */
export const TIMEOUT_MS = 60_000;

/** Попыток на пачку; паузы между ними, если Polza не назвала свою в Retry-After. */
export const MAX_ATTEMPTS = 5;
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000];

/** Пауза из Retry-After — не дольше минуты. */
export const RETRY_AFTER_MAX_MS = 60_000;

/**
 * Символов на токен для оценки до отправки — с запасом: русский текст дробится на токены мельче
 * английского, а в тексте иконки их поровну. Факт 21 октября 2026 на всём каталоге: OpenAI 2,92,
 * Gemini 3,86, Qwen 3,32 — оценка выше факта на треть.
 */
export const EST_CHARS_PER_TOKEN = 2.5;

/**
 * Лимит стоимости прогона по умолчанию, рубли: весь каталог тремя моделями по оценке ≈ 102 ₽,
 * по факту 21 октября 2026 — 75,86 ₽.
 */
export const DEFAULT_MAX_RUB = 200;

/**
 * Пары запросов ru/en для pnpm nearest — проверка на глаз. Ни одной из контрольной части эталона
 * (ADR-0021), и формат текста по ним не подгоняется.
 */
export const NEAREST_PAIRS: readonly (readonly [string, string])[] = [
  ["корзина", "trash"],
  ["мусорка", "trash can"],
  ["главная", "home"],
  ["настройки", "settings"],
  ["скачать", "download"],
  ["уведомления", "notifications"],
];

/** Ближайших иконок: пятёрка в терминале (Hit@5, ADR-0021), десятка на странице. */
export const TOP_TERMINAL = 5;
export const TOP_PAGE = 10;
