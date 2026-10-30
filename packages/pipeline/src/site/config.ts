// Сайт (фаза 3, шаг 10; ADR-0050): папка, порт и ожидания проверки. Сайт — Next.js на Vercel,
// iconavo.dev: главная на двух языках (/ и /ru, фаза 4, шаг 1), заглушка поиска и документация /docs,
// собранная из README.

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

/** Несуществующие адреса: на каждый — общая страница 404 (app/global-not-found.tsx, ADR-0037). */
export const MISSING_PATHS = [
  "/__missing__",
  "/ru/__missing__",
  "/docs/__missing__",
];

/** Документации на русском пока нет: /ru/docs… временно ведут на английскую (next.config.ts). */
export const REDIRECTS: Record<string, string> = {
  "/ru/docs": "/docs",
  "/ru/docs/reference": "/docs/reference",
};
export const REDIRECT_STATUS = 307;

/** Страницы, на которые ведёт только форма поиска: обход по ссылкам их не найдёт. */
export const FORM_PAGES = ["/search", "/ru/search"];

/** Дополнительные адреса обхода — общие для pnpm site --check и --live. */
export const CRAWL_EXTRAS = [
  ...MISSING_PATHS,
  ...Object.keys(REDIRECTS),
  ...FORM_PAGES,
  "/robots.txt",
];

/** Страницы без перевода: их пара на русском — русская главная (apps/site/lib/i18n.ts). */
export const UNTRANSLATED = ["/docs"];

/** Тексты сайта, по которым проверка находит элементы (apps/site/lib/i18n.ts). */
export const SKIP_TEXT = {
  en: "Skip to content",
  ru: "Перейти к содержимому",
} as const;
export const THEME_LABEL = { en: "Theme", ru: "Тема" } as const;

/** Окна проверки: компьютер и телефон (ширина 375 — ADR-0038). */
export const DESKTOP = { width: 1280, height: 900 };
export const PHONE = { width: 375, height: 800 };

/** Живой сайт показывает новую сборку не сразу — ждать до стольких секунд. */
export const LIVE_WAIT_MS = 180_000;
