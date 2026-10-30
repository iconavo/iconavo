// Языки сайта (ADR-0037): английский — на /, русский — на /ru. Тексты интерфейса — здесь, словарь на
// язык с одинаковыми ключами: пропуск в русском словаре не пропустит TypeScript. Документации на русском
// пока нет (решение владельца 30 октября 2026): у её страниц пары на русском нет, а /ru/docs… временно
// ведут на английскую (next.config.ts).

export const LANGS = ["en", "ru"] as const;
export type Lang = (typeof LANGS)[number];

/** Названия языков — на самих языках: так их ищут в переключателе. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: "English",
  ru: "Русский",
};

const en = {
  description:
    "Any icon from open icon sets by its name, with one HTML tag or one React component.",
  skip: "Skip to content",
  mainNav: "Main",
  docs: "Docs",
  searchLabel: "Search icons",
  searchPlaceholder: "Search icons",
  searchSubmit: "Search",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  footerCode: "Code:",
  footerIcons: "Icons: their authors’ licenses.",
  homeLead:
    "Any icon from open icon sets by its name, with one HTML tag or one React component.",
  homeBeta:
    "The packages are in beta. The catalog with search in English and Russian is coming in 2027.",
  homeDocs: "Read the docs",
  searchTitle: "Search",
  searchSoon:
    "Search is coming soon. Until then, the docs show how to add any icon by its name.",
  searchDocs: "Go to the docs",
} as const;

export type Dictionary = Record<keyof typeof en, string>;

const ru: Dictionary = {
  description:
    "Любая иконка из открытых наборов по имени — одним HTML-тегом или одним компонентом React.",
  skip: "Перейти к содержимому",
  mainNav: "Основное",
  docs: "Документация (англ.)",
  searchLabel: "Поиск иконок",
  searchPlaceholder: "Найти иконку",
  searchSubmit: "Найти",
  theme: "Тема",
  themeSystem: "Как в системе",
  themeLight: "Светлая",
  themeDark: "Тёмная",
  footerCode: "Код:",
  footerIcons: "Иконки — по лицензиям авторов.",
  homeLead:
    "Любая иконка из открытых наборов по имени — одним HTML-тегом или одним компонентом React.",
  homeBeta:
    "Пакеты — в бета-версии. Каталог с поиском на русском и английском появится в 2027 году.",
  homeDocs: "Документация (англ.)",
  searchTitle: "Поиск",
  searchSoon:
    "Поиск появится скоро. А пока документация (на английском) показывает, как вставить любую иконку по имени.",
  searchDocs: "К документации",
};

export const DICTIONARIES: Record<Lang, Dictionary> = { en, ru };

/** Адреса без перевода: на русском их пара — английская страница. */
const UNTRANSLATED = ["/docs"];

const untranslated = (path: string) =>
  UNTRANSLATED.some((p) => path === p || path.startsWith(`${p}/`));

/** Язык страницы по адресу: /ru и всё под ним — русский. */
export const langOf = (path: string): Lang =>
  path === "/ru" || path.startsWith("/ru/") ? "ru" : "en";

/**
 * Адрес страницы на языке: путь пишется как у английской версии («/», «/search»); у русской — с /ru,
 * а страницы без перевода остаются английскими.
 */
export function href(lang: Lang, path: string): string {
  if (lang === "en" || untranslated(path)) return path;
  return path === "/" ? "/ru" : `/ru${path}`;
}

/** Та же страница на другом языке; у страниц без перевода — главная другого языка. */
export function counterpart(path: string): { lang: Lang; path: string } {
  if (langOf(path) === "ru") {
    return { lang: "en", path: path.slice("/ru".length) || "/" };
  }
  return { lang: "ru", path: untranslated(path) ? "/ru" : href("ru", path) };
}
