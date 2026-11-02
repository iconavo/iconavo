// Выдача поиска (ADR-0049): разбор ответа multi-search, точные совпадения впереди, страница и ответ
// API. Поля icons, total, limit и start — как у Iconify (ADR-0004): total — число иконок в ответе,
// и если оно равно limit, есть следующая страница. results, semantic и matched — наши: карточка с
// вариантами, оттенками и стилями (ADR-0052), полнота выдачи и «нашлось ли по словам».

import { isValidIconName, isValidNamePart } from "@iconavo-ui/core/internal";
import { EXACT_LIMIT } from "./config.js";
import { mainWindow } from "./request.js";
import { isStyle, type Style } from "./styles.js";

/** Карточка из выдачи Meilisearch. */
export interface SearchHit {
  icon: string;
  variants: string[];
  tones: string[];
  /** Стиль → главное имя карточки в нём, без набора (ADR-0052). */
  styles: Partial<Record<Style, string>>;
}

/** Карточка ответа API; exact — точное совпадение имени. */
export interface SearchResult extends SearchHit {
  exact?: true;
}

/**
 * Полнота выдачи: full — слова и смысл; pending — смысл ещё считается, повторите запрос; text —
 * только слова: модель векторов недоступна (ADR-0027).
 */
export type SemanticState = "full" | "pending" | "text";

export interface SearchResponse {
  icons: string[];
  total: number;
  limit: number;
  start: number;
  results: SearchResult[];
  semantic: SemanticState;
  /**
   * Нашлось ли по словам или точному имени. false — выдача только похожа по смыслу: сайт подсказывает
   * переформулировать запрос (ADR-0040).
   */
  matched: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function names(value: unknown, what: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`${what}: ожидался список строк`);
  }
  for (const v of value) {
    if (!isValidNamePart(v)) throw new Error(`${what}: неверное имя ${v}`);
  }
  return value;
}

/** Стили карточки; нет поля — стилей нет (документ из индекса до ADR-0052). */
function stylesOf(
  value: unknown,
  what: string,
): Partial<Record<Style, string>> {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`${what}: стили — не объект`);
  const out: Partial<Record<Style, string>> = {};
  for (const [style, name] of Object.entries(value)) {
    if (!isStyle(style)) throw new Error(`${what}: неизвестный стиль ${style}`);
    if (typeof name !== "string" || !isValidNamePart(name)) {
      throw new Error(`${what}: неверное имя стиля ${style}`);
    }
    out[style] = name;
  }
  return out;
}

/** Карточки одного результата multi-search; ответ не по форме — исключение. */
export function parseHits(result: unknown): SearchHit[] {
  if (!isObject(result) || !Array.isArray(result.hits)) {
    throw new Error("ответ Meilisearch без hits");
  }
  return result.hits.map((hit) => {
    if (!isObject(hit) || typeof hit.icon !== "string") {
      throw new Error("карточка без icon");
    }
    if (!isValidIconName(hit.icon)) {
      throw new Error(`неверное имя карточки: ${hit.icon}`);
    }
    return {
      icon: hit.icon,
      variants: names(hit.variants, hit.icon),
      tones: names(hit.tones, hit.icon),
      styles: stylesOf(hit.styles, hit.icon),
    };
  });
}

/** Ответ POST /multi-search без federation: по списку карточек на запрос. */
export function parseMultiSearch(json: unknown, count: number): SearchHit[][] {
  if (!isObject(json) || !Array.isArray(json.results)) {
    throw new Error("ответ Meilisearch без results");
  }
  if (json.results.length !== count) {
    throw new Error(
      `ответов Meilisearch ${json.results.length}, запросов ${count}`,
    );
  }
  return json.results.map(parseHits);
}

/**
 * Страница выдачи: точные совпадения впереди, затем основная выдача, взятая окном mainWindow.
 * Карточка точного совпадения в основной выдаче не повторяется.
 */
export function pageResults(
  exact: readonly SearchHit[],
  main: readonly SearchHit[],
  start: number,
  limit: number,
): SearchResult[] {
  const top = exact.slice(0, EXACT_LIMIT);
  const seen = new Set(top.map((h) => h.icon));
  const rest = main.filter((h) => !seen.has(h.icon));
  const { offset } = mainWindow(start, limit);
  const out: SearchResult[] = [];
  for (let i = start; i < top.length && out.length < limit; i++) {
    out.push({ ...(top[i] as SearchHit), exact: true });
  }
  // Позиция m общей выдачи — это rest[m − top.length − offset]: окно начинается не позже нужного.
  for (
    let m = Math.max(start, top.length);
    m < start + limit && out.length < limit;
    m++
  ) {
    const hit = rest[m - top.length - offset];
    if (hit === undefined) break;
    out.push(hit);
  }
  return out;
}

/** Что ещё нужно ответу, кроме карточек: стиль фильтра, точное имя запроса и проба по словам. */
export interface ResponseExtra {
  style?: Style;
  /** Точное имя запроса: `имя` или `набор:имя` (exactName). */
  exact?: string;
  matched: boolean;
}

/**
 * Имя иконки для icons[] — то, что показать (Iconify-клиенты берут только его): главное имя
 * запрошенного стиля; у точного совпадения с вариантом или оттенком — он сам (`house-fill`, а не
 * `house`); иначе — карточка.
 */
export function shownIcon(result: SearchResult, extra: ResponseExtra): string {
  const set = result.icon.slice(0, result.icon.indexOf(":"));
  const styled =
    extra.style === undefined ? undefined : result.styles[extra.style];
  if (styled !== undefined) return `${set}:${styled}`;
  if (result.exact === true && extra.exact !== undefined) {
    const bare = extra.exact.slice(extra.exact.indexOf(":") + 1);
    if (result.variants.includes(bare) || result.tones.includes(bare)) {
      return `${set}:${bare}`;
    }
  }
  return result.icon;
}

/** Ответ API по странице карточек. */
export function searchResponse(
  results: SearchResult[],
  page: { start: number; limit: number },
  semantic: SemanticState,
  extra: ResponseExtra = { matched: results.length > 0 },
): SearchResponse {
  return {
    icons: results.map((r) => shownIcon(r, extra)),
    total: results.length,
    limit: page.limit,
    start: page.start,
    results,
    semantic,
    matched: extra.matched,
  };
}
