// Сайт (фаза 3, шаг 10; ADR-0050): папка, порт и ожидания проверки. Сайт — Next.js на Vercel,
// iconavo.dev; пока на нём главная и документация /docs, собранная из README.

import { join } from "node:path";

/** Папка сайта от корня репозитория. */
export const SITE_DIR = join("apps", "site");

/** Адрес pnpm site по умолчанию: 4283 — пример examples/next. */
export const SITE_PORT = 4284;

/** Живой сайт — его проверяет pnpm site --live. */
export const LIVE_SITE = "https://iconavo.dev";

/** Метка noindex до запуска 1 июня 2027 (apps/site/lib/headers.ts). */
export const ROBOTS = "noindex, nofollow";

/** Хосты иконок по умолчанию — в connect-src живого сайта ровно они. */
export const DEFAULT_ICON_HOSTS = [
  "https://api.iconavo.dev",
  "https://cdn.iconavo.dev",
  "https://cdn2.iconavo.dev",
  "https://iconavo.b-cdn.net",
];

/** Источники документации: из их разделов «##» собраны страницы. */
export const DOC_SOURCES = [
  "packages/icon/README.md",
  "apps/api/README.md",
  "packages/icon/CHANGELOG.md",
];

/** Окна проверки: компьютер и телефон (ширина 375 — ADR-0038). */
export const DESKTOP = { width: 1280, height: 900 };
export const PHONE = { width: 375, height: 800 };

/** Живой сайт показывает новую сборку не сразу — ждать до стольких секунд. */
export const LIVE_WAIT_MS = 180_000;
