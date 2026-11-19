// Константы MCP-сервера (ADR-0044, шаг 10 фазы 4).

import { MEILI_TIMEOUT_MS, MODEL_TIMEOUT_MS } from "../../api/src/config.js";

/** Адрес протокола: https://mcp.iconavo.dev/mcp. */
export const MCP_PATH = "/mcp";

export const SITE_URL = "https://iconavo.dev";

/** Тело запроса — не больше 64 КБ: вызов инструмента — это несколько строк JSON. */
export const MAX_BODY_BYTES = 65_536;

/** Элементов во входных данных одного вызова — не больше: массивы и поля вместе. */
export const MAX_TOOL_INPUT_ELEMENTS = 100;

/**
 * Поиск для ассистента ждёт вектор запроса от модели (waitForModel): срок — с запасом на модель
 * и Meilisearch, а время ожидания не тратит процессор.
 */
export const SEARCH_DEADLINE_MS = MODEL_TIMEOUT_MS + MEILI_TIMEOUT_MS;

/** Сколько иконок отдаёт search_icons: по умолчанию 12, по просьбе ассистента — до 24. */
export const SEARCH_LIMIT_DEFAULT = 12;
export const SEARCH_LIMIT_MAX = 24;
/** Дальше 1000-го места поиск не листает (MAX_TOTAL_HITS общего модуля). */
export const SEARCH_OFFSET_MAX = 1000 - SEARCH_LIMIT_MAX;

/** Список инструментов клиент может хранить час (протокол 2026-07-28): он меняется только выкладкой. */
export const TOOLS_LIST_TTL_MS = 3_600_000;

/** Готовая картинка-сетка — неделю в кэше дата-центра: имена и версии наборов — в ключе. */
export const GRID_CACHE = "public, max-age=604800";

/** Сетка: клетка 96 px, иконка 48 px; до 12 иконок — 4 колонки, больше — 6. */
export const GRID = {
  cell: 96,
  icon: 48,
  columns: (count: number) => (count <= 12 ? 4 : 6),
  /** Цифры номера: высота знака в px и отступ от угла клетки. */
  digit: 12,
  digitInset: 7,
  background: "#ffffff",
  line: "#e4e4e7",
  number: "#71717a",
  /** currentColor монохромных наборов. */
  ink: "#18181b",
} as const;
