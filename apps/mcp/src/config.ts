// Константы MCP-сервера (ADR-0044, шаг 10 фазы 4).

import { MAX_TOTAL_HITS } from "@iconavo-ui/search";
import { MEILI_TIMEOUT_MS, MODEL_TIMEOUT_MS } from "../../api/src/config.js";

/** Адрес протокола: https://mcp.iconavo.dev/mcp. */
export const MCP_PATH = "/mcp";

export const SITE_URL = "https://iconavo.dev";

/** Адрес edge API: SVG с настройками — ссылкой у get_icon (svg). */
export const API_ORIGIN = "https://api.iconavo.dev";

/** get_matching_set: понятий в одном вызове — от 2 до 10. */
export const MATCH_MIN = 2;
export const MATCH_MAX = 10;
/** Карточек на понятие в выборе набора и запасных иконок. */
export const MATCH_POOL = 10;
export const MATCH_ALTERNATIVES = 2;

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
/**
 * Дальше 1000-го места поиск не листает (MAX_TOTAL_HITS общего модуля): последнее смещение — 999, а
 * страница у конца урезается до оставшегося. Раньше смещение кончалось на 976, и при 12 на странице
 * nextOffset обрывался раньше конца выдачи (ревизия фазы 5, А-11).
 */
export const SEARCH_OFFSET_MAX = MAX_TOTAL_HITS - 1;
/** Сколько иконок отдать со смещения offset: не дальше конца выдачи. */
export const windowLimit = (offset: number, limit: number): number =>
  Math.min(limit, MAX_TOTAL_HITS - offset);

/** Список инструментов клиент может хранить час (протокол 2026-07-28): он меняется только выкладкой. */
export const TOOLS_LIST_TTL_MS = 3_600_000;

/**
 * Сетка выбора в чате (pick_icon, ADR-0045): адрес интерфейса с версией страницы — клиенты MCP Apps могут
 * хранить интерфейс у себя, и новая сборка получает новый адрес. Шаблон отдаёт текущую страницу по
 * любой версии: список инструментов со старым адресом живёт у клиента до часа.
 */
export const PICKER_TEMPLATE = "ui://picker/{version}";
export const pickerUri = (version: string) => `ui://picker/${version}`;
/** Версия — 8 знаков SHA-256 страницы (pnpm mcp build). */
export const PICKER_VERSION = /^[0-9a-f]{8}$/;

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
