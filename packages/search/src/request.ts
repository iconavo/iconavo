// Запросы к Meilisearch (ADR-0049): тела multi-search для точного имени и основной выдачи — по словам
// или гибрид слов и смысла. Их строят и функция edge API, и замер, поэтому выдача в замере та же,
// что у пользователя. Фильтры собираются только из проверенных значений: подставить в выражение
// фильтра кавычку, скобку или оператор нельзя.

import { isValidIconName, isValidNamePart } from "@iconavo-ui/core";
import { EMBEDDER, EXACT_LIMIT, INDEX_UID, SEMANTIC_RATIO } from "./config.js";
import { DISPLAYED } from "./settings.js";

/** Фильтры выдачи: наборы, цветность, лицензии (ADR-0027). Стиль — в фазе 4. */
export interface SearchFilters {
  sets?: readonly string[];
  palette?: boolean;
  licenses?: readonly string[];
}

/** Один запрос в теле POST /multi-search. */
export interface MultiSearchQuery {
  indexUid: string;
  q: string;
  filter?: string[];
  limit: number;
  offset?: number;
  attributesToRetrieve: string[];
  vector?: number[];
  hybrid?: { embedder: string; semanticRatio: number };
}

const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

const quoted = (values: readonly string[]) =>
  values.map((v) => `"${v}"`).join(", ");

/** Условия фильтра Meilisearch, все через «и»; неверное значение — исключение. */
export function filterConditions(filters: SearchFilters): string[] {
  const out: string[] = [];
  if (filters.sets !== undefined && filters.sets.length > 0) {
    for (const set of filters.sets) {
      if (!isValidNamePart(set)) throw new Error(`неверный набор: ${set}`);
    }
    out.push(`set IN [${quoted(filters.sets)}]`);
  }
  if (filters.palette !== undefined) out.push(`palette = ${filters.palette}`);
  if (filters.licenses !== undefined && filters.licenses.length > 0) {
    for (const license of filters.licenses) {
      if (!LICENSE.test(license)) {
        throw new Error(`неверная лицензия: ${license}`);
      }
    }
    out.push(`license IN [${quoted(filters.licenses)}]`);
  }
  return out;
}

function checkedName(name: string): string {
  if (!isValidNamePart(name) && !isValidIconName(name)) {
    throw new Error(`неверное имя: ${name}`);
  }
  return name;
}

/** Карточки, у которых точно такое имя: `имя` во всех наборах или `набор:имя`. */
export function exactQuery(
  name: string,
  filters: SearchFilters,
): MultiSearchQuery {
  return {
    indexUid: INDEX_UID,
    q: "",
    filter: [...filterConditions(filters), `names = "${checkedName(name)}"`],
    limit: EXACT_LIMIT,
    attributesToRetrieve: [...DISPLAYED],
  };
}

/**
 * Окно основной выдачи для страницы. Точные совпадения стоят впереди, а основная выдача их не
 * содержит, поэтому она берётся с запасом в EXACT_LIMIT позиций: страницы идут без пропусков и
 * повторов, сколько бы точных совпадений ни нашлось.
 */
export function mainWindow(
  start: number,
  limit: number,
): { offset: number; limit: number } {
  const extra = Math.min(start, EXACT_LIMIT);
  return { offset: start - extra, limit: limit + extra };
}

export interface MainQueryOptions {
  /** Нормализованный текст запроса без префикса набора. */
  q: string;
  filters: SearchFilters;
  /** Точное имя запроса: его карточки идут отдельно и из основной выдачи исключаются. */
  exclude?: string;
  start: number;
  limit: number;
  /** Вектор запроса: есть — гибрид, нет — только слова. */
  vector?: ArrayLike<number>;
  semanticRatio?: number;
}

/** Основная выдача: слова или гибрид слов и смысла. */
export function mainQuery(options: MainQueryOptions): MultiSearchQuery {
  const window = mainWindow(options.start, options.limit);
  const filter = filterConditions(options.filters);
  if (options.exclude !== undefined) {
    filter.push(`NOT names = "${checkedName(options.exclude)}"`);
  }
  const query: MultiSearchQuery = {
    indexUid: INDEX_UID,
    q: options.q,
    limit: window.limit,
    offset: window.offset,
    attributesToRetrieve: [...DISPLAYED],
  };
  if (filter.length > 0) query.filter = filter;
  if (options.vector !== undefined) {
    // Семь знаков после запятой: косинус сдвигается меньше чем на 0,000002, а тело запроса вдвое
    // короче, чем с полной записью числа.
    query.vector = Array.from(options.vector, (v) => Math.round(v * 1e7) / 1e7);
    query.hybrid = {
      embedder: EMBEDDER,
      semanticRatio: options.semanticRatio ?? SEMANTIC_RATIO,
    };
  }
  return query;
}
