// Настройки MCP-сервера на стороне конвейера (ADR-0044, шаг 10 фазы 4): сборка функции, превью и
// проверка живого адреса. Поведение самой функции — в apps/mcp/src/config.ts.

import { ICON_RATE, SEARCH_RATE } from "@iconavo-ui/search";

/** Хост MCP-сервера (ADR-0004). */
export const MCP_HOST = "mcp.iconavo.dev";
export const MCP_ORIGIN = `https://${MCP_HOST}`;
/** Адрес протокола. */
export const MCP_PATH = "/mcp";
/** Функция в Cloudflare: её создал владелец в панели, CI загружает в неё новые версии. */
export const MCP_WORKER_NAME = "iconavo-mcp";
/** Точка входа и tsconfig функции — от корня репозитория. */
export const MCP_ENTRY = "apps/mcp/src/index.ts";
export const MCP_TSCONFIG = "apps/mcp/tsconfig.json";
/** Сборки пакетов под Workers: у SDK MCP — без eval и модулей Node. */
export const MCP_CONDITIONS = [
  "workerd",
  "worker",
  "browser",
  "import",
  "default",
] as const;
/** Модуль wasm рисовальщика — рядом с бандлом, отдельной частью загрузки. */
export const WASM_FILE = "resvg.wasm";
export const WASM_IMPORT = `./${WASM_FILE}`;
/** Откуда берётся модуль: пакет функции (apps/mcp). */
export const WASM_PACKAGE_FILE = "@resvg/resvg-wasm/index_bg.wasm";
/** Папка сборки в корне репозитория; в git не попадает. */
export const MCP_OUT_DIR = "dist-mcp";
/**
 * Лимит частоты поиска MCP (60 в минуту с адреса человека, как у поиска API) — своё пространство
 * счёта: поиски на сайте и в ассистенте не делят один счёт.
 */
export const MCP_SEARCH_LIMIT_BINDING = "MCP_SEARCH_LIMIT";
export const MCP_SEARCH_LIMIT_NAMESPACE = "1003";
export const MCP_SEARCH_RATE = SEARCH_RATE;
/** Сведения об иконке (get_icon): 300 в минуту с адреса, как /icon edge API, своё пространство 1004. */
export const MCP_ICON_LIMIT_BINDING = "MCP_ICON_LIMIT";
export const MCP_ICON_LIMIT_NAMESPACE = "1004";
export const MCP_ICON_RATE = ICON_RATE;
/** README тега: строки установки и разделы для get_usage вшиваются в функцию при сборке. */
export const ICON_README = "packages/icon/README.md";
export const README_MODULE = "virtual:iconavo/readme";
/**
 * Предел процессора на вызов, мс (платный тариф Workers с 19 ноября 2026: без него — 30 с).
 * Сетка из 24 иконок на компьютере владельца — до 12 мс; запас — на холодный старт копии (SDK и
 * рисовальщик). Предел страхует счёт от сбоев и перебора.
 */
export const MCP_CPU_MS = 300;
/** Порт превью: у API 4281, у песочницы 4282, у примера 4283, у сайта 4284. */
export const MCP_PREVIEW_PORT = 4285;
