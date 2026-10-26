// Настройки индекса Meilisearch (ADR-0027, ADR-0049). Робот индекса ставит их, только если они
// отличаются от тех, что в индексе. Поиск по словам — по имени, тегам автора и синонимам ru/en, без
// описаний: описания идут только в вектор (решение владельца, ADR-0048). Опечатки — как у
// Meilisearch по умолчанию, с ними сверялся и прототип. Точное имя ищется фильтром по полю names.

import { EMBEDDER, MAX_TOTAL_HITS, SEARCH_MODEL } from "./config.js";

/**
 * Служебные слова: в запросе они не ищутся. «в» есть в синонимах 697 иконок и перевешивало бы
 * опечатку в главном слове («добавить в корзину»). Плюс «иконка» и «значок» — их пишут к любому
 * запросу. Тот же список у прототипа (ADR-0048).
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  // ru
  "а",
  "без",
  "в",
  "во",
  "для",
  "до",
  "за",
  "и",
  "из",
  "или",
  "к",
  "ко",
  "на",
  "не",
  "о",
  "об",
  "от",
  "по",
  "под",
  "при",
  "про",
  "с",
  "со",
  "у",
  "значка",
  "значки",
  "значок",
  "иконка",
  "иконки",
  "иконку",
  // en
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "icon",
  "icons",
]);

/** Поля документа: что ищется словами, что фильтруется и что отдаётся в выдаче. */
export const SEARCHABLE = ["name", "tags", "synonymsEn", "synonymsRu"] as const;
export const FILTERABLE = ["license", "names", "palette", "set"] as const;
export const DISPLAYED = ["icon", "variants", "tones"] as const;

/** Настройки индекса — ровно то, что ставит робот. */
export const INDEX_SETTINGS = {
  searchableAttributes: [...SEARCHABLE],
  filterableAttributes: [...FILTERABLE],
  displayedAttributes: [...DISPLAYED],
  // Порядок Meilisearch по умолчанию; при равенстве — короткое имя (calendar раньше calendar-days),
  // затем порядок наборов и имя по алфавиту, как у прототипа.
  rankingRules: [
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness",
    "parts:asc",
    "setOrder:asc",
    "icon:asc",
  ],
  stopWords: [...STOP_WORDS].sort(),
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
  },
  embedders: {
    [EMBEDDER]: { source: "userProvided", dimensions: SEARCH_MODEL.dims },
  },
  pagination: { maxTotalHits: MAX_TOTAL_HITS },
};

export type IndexSettings = typeof INDEX_SETTINGS;
