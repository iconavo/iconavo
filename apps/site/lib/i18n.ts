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
  footerNews: "What’s new",
  footerLicenses: "Licenses",
  navSets: "Sets",
  homeLead:
    "Any icon from open icon sets by its name, with one HTML tag or one React component.",
  homeBeta: "The packages are in beta.",
  homeDocs: "Read the docs",
  homeSets: "Popular sets",
  homeAllSets: "All sets",
  homeNews: "What’s new",
  homeAllNews: "All releases",
  searchTitle: "Search",
  searchResults: "Results",
  searchHint: "Search by name or by meaning, in English or Russian.",
  searchExamples: "For example:",
  searchStyle: "Style",
  styleAny: "Any",
  styleOutline: "Outline",
  styleFilled: "Filled",
  styleDuotone: "Duotone",
  styleColor: "Color",
  filterSet: "Set",
  searchCommercial: "All icons here can be used in commercial projects.",
  searchCommercialLink: "Licenses",
  searchCommercialLabel: "Use",
  searchCommercialOnly: "OK for commercial projects",
  searchExact: "exact name",
  searchRefining: "Refining by meaning…",
  searchSlow: "Search by meaning is taking too long — these are word matches.",
  searchRetry: "Try again",
  searchWordsOnly:
    "Search by meaning is unavailable right now — these are word matches only.",
  searchNoWords:
    "No icons match these words — here are the closest in meaning. Try other words.",
  searchNothing: "Nothing found.",
  searchRephrase:
    "Try other words or a shorter query. English and Russian both work.",
  searchNoneFiltered: "No icons match these filters.",
  searchResetFilters: "Reset filters",
  searchUnfiltered: "Without filters",
  searchNoMore: "No more results.",
  searchFirstPage: "Back to the first page",
  searchLimited:
    "Too many searches in a minute — the search will repeat by itself",
  searchLimitedIn: "in {s} s",
  searchFailed:
    "The search did not answer. Check the connection and try again.",
  searchNoScript: "Search needs JavaScript.",
  searchTiming: "Answer in {ms} ms",
  setsTitle: "Icon sets",
  setsLead:
    "Open icon sets with permissive licenses. Every icon works by its name with one HTML tag or one React component.",
  filterLicense: "License",
  filterAll: "All",
  filterNone: "No sets match these filters.",
  setMulticolor: "Multicolor",
  setMonochrome: "Monochrome",
  setAuthor: "Author",
  setLicense: "License",
  setGrid: "Grid",
  setVersion: "Version",
  setLatest: "Latest release",
  setNews: "What’s new in this set",
  setNpm: "npm package",
  setCategories: "Categories",
  setAllIcons: "All icons",
  setStyles: "Styles",
  setPages: "Pages",
  pagePrev: "Previous page",
  pageNext: "Next page",
  gridLoading: "Loading the list of icons…",
  gridError: "Could not load the list of icons. Reload the page to try again.",
  newsTitle: "What’s new",
  newsLead:
    "Releases of the icon sets, newest first. Icons are never removed: a hidden icon keeps working by its name, and a renamed one keeps its old name as an alias.",
  newsSet: "Set",
  newsFirst: "Added to the catalog",
  newsAdded: "Added",
  newsChanged: "Changed",
  newsRestored: "Restored",
  newsHidden: "Hidden",
  newsRenamed: "Renamed",
  newsAliases: "New aliases",
  newsIcons: "Icons in the set",
  newsSource: "Source",
  licensesTitle: "Licenses",
  licensesLead:
    "Icons come under the licenses of their authors. Here are each set’s author, license and its full text.",
  licenseText: "License text",
  licenseNotice: "Notice file",
  licenseSource: "Source",
  panelClose: "Close",
  panelExpand: "Expand",
  panelCollapse: "Collapse",
  panelOpenPage: "Open icon page",
  iconPreviewLight: "On a light background",
  iconPreviewDark: "On a dark background",
  iconVariants: "Variants",
  iconTones: "Skin tones",
  iconSettings: "Settings",
  iconSize: "Size",
  iconColor: "Color",
  iconColorCustom: "Custom color",
  iconColorFixed: "Multicolor icons keep their colors.",
  iconStroke: "Stroke width",
  iconRotate: "Rotate",
  iconFlip: "Flip",
  iconFlipH: "Horizontal",
  iconFlipV: "Vertical",
  iconReset: "Reset",
  iconAttribution: "Attribution",
  iconAttributionNote:
    "The license asks to keep the copyright and the license text with the icon, for example in the licenses file of your project.",
  iconBasedOn: "Based on {name} by {author}, {license}",
  iconDescription: "Description",
  iconSimilar: "Similar icons",
  iconLoading: "Loading icon details…",
  iconFailed: "Could not load icon details.",
  iconRetry: "Try again",
  iconHidden: "Deprecated",
  iconHiddenNote:
    "The author removed this icon. It keeps working by its name but is not listed in the catalog or search.",
  iconAlias: "Old name: {alias}",
  iconCopy: "Copy",
  iconCopied: "Copied",
  iconCopyName: "Copy name",
  iconToneDefault: "Default",
  iconToneLight: "Light",
  iconToneMediumLight: "Medium-light",
  iconToneMedium: "Medium",
  iconToneMediumDark: "Medium-dark",
  iconToneDark: "Dark",
  iconPageTitle: "{name} icon from {set}",
  iconPageDescription:
    "{name} — an icon from {set}: preview, settings, author and license.",
  mockupsTitle: "In an interface",
  mockupsLead:
    "The icon with your settings next to icons from the same set, in the light and dark theme.",
  mockupLight: "Light theme",
  mockupDark: "Dark theme",
  mockupButtons: "Button with a label",
  mockupTabs: "Tab bar",
  mockupMenu: "Menu item",
  mockupInput: "Input field",
  mockupToast: "Notification",
  mockupTiles: "App tile",
  mockupToolbar: "Toolbar",
  mockupSidebar: "Sidebar",
  mockupHome: "Home",
  mockupSearch: "Search",
  mockupSettings: "Settings",
  mockupProfile: "Profile",
  mockupFavorites: "Favorites",
  mockupRating: "Rating",
  mockupInputText: "Typed text",
  mockupToastText: "A short message goes here.",
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
  footerNews: "Что нового",
  footerLicenses: "Лицензии",
  navSets: "Наборы",
  homeLead:
    "Любая иконка из открытых наборов по имени — одним HTML-тегом или одним компонентом React.",
  homeBeta: "Пакеты — в бета-версии.",
  homeDocs: "Документация (англ.)",
  homeSets: "Популярные наборы",
  homeAllSets: "Все наборы",
  homeNews: "Что нового",
  homeAllNews: "Все выпуски",
  searchTitle: "Поиск",
  searchResults: "Результаты",
  searchHint: "Ищите по имени или по смыслу — по-русски или по-английски.",
  searchExamples: "Например:",
  searchStyle: "Стиль",
  styleAny: "Любой",
  styleOutline: "Контур",
  styleFilled: "Заливка",
  styleDuotone: "Двухцветные",
  styleColor: "Цветные",
  filterSet: "Набор",
  searchCommercial: "Все иконки можно использовать в коммерческих проектах.",
  searchCommercialLink: "Лицензии",
  searchCommercialLabel: "Использование",
  searchCommercialOnly: "Можно в коммерческих проектах",
  searchExact: "точное имя",
  searchRefining: "Уточняем по смыслу…",
  searchSlow: "Поиск по смыслу не успел — это совпадения по словам.",
  searchRetry: "Повторить",
  searchWordsOnly:
    "Поиск по смыслу сейчас недоступен — нашлось только по словам.",
  searchNoWords:
    "По словам совпадений нет — показываем близкие по смыслу. Попробуйте другие слова.",
  searchNothing: "Ничего не нашлось.",
  searchRephrase:
    "Попробуйте другие слова или запрос короче — можно по-русски и по-английски.",
  searchNoneFiltered: "С такими фильтрами ничего нет.",
  searchResetFilters: "Сбросить фильтры",
  searchUnfiltered: "Без фильтров",
  searchNoMore: "Больше результатов нет.",
  searchFirstPage: "К первой странице",
  searchLimited: "Слишком много поисков за минуту — поиск повторится сам",
  searchLimitedIn: "через {s} с",
  searchFailed: "Поиск не ответил. Проверьте связь и повторите.",
  searchNoScript: "Для поиска нужен JavaScript.",
  searchTiming: "Ответ за {ms} мс",
  setsTitle: "Наборы иконок",
  setsLead:
    "Открытые наборы иконок с разрешительными лицензиями. Любая иконка работает по имени — одним HTML-тегом или одним компонентом React.",
  filterLicense: "Лицензия",
  filterAll: "Все",
  filterNone: "Нет наборов с такими фильтрами.",
  setMulticolor: "Цветной",
  setMonochrome: "Монохромный",
  setAuthor: "Автор",
  setLicense: "Лицензия",
  setGrid: "Сетка",
  setVersion: "Версия",
  setLatest: "Последний выпуск",
  setNews: "Что нового в наборе",
  setNpm: "Пакет npm",
  setCategories: "Категории",
  setAllIcons: "Все иконки",
  setStyles: "Стили",
  setPages: "Страницы",
  pagePrev: "Предыдущая страница",
  pageNext: "Следующая страница",
  gridLoading: "Загружаю список иконок…",
  gridError: "Не удалось загрузить список иконок. Обновите страницу.",
  newsTitle: "Что нового",
  newsLead:
    "Выпуски наборов, свежие сверху. Иконки не пропадают: скрытая по-прежнему работает по имени, а у переименованной старое имя остаётся алиасом.",
  newsSet: "Набор",
  newsFirst: "Набор добавлен в каталог",
  newsAdded: "Добавлены",
  newsChanged: "Изменены",
  newsRestored: "Вернулись",
  newsHidden: "Скрыты",
  newsRenamed: "Переименованы",
  newsAliases: "Новые алиасы",
  newsIcons: "Иконок в наборе",
  newsSource: "Источник",
  licensesTitle: "Лицензии",
  licensesLead:
    "Иконки распространяются по лицензиям их авторов. Здесь — автор, лицензия и её полный текст для каждого набора.",
  licenseText: "Текст лицензии",
  licenseNotice: "Файл NOTICE",
  licenseSource: "Источник",
  panelClose: "Закрыть",
  panelExpand: "Развернуть",
  panelCollapse: "Свернуть",
  panelOpenPage: "Открыть страницу иконки",
  iconPreviewLight: "На светлом фоне",
  iconPreviewDark: "На тёмном фоне",
  iconVariants: "Варианты",
  iconTones: "Оттенки кожи",
  iconSettings: "Настройки",
  iconSize: "Размер",
  iconColor: "Цвет",
  iconColorCustom: "Свой цвет",
  iconColorFixed: "У цветных иконок цвет не меняется.",
  iconStroke: "Толщина линии",
  iconRotate: "Поворот",
  iconFlip: "Отражение",
  iconFlipH: "По горизонтали",
  iconFlipV: "По вертикали",
  iconReset: "Сбросить",
  iconAttribution: "Указание авторства",
  iconAttributionNote:
    "Лицензия просит хранить копирайт и её текст вместе с иконкой — например, в файле лицензий проекта.",
  iconBasedOn: "По мотивам {name} ({author}), лицензия {license}",
  iconDescription: "Описание",
  iconSimilar: "Похожие иконки",
  iconLoading: "Загружаю сведения об иконке…",
  iconFailed: "Не удалось загрузить сведения об иконке.",
  iconRetry: "Повторить",
  iconHidden: "Устарела",
  iconHiddenNote:
    "Автор убрал эту иконку. По имени она работает, но в каталоге и поиске её нет.",
  iconAlias: "Старое имя: {alias}",
  iconCopy: "Копировать",
  iconCopied: "Скопировано",
  iconCopyName: "Копировать имя",
  iconToneDefault: "Обычный",
  iconToneLight: "Светлый",
  iconToneMediumLight: "Светлее среднего",
  iconToneMedium: "Средний",
  iconToneMediumDark: "Темнее среднего",
  iconToneDark: "Тёмный",
  iconPageTitle: "Иконка {name} из набора {set}",
  iconPageDescription:
    "{name} — иконка из набора {set}: превью, настройки, автор и лицензия.",
  mockupsTitle: "В интерфейсе",
  mockupsLead:
    "Иконка с вашими настройками рядом с иконками того же набора — в светлой и тёмной теме.",
  mockupLight: "Светлая тема",
  mockupDark: "Тёмная тема",
  mockupButtons: "Кнопка с подписью",
  mockupTabs: "Панель вкладок",
  mockupMenu: "Пункт меню",
  mockupInput: "Поле ввода",
  mockupToast: "Уведомление",
  mockupTiles: "Плитка приложения",
  mockupToolbar: "Панель инструментов",
  mockupSidebar: "Боковое меню",
  mockupHome: "Главная",
  mockupSearch: "Поиск",
  mockupSettings: "Настройки",
  mockupProfile: "Профиль",
  mockupFavorites: "Избранное",
  mockupRating: "Рейтинг",
  mockupInputText: "Введённый текст",
  mockupToastText: "Здесь короткий текст сообщения.",
};

export const DICTIONARIES: Record<Lang, Dictionary> = { en, ru };

/** Названия стилей общей шкалы (ADR-0052) — ключи словаря. */
export const STYLE_KEYS = {
  outline: "styleOutline",
  filled: "styleFilled",
  duotone: "styleDuotone",
  color: "styleColor",
} as const satisfies Record<string, keyof Dictionary>;

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

/** Есть ли у страницы пара на другом языке: у документации на русском её пока нет. */
export const isTranslated = (path: string) =>
  langOf(path) === "ru" || !untranslated(path);

/** Та же страница на другом языке; у страниц без перевода — главная другого языка. */
export function counterpart(path: string): { lang: Lang; path: string } {
  if (langOf(path) === "ru") {
    return { lang: "en", path: path.slice("/ru".length) || "/" };
  }
  return { lang: "ru", path: untranslated(path) ? "/ru" : href("ru", path) };
}
