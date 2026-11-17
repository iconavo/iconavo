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

/**
 * Открыт ли сайт ИИ-обходчикам — как AI_CRAWLERS в apps/site/lib/headers.ts (ADR-0039). До запуска —
 * нет; в фазе 7 обе константы переключаются вместе (чек-лист запуска в docs/roadmap.md).
 */
export const AI_CRAWLERS_OPEN = false;

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

/** Путь страницы иконки без языка: lucide:house → /lucide/house (apps/site/lib/icon.ts). */
export const iconPath = (name: string) => `/${name.replace(":", "/")}`;

/**
 * Страницы иконок в обходе (шаг 4 фазы 4): их десятки тысяч, и обход открывает только эти — по одной
 * на набор с особым случаем, на обоих языках. Остальные ссылки на иконки проверяются по форме.
 * - lucide:house — линии; ph:house-bold — варианты по таблице стилей; tabler:home-filled — заливка без
 *   толщины; material-symbols:home-outline-rounded — форма; fluent-emoji-flat:waving-hand — оттенки;
 *   lucide:circle-parking — скрытая, с пометкой «Устарела».
 */
export const CRAWL_ICON_NAMES = [
  "lucide:house",
  "ph:house-bold",
  "tabler:home-filled",
  "material-symbols:home-outline-rounded",
  "fluent-emoji-flat:waving-hand",
  "lucide:circle-parking",
];
/** Скрытая иконка выборки: её страница — с пометкой «Устарела» (ADR-0037). */
export const HIDDEN_ICON = "lucide:circle-parking";
/** Мест в мокапах страницы иконки — восемь, утверждены владельцем 2 ноября 2026 (ADR-0041). */
export const MOCKUPS = 8;
export const CRAWL_ICONS = CRAWL_ICON_NAMES.flatMap((name) => [
  iconPath(name),
  `/ru${iconPath(name)}`,
]);

/** Старое имя — постоянный переход на основной адрес (ADR-0037). */
export const ICON_REDIRECTS: Record<string, string> = {
  "/lucide/home": "/lucide/house",
  "/ru/lucide/home": "/ru/lucide/house",
};
export const ICON_REDIRECT_STATUS = 308;

/**
 * Несуществующие адреса — 404. Неизвестный набор, иконка или страница документации — страница 404 в
 * раскладке своего языка (not-found.tsx): адрес из двух частей теперь — маршрут страницы иконки; из
 * трёх и больше — общая (app/global-not-found.tsx, ADR-0037).
 */
export const MISSING_PATHS = [
  "/__missing__",
  "/ru/__missing__",
  "/docs/__missing__",
  "/no-such-set",
  "/ru/no-such-set",
  "/lucide/iconavo-missing",
  "/ru/lucide/iconavo-missing",
  "/__missing__/__missing__/__missing__",
];

/**
 * Переходы: документации на русском пока нет — /ru/docs… временно ведут на английскую (next.config.ts,
 * 307); старые имена иконок — на основные (308).
 */
export const REDIRECTS: Record<string, string> = {
  "/ru/docs": "/docs",
  "/ru/docs/reference": "/docs/reference",
  ...ICON_REDIRECTS,
};
export const REDIRECT_STATUS = 307;
/** Свой код перехода у адреса; остальные — REDIRECT_STATUS. */
export const REDIRECT_CODES: Record<string, number> = Object.fromEntries(
  Object.keys(ICON_REDIRECTS).map((path) => [path, ICON_REDIRECT_STATUS]),
);

const PART = "[a-z0-9]+(?:-[a-z0-9]+)*";
const ICON_PAGE = new RegExp(`^(?:/ru)?/(${PART})/(${PART})$`);

/**
 * Адрес страницы иконки: /набор/иконка или /ru/набор/иконка; /docs/… и русская страница набора /ru/…
 * — не иконки.
 */
export function isIconPath(path: string): boolean {
  const m = ICON_PAGE.exec(path);
  // /ru/lucide совпадает как «набор ru, иконка lucide» — это русская страница набора.
  return m !== null && m[1] !== "docs" && m[1] !== "ru";
}

/** Обход идёт по ссылке: страницы иконок — только перечисленные (CRAWL_ICONS, переходы, 404). */
export const followLink = (path: string): boolean =>
  !isIconPath(path) ||
  CRAWL_ICONS.includes(path) ||
  path in ICON_REDIRECTS ||
  MISSING_PATHS.includes(path);

/** Страницы, на которые ведёт только форма поиска: обход по ссылкам их не найдёт. */
export const FORM_PAGES = ["/search", "/ru/search"];

