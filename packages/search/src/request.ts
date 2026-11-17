// Запросы к Meilisearch (ADR-0049): тела multi-search для точного имени и основной выдачи — по словам
// или гибрид слов и смысла. Их строят и функция edge API, и замер, поэтому выдача в замере та же,
// что у пользователя. Фильтры собираются только из проверенных значений: подставить в выражение
// фильтра кавычку, скобку или оператор нельзя.

import { isValidIconName, isValidNamePart } from "@iconavo-ui/core/internal";
import { EMBEDDER, EXACT_LIMIT, INDEX_UID, SEMANTIC_RATIO } from "./config.js";
import { RESULT_FIELDS } from "./settings.js";
import { isStyle, type Style } from "./styles.js";

/** Фильтры выдачи: наборы, цветность, лицензии (ADR-0027) и стиль общей шкалы (ADR-0052). */
export interface SearchFilters {
  sets?: readonly string[];
  palette?: boolean;
  licenses?: readonly string[];
  style?: Style;
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
  /** Оценка карточки в ответе (`_rankingScore`): списки замера и их разбор (шаг 8 фазы 4). */
  showRankingScore?: boolean;
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
  if (filters.style !== undefined) {
    if (!isStyle(filters.style)) {
      throw new Error(`неверный стиль: ${String(filters.style)}`);
    }
    out.push(`style = "${filters.style}"`);
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
    attributesToRetrieve: [...RESULT_FIELDS],
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

/** Условия основной выдачи: фильтры и, если есть, исключение карточек точного имени. */
function mainFilter(filters: SearchFilters, exclude?: string): string[] {
  const filter = filterConditions(filters);
  if (exclude !== undefined) {
    filter.push(`NOT names = "${checkedName(exclude)}"`);
  }
  return filter;
}

/**
 * Вектор запроса в теле: семь знаков после запятой. Косинус сдвигается меньше чем на 0,000002, а тело
 * запроса вдвое короче, чем с полной записью числа.
 */
const bodyVector = (vector: ArrayLike<number>) =>
  Array.from(vector, (v) => Math.round(v * 1e7) / 1e7);

/** Основная выдача: слова или гибрид слов и смысла. */
export function mainQuery(options: MainQueryOptions): MultiSearchQuery {
  const window = mainWindow(options.start, options.limit);
  const filter = mainFilter(options.filters, options.exclude);
  const query: MultiSearchQuery = {
    indexUid: INDEX_UID,
    q: options.q,
    limit: window.limit,
    offset: window.offset,
    attributesToRetrieve: [...RESULT_FIELDS],
  };
  if (filter.length > 0) query.filter = filter;
  if (options.vector !== undefined) {
    query.vector = bodyVector(options.vector);
    query.hybrid = {
      embedder: EMBEDDER,
      semanticRatio: options.semanticRatio ?? SEMANTIC_RATIO,
    };
  }
  return query;
}

export interface ScoredQueryOptions {
  /** Нормализованный текст запроса без префикса набора. */
  q: string;
  filters: SearchFilters;
  /** Точное имя запроса: его карточки идут отдельно и из списка исключаются. */
  exclude?: string;
  /** Первых карточек списка. */
  limit: number;
  /** Поля карточки; по умолчанию — только имя. */
  fields?: readonly string[];
}

/**
 * Только слова — с оценкой Meilisearch (`_rankingScore`, 0…1: доля от лучшей возможной по правилам
 * ранжирования). Списки для замера (шаг 8 фазы 4): по ним видно, нашлась ли иконка словами.
 */
export function keywordQuery(options: ScoredQueryOptions): MultiSearchQuery {
  const query: MultiSearchQuery = {
    indexUid: INDEX_UID,
    q: options.q,
    limit: options.limit,
    attributesToRetrieve: [...(options.fields ?? ["icon"])],
    showRankingScore: true,
  };
  const filter = mainFilter(options.filters, options.exclude);
  if (filter.length > 0) query.filter = filter;
  return query;
}

/**
 * Только смысл — доля смысла 1, с оценкой близости вектора запроса к карточке. Текст запроса тоже
 * идёт: гибрид без текста Meilisearch считает «поиском без запроса» и векторы не сравнивает.
 */
export function semanticQuery(
  options: ScoredQueryOptions & { vector: ArrayLike<number> },
): MultiSearchQuery {
  return {
    ...keywordQuery(options),
    vector: bodyVector(options.vector),
    hybrid: { embedder: EMBEDDER, semanticRatio: 1 },
  };
}

/**
 * Проба «нашлось ли по словам» (ADR-0040): одна карточка только по словам, с теми же фильтрами. Гибрид
 * всегда находит соседей по смыслу, а сайту нужно знать, совпали ли слова, — чтобы подсказать, что
 * выдача только похожа по смыслу.
 */
export function probeQuery(
  q: string,
  filters: SearchFilters,
): MultiSearchQuery {
  const query: MultiSearchQuery = {
    indexUid: INDEX_UID,
    q,
    limit: 1,
    attributesToRetrieve: ["icon"],
  };
  const filter = filterConditions(filters);
  if (filter.length > 0) query.filter = filter;
  return query;
}
