// Выдача поиска (ADR-0049): разбор ответа multi-search, точные совпадения впереди, страница и ответ
// API. Поля icons, total, limit и start — как у Iconify (ADR-0004): total — число иконок в ответе,
// и если оно равно limit, есть следующая страница. results и semantic — наши: карточка с вариантами
// и оттенками и полнота выдачи.

import { isValidIconName, isValidNamePart } from "@iconavo-ui/core/internal";
import { EXACT_LIMIT } from "./config.js";
import { mainWindow } from "./request.js";

/** Карточка из выдачи Meilisearch. */
export interface SearchHit {
  icon: string;
  variants: string[];
  tones: string[];
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

/** Ответ API по странице карточек. */
export function searchResponse(
  results: SearchResult[],
  page: { start: number; limit: number },
  semantic: SemanticState,
): SearchResponse {
  return {
    icons: results.map((r) => r.icon),
    total: results.length,
    limit: page.limit,
    start: page.start,
    results,
    semantic,
  };
}
