// Общий модуль поискового сервиса (ADR-0049): его берут функция edge API (apps/api) и конвейер
// (робот индекса, замер). Здесь только то, что обе стороны обязаны считать одинаково.

export {
  baseName,
  type Card,
  type CardSet,
  type CardsInput,
  groupCards,
  TONE_SUFFIXES,
} from "./cards.js";
export {
  EMBEDDER,
  EXACT_LIMIT,
  INDEX_UID,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  MAX_TOTAL_HITS,
  QUERY_MAX_LENGTH,
  SEARCH_MODEL,
  SEARCH_RATE,
  SEMANTIC_RATIO,
  STORE_KEYS,
} from "./config.js";
export { documentId, type SearchDocument } from "./document.js";
export {
  exactName,
  nameForm,
  normalizeText,
  stripSetPrefix,
} from "./normalize.js";
export {
  exactQuery,
  filterConditions,
  type MainQueryOptions,
  type MultiSearchQuery,
  mainQuery,
  mainWindow,
  probeQuery,
  type SearchFilters,
} from "./request.js";
export {
  pageResults,
  parseHits,
  parseMultiSearch,
  type ResponseExtra,
  type SearchHit,
  type SearchResponse,
  type SearchResult,
  type SemanticState,
  searchResponse,
  shownIcon,
} from "./response.js";
export {
  DISPLAYED,
  FILTERABLE,
  INDEX_SETTINGS,
  type IndexSettings,
  SEARCHABLE,
  STOP_WORDS,
} from "./settings.js";
export {
  isStyle,
  STYLES,
  type Style,
  type StyleTable,
  styleCandidates,
} from "./styles.js";
export {
  bytesVector,
  truncateUnit,
  vectorBytes,
  vectorHash,
} from "./vector.js";