/** Дополнительные адреса обхода — общие для pnpm site --check и --live. */
export const CRAWL_EXTRAS = [
  ...MISSING_PATHS,
  ...Object.keys(REDIRECTS),
  ...FORM_PAGES,
  ...CRAWL_ICONS,
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
/** Панель показывает выбранную иконку со сведениями не дольше: /icon превью API и локальный Meilisearch. */
export const PANEL_WAIT_MS = 15_000;
/** Метка версии данных набора на его странице (apps/site/lib/catalog-view.ts) — по ней --live видит свежесть. */
export const VERSION_META = "iconavo-version";
/**
 * Метки страницы набора и страниц его иконок (шаг 4 фазы 4, ADR-0039): отпечаток содержимого набора и
 * время сборки страницы — по ним pnpm site --refresh видит, что сбросить и что сброс сработал.
 */
export const CONTENT_META = "iconavo-content";
export const RENDERED_META = "iconavo-rendered";
/** Оглавление каталога раздачи — рядом с манифестом: catalog/{хэш}.json (ADR-0022). */
export const LIVE_CDN = "https://cdn.iconavo.dev";
/** После сброса меток страницы показывают свежие данные не сразу — ждать по умолчанию до стольких секунд. */
export const REFRESH_WAIT_S = 300;
/** Опрос живых страниц после сброса — так часто. */
export const REFRESH_POLL_MS = 10_000;
/**
 * Время сборки страницы — с часов Vercel, время сброса — с часов машины GitHub: свежей считается страница,
 * собранная не раньше чем за столько до сброса.
 */
export const REFRESH_SKEW_MS = 10_000;
/** Меток в одном вызове сброса Vercel — не больше (REST API Vercel, «Tags per bulk REST API call»). */
export const INVALIDATE_TAGS = 16;
/** Метка общих страниц сайта (apps/site/lib/catalog.ts): сбрасывается с выпуском любого набора. */
export const CATALOG_TAG = "catalog";
/**
 * Метки кэша, которые проверка сайта ждёт у страниц (строка «Метки кэша», ADR-0039): у общих — только
 * catalog, у страницы набора и страниц его иконок — только set-{набор}. Иначе выпуск любого набора
 * сбрасывал бы все страницы иконок, а у главной копились бы метки всех наборов (не больше 128 на ответ).
 */
export const CACHE_TAG_PAGES: { path: string; set?: string }[] = [
  { path: "/" },
  { path: "/sets" },
  { path: "/ru/licenses" },
  { path: "/lucide", set: "lucide" },
  { path: "/ru/lucide", set: "lucide" },
  { path: "/lucide/house", set: "lucide" },
  { path: "/ru/ph/house-bold", set: "ph" },
];
/** Манифест раздачи: версии наборов, с которыми сравнивается сайт. */
export const LIVE_MANIFEST = "https://cdn.iconavo.dev/manifest.json";

/** Окна проверки: компьютер и телефон (ширина 375 — ADR-0038). */
export const DESKTOP = { width: 1280, height: 900 };
export const PHONE = { width: 375, height: 800 };

/** Живой сайт показывает новую сборку не сразу — ждать до стольких секунд. */
export const LIVE_WAIT_MS = 180_000;

/**
 * Поиск (шаг 3 фазы 4): запросы сценария «Поиск». В проверке превью API ищет по словам в локальном
 * Meilisearch (pnpm site --check): «house» находит точные имена в нескольких наборах, «arrow» — больше
 * страницы, «zzqxv» — ничего.
 */
export const SEARCH_QUERY = "house";
export const SEARCH_PAGES_QUERY = "arrow";
export const SEARCH_EMPTY_QUERY = "zzqxv";
/** Выдача появляется не дольше: запрос и иконки браузер берёт у превью API. */
export const SEARCH_WAIT_MS = 20_000;
/** Набор со стилями для сценария «Каталог»: чипсы «Стиль» и карточки (ADR-0052). */
export const STYLES_SET = "ph";

/**
 * Генератор кода и скачивание (шаг 5 фазы 4, ADR-0042): иконка с линиями и все настройки в адресе
 * страницы — размер, цвет, толщина, поворот и отражение. Ожидания записаны дословно: проверка не
 * повторяет код сайта, а сверяет его с README тега и ответом превью edge API.
 */
export const CODE_ICON = "lucide:house";
export const CODE_SETTINGS =
  "size=64&color=e11d48&stroke=1.5&rotate=90&flip=horizontal";
export const CODE_EXPECT = {
  tag: '<iconavo-icon icon="lucide:house" width="64" color="#e11d48" stroke-width="1.5" rotate="90deg" flip="horizontal"></iconavo-icon>',
  react:
    'import { Icon } from "@iconavo-ui/react";\n\n<Icon icon="lucide:house" width={64} color="#e11d48" strokeWidth={1.5} rotate="90deg" flip="horizontal" />',
  /** Параметры адреса SVG edge API для тех же настроек. */
  query: "width=64&color=e11d48&stroke-width=1.5&rotate=90deg&flip=horizontal",
  css: (api: string) =>
    `<link rel="stylesheet" href="${api}/lucide.css?icons=house&color=e11d48&stroke-width=1.5">\n<span class="icon--lucide icon--lucide--house" style="font-size: 64px; transform: rotate(90deg) scaleX(-1)"></span>`,
  /** Цвет из адреса — у PNG. */
  rgb: [225, 29, 72] as const,
};
/** Цветной набор и заливка: в коде нет цвета и толщины или только толщины. */
export const CODE_PALETTE = {
  path: "/fluent-emoji-flat/waving-hand?size=64&color=e11d48&stroke=1.5",
  tag: '<iconavo-icon icon="fluent-emoji-flat:waving-hand" width="64"></iconavo-icon>',
};
export const CODE_FILLED = {
  path: "/ph/house-bold?color=e11d48&stroke=1.5",
  tag: '<iconavo-icon icon="ph:house-bold" width="24" color="#e11d48"></iconavo-icon>',
};
/** Размеры PNG, которые скачивает проверка: самый маленький и самый большой (ADR-0042). */
export const PNG_CHECK_SIZES = [16, 512] as const;
