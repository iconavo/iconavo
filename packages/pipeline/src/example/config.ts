// Пример на Next.js (фаза 3, шаг 7; ADR-0033): папка, адрес и пороги проверки.

import { join } from "node:path";

/** Папка примера от корня репозитория. */
export const EXAMPLE_DIR = join("examples", "next");

/** Имена иконок примера — их читают и страницы, и проверка. */
export const NAMES_FILE = join("app", "icons.json");

/** Адрес pnpm example по умолчанию: 4280 — поиск, 4281 — превью API, 4282 — песочница. */
export const EXAMPLE_PORT = 4283;

/** Ответы API в проверке задержаны: до них место держит резерв, а иконки обёртки уже на месте. */
export const SLOW_MS = 800;

/** Next.js в режиме разработки собирает страницу при первом запросе — на медленном компьютере долго. */
export const START_TIMEOUT_MS = 180_000;

/** Next.js не вышел за столько после SIGTERM — SIGKILL всей группе процессов (Linux, macOS). */
export const STOP_TIMEOUT_MS = 10_000;

/** Окно браузера в проверке: раздел «С сервера» целиком на экране. */
export const VIEWPORT = { width: 1000, height: 1400 };
