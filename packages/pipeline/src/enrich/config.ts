// Настройки обогащения (шаг 10, ADR-0046): модель, версия промпта, картинка, цены и лимиты.

/** Модель, которая смотрит на иконку и пишет описание и синонимы (решение владельца). */
export const MODEL = "claude-haiku-5-5";

/**
 * Версия промпта — пишется в search.json (promptVersion). 1 — Claude Haiku 5.5 и промпт из
 * prompt.ts от 20 октября 2026. Новая версия старые записи не отменяет (ADR-0020).
 */
export const PROMPT_VERSION = 1;

/** Уровень усилия модели: задача простая и массовая. Не устроит качество на выборке — medium. */
export const EFFORT = "low";

/** Место для мышления и ответа. Обрезанный ответ — отказ; платят за использованное, не за лимит. */
export const MAX_TOKENS = 4096;

/** Сторона картинки, которую видит модель (ADR-0020). */
export const PREVIEW_SIZE = 256;

/** Визуальных токенов за картинку 256×256: ⌈256/28⌉². */
export const IMAGE_TOKENS = 100;

/**
 * Цены Message Batches за миллион токенов в долларах: Claude Haiku 5.5, промпт до 100 000 токенов —
 * половина обычных. Проверено 20 октября 2026: https://platform.claude.com/docs/en/about-claude/pricing
 */
export const BATCH_PRICES = {
  input: 0.05,
  output: 0.25,
  cacheWrite: 0.0625,
  cacheRead: 0.005,
} as const;

/**
 * Токенов на один запрос для оценки до отправки — с запасом. Факт на 50 иконках Lucide 20 октября
 * 2026: ≈1100 входных и ≈230 выходных при усилии low.
 */
export const EST_INPUT_TOKENS = 1200;
export const EST_OUTPUT_TOKENS = 500;

/** Лимит стоимости прогона по умолчанию, доллары: один набор проходит, весь каталог — нет. */
export const DEFAULT_MAX_COST = 5;

/** Пауза между опросами пакета. */
export const POLL_INTERVAL_MS = 30_000;

/** Запросов в одном пакете: любой из пяти наборов помещается целиком, остальное — в следующий запуск. */
export const BATCH_LIMIT = 10_000;

/** custom_id пакета — ^[a-zA-Z0-9_-]{1,64}$; длиннее — хэш имени. */
export const CUSTOM_ID_LIMIT = 64;

/** Карточек на странице отчёта. */
export const REPORT_CARDS = 500;
