// Настройки edge API на стороне конвейера (ADR-0024): сборка функции, превью и проверка живого
// адреса. Поведение самой функции — в apps/api/src/config.ts.

import { CDN_HOST, R2_BUCKET } from "../cdn/config.js";

/** Хост edge API (ADR-0004). */
export const API_HOST = "api.iconavo.dev";
/** Функция в Cloudflare: её создал владелец в панели, CI загружает в неё новые версии. */
export const WORKER_NAME = "iconavo-api";
/** Точка входа и tsconfig функции — от корня репозитория. */
export const WORKER_ENTRY = "apps/api/src/index.ts";
export const WORKER_TSCONFIG = "apps/api/tsconfig.json";
/** Папка сборки в корне репозитория; в git не попадает. */
export const API_OUT_DIR = "dist-api";
export const WORKER_FILE = "worker.js";
/** Часть metadata запроса загрузки функции в Cloudflare (PUT …/workers/scripts/{имя}). */
export const METADATA_FILE = "metadata.json";
/** Метка и размеры сборки — для CI и отчёта. */
export const BUILD_FILE = "build.json";
/** Метка сборки в коде функции (apps/api/src/config.ts), заменяется ровно один раз. */
export const BUILD_PLACEHOLDER = "__ICONAVO_BUILD__";
export const BUILD_ID_LENGTH = 8;
/** Привязка R2 в функции: env.CDN — бакет раздачи, тот же, что за cdn.iconavo.dev. */
export const R2_BINDING = "CDN";
export const WORKER_BUCKET = R2_BUCKET;
/**
 * Поиск (ADR-0049): env.SEARCH — закрытый бакет iconavo-search (версия индекса, векторы фраз),
 * env.SEARCH_LIMIT — лимит частоты; номер пространства лимита — свой у каждой привязки аккаунта.
 * Секреты поиска вписывает выкладка (api.yml) из окружения GitHub api.
 */
export const SEARCH_BINDING = "SEARCH";
export const LIMIT_BINDING = "SEARCH_LIMIT";
export const LIMIT_NAMESPACE = "1001";
export const SEARCH_SECRETS = [
  "MEILISEARCH_URL",
  "MEILISEARCH_SEARCH_KEY",
  "POLZA_API_KEY",
] as const;
/** Дата совместимости рантайма Workers: закреплена, меняется осознанно. */
export const COMPATIBILITY_DATE = "2026-10-01";
/** Порт превью: у страницы поиска 4280. */
export const PREVIEW_PORT = 4281;

// Проверка живого адреса (pnpm api check и pnpm cdn check).

/** Статика той же версии — с ней сверяются ответы API. */
export const STATIC_HOST = CDN_HOST;
export const API_CHECK_SET = "lucide";
/** Иконка, алиас и его иконка: home — алиас house (ADR-0018). */
export const API_CHECK_ICON = "heart";
export const API_CHECK_ALIAS = "home";
export const API_CHECK_ALIAS_PARENT = "house";
/** Имя, которого нет ни в одной версии: «_» запрещён правилом имён (ADR-0001). */
export const API_CHECK_MISSING = "_missing";
/** Имя по правилу, но не набор и не иконка. */
export const API_CHECK_ABSENT = "iconavo-missing";
/** Поворот и отражение образца на сетке 24 — точная строка transform, как у Iconify. */
export const API_CHECK_TRANSFORM =
  '<g transform="rotate(90 12 12) translate(24 0) scale(-1 1)">';
/** Ждать версию из манифеста R2: минута памяти функции и первая выкладка. */
export const API_WAIT_MS = 180_000;
export const API_WAIT_STEP_MS = 15_000;
/** Повтор пачки должен прийти из кэша: запись идёт после ответа (waitUntil). */
export const HIT_ATTEMPTS = 3;
export const HIT_PAUSE_MS = 1000;
/** Заголовки ответов функции (ADR-0023). */
export const API_CACHE_OK = "public, max-age=604800";
export const API_CACHE_ERROR = "public, max-age=300";
export const API_TYPES = {
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  css: "text/css; charset=utf-8",
} as const;
