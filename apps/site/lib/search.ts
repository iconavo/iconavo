// Поиск на сайте (шаг 3 фазы 4, ADR-0040): чистые части — состояние страницы из адреса и обратно, адрес
// edge API, разбор ответа, номера страниц, ожидание после 429. Ищет браузер, а не сервер сайта: страница
// поиска статическая, и лимит 60 поисков в минуту считается по адресу человека (ADR-0049). Проверяются
// тестами без сети; состояние и запросы — в components/search/SearchResults.tsx.

import { isStyle, STYLES, type Style } from "@iconavo-ui/search";

export { isStyle, STYLES, type Style };

/** Карточек на странице (ADR-0040), всего — не дальше 1000-й: так отвечает API (ADR-0049). */
export const SEARCH_PAGE_SIZE = 96;
export const SEARCH_MAX_RESULTS = 1000;
export const SEARCH_MAX_PAGE = Math.ceil(SEARCH_MAX_RESULTS / SEARCH_PAGE_SIZE);

/** Пауза в наборе перед запросом (ADR-0040). */
export const TYPING_PAUSE_MS = 150;

/**
 * Повторы неполной выдачи (semantic: pending): полная досчитывается в фоне за 1–2 с и ложится в кэш
 * дата-центра. Повторов не больше трёх: каждый, пока полной нет, считается в лимит 60 в минуту.
 */
export const REPEAT_DELAYS_MS = [1200, 1500, 2500] as const;

/** Ожидание после 429, если API не назвал своё (Retry-After), и его пределы. */
export const RETRY_AFTER_DEFAULT_S = 60;
const RETRY_AFTER_MAX_S = 600;

/** Длина запроса — как у API (QUERY_MAX_LENGTH). */
export const QUERY_MAX_LENGTH = 100;

/** Примеры запросов до ввода: имя, слово и разговорное слово на языке страницы. */
export const SEARCH_EXAMPLES: Record<"en" | "ru", string[]> = {
  en: ["house", "trash can", "arrow right", "heart", "settings", "download"],
  ru: ["дом", "мусорка", "стрелка вправо", "сердце", "настройки", "скачать"],
};

/** Лицензии, которые разрешают коммерческое использование: конвейер принимает только их (ADR-0017). */
export const COMMERCIAL_LICENSES = ["Apache-2.0", "ISC", "MIT"];

/** Что выбрано на странице поиска: всё это — в адресе (?q=…&style=…&set=…&license=…&page=…). */
export interface SearchState {
  q: string;
  style?: Style;
  set?: string;
  license?: string;
  /** «Можно в коммерческих проектах» — только если в каталоге есть набор с ограничениями. */
  commercial?: true;
  page: number;
}

/** Что страница знает о каталоге: наборы и лицензии, которые бывают в фильтрах. */
export interface SearchKnown {
  sets: readonly string[];
  licenses: readonly string[];
}

/** Состояние из параметров адреса; незнакомые значения отбрасываются. */
export function readSearchState(
  query: URLSearchParams,
  known: SearchKnown,
): SearchState {
  const q = (query.get("q") ?? "").trim().slice(0, QUERY_MAX_LENGTH);
  const style = query.get("style");
  const set = query.get("set");
  const license = query.get("license");
  const page = Number(query.get("page"));
  const state: SearchState = {
    q,
    page:
      Number.isInteger(page) && page >= 1 && page <= SEARCH_MAX_PAGE ? page : 1,
  };
  if (isStyle(style)) state.style = style;
  if (set !== null && known.sets.includes(set)) state.set = set;
  if (license !== null && known.licenses.includes(license)) {
    state.license = license;
  }
  if (query.get("commercial") === "1" && !allCommercial(known.licenses)) {
    state.commercial = true;
  }
  return state;
}

/** Параметры адреса страницы в постоянном порядке; пустые — не пишутся, страница 1 — тоже. */
export function stateParams(state: SearchState): URLSearchParams {
  const out = new URLSearchParams();
  if (state.q !== "") out.set("q", state.q);
  if (state.style) out.set("style", state.style);
  if (state.set) out.set("set", state.set);
  if (state.license) out.set("license", state.license);
  if (state.commercial) out.set("commercial", "1");
  if (state.page > 1) out.set("page", String(state.page));
  return out;
}

