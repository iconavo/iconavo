// Сайт (фаза 3, шаг 10; ADR-0050): папка, порт и ожидания проверки. Сайт — Next.js на Vercel,
// iconavo.dev: главная на двух языках (/ и /ru, фаза 4, шаг 1), заглушка поиска, документация /docs,
// собранная из README, и каталог — наборы, лента «Что нового», лицензии (фаза 4, шаг 2).

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

/**
 * Несуществующие адреса — 404. Неизвестный набор или страница документации — страница 404 в раскладке
 * своего языка (not-found.tsx), незнакомый адрес из нескольких частей — общая (app/global-not-found.tsx,
 * ADR-0037).
 */
export const MISSING_PATHS = [
  "/__missing__",
  "/ru/__missing__",
  "/docs/__missing__",
  "/no-such-set",
  "/ru/no-such-set",
  "/__missing__/__missing__/__missing__",
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

/** Набор для сценария «Каталог» (шаг 2 фазы 4): с категориями автора и больше чем тремя страницами сетки. */
export const CATALOG_SET = "lucide";
/** Иконок на странице сетки — как PAGE_SIZE сайта (apps/site/lib/catalog.ts, ADR-0040). */
export const CATALOG_PAGE_SIZE = 96;
/** Сетка показывает нужную страницу не дольше: список имён и иконки браузер берёт у превью API. */
export const CATALOG_WAIT_MS = 20_000;
/** Метка версии данных набора на его странице (apps/site/lib/catalog-view.ts) — по ней --live видит свежесть. */
export const VERSION_META = "iconavo-version";
/** Манифест раздачи: версии наборов, с которыми сравнивается сайт. */
export const LIVE_MANIFEST = "https://cdn.iconavo.dev/manifest.json";

/** Окна проверки: компьютер и телефон (ширина 375 — ADR-0038). */
export const DESKTOP = { width: 1280, height: 900 };
export const PHONE = { width: 375, height: 800 };

/** Живой сайт показывает новую сборку не сразу — ждать до стольких секунд. */
export const LIVE_WAIT_MS = 180_000;