/** Окно страницы: начало и число карточек; у последней, 11-й, — 40, чтобы не выйти за 1000. */
export function pageWindow(page: number): { start: number; limit: number } {
  const start = (page - 1) * SEARCH_PAGE_SIZE;
  return {
    start,
    limit: Math.max(0, Math.min(SEARCH_PAGE_SIZE, SEARCH_MAX_RESULTS - start)),
  };
}

/** Есть ли фильтры, кроме запроса и страницы. */
export const hasFilters = (state: SearchState) =>
  state.style !== undefined ||
  state.set !== undefined ||
  state.license !== undefined ||
  state.commercial === true;

/** Адрес /search edge API для состояния; без фильтров — для «без фильтров нашлось». */
export function searchApiUrl(
  api: string,
  state: SearchState,
  limit?: number,
): string {
  const window = pageWindow(state.page);
  const params = new URLSearchParams({
    query: state.q,
    limit: String(limit ?? window.limit),
  });
  if (window.start > 0 && limit === undefined) {
    params.set("start", String(window.start));
  }
  if (state.set) params.set("prefix", state.set);
  if (state.style) params.set("style", state.style);
  if (state.license) params.set("license", state.license);
  else if (state.commercial) {
    params.set("license", COMMERCIAL_LICENSES.join(","));
  }
  return `${api}/search?${params.toString()}`;
}

/** Полнота выдачи: слова и смысл, пока только слова, только слова насовсем. */
export type Semantic = "full" | "pending" | "text";

/** Карточка выдачи. */
export interface SearchCard {
  /** Карточка — базовая иконка `набор:имя`: ключ клетки, замена выдачи переиспользует клетки. */
  card: string;
  /** Что показать: имя в выбранном стиле или само точное имя (icons[] ответа). */
  icon: string;
  set: string;
  /** Имя без набора — подпись клетки. */
  name: string;
  exact: boolean;
}

export interface SearchAnswer {
  cards: SearchCard[];
  semantic: Semantic;
  /** Нашлось ли по словам или точному имени (ADR-0040). */
  matched: boolean;
  /** Есть ли следующая страница: страница полная и не последняя из 1000. */
  hasNext: boolean;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/;

/** Ответ /search; не по форме — undefined: показываем ошибку, а не пустую выдачу. */
export function parseSearchAnswer(value: unknown): SearchAnswer | undefined {
  if (
    !isObject(value) ||
    !Array.isArray(value.icons) ||
    !Array.isArray(value.results) ||
    value.icons.length !== value.results.length ||
    typeof value.total !== "number" ||
    typeof value.limit !== "number" ||
    typeof value.start !== "number" ||
    (value.semantic !== "full" &&
      value.semantic !== "pending" &&
      value.semantic !== "text")
  ) {
    return undefined;
  }
  const cards: SearchCard[] = [];
  for (const [i, result] of value.results.entries()) {
    const icon = value.icons[i];
    if (
      !isObject(result) ||
      typeof result.icon !== "string" ||
      !NAME.test(result.icon) ||
      typeof icon !== "string" ||
      !NAME.test(icon)
    ) {
      return undefined;
    }
    const colon = icon.indexOf(":");
    cards.push({
      card: result.icon,
      icon,
      set: icon.slice(0, colon),
      name: icon.slice(colon + 1),
      exact: result.exact === true,
    });
  }
  return {
    cards,
    semantic: value.semantic,
    // До шага 3 фазы 4 поля не было: тогда «нашлось» — если выдача не пуста.
    matched:
      typeof value.matched === "boolean" ? value.matched : cards.length > 0,
    hasNext:
      value.total === value.limit &&
      value.start + value.limit < SEARCH_MAX_RESULTS,
  };
}

/** Секунды ожидания после 429 из Retry-After: число секунд, иначе — по умолчанию. */
export function retryAfterSeconds(header: string | null): number {
  const n = Number(header);
  return Number.isInteger(n) && n >= 1
    ? Math.min(n, RETRY_AFTER_MAX_S)
    : RETRY_AFTER_DEFAULT_S;
}

/** Номера страниц выдачи: всего неизвестно, поэтому последняя — следующая, пока страница полная. */
export const knownPages = (page: number, hasNext: boolean) =>
  page + (hasNext && page < SEARCH_MAX_PAGE ? 1 : 0);

/** Все ли лицензии каталога разрешают коммерческое использование. */
export const allCommercial = (licenses: readonly string[]) =>
  licenses.every((l) => COMMERCIAL_LICENSES.includes(l));
