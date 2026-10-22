export { baseName, variantAliases } from "./build/aliases.js";
export { canonicalJson, compactJson, type Json } from "./build/json.js";
export {
  formatBuildReport,
  renderBuildGallery,
  sizeChange,
} from "./build/report.js";
export {
  type BuildOptions,
  type BuildSizes,
  type BuiltIcon,
  buildSet,
  type SetBuildReport,
  writeSetData,
} from "./build/run.js";
export { renameRetrying, writeFileAtomic } from "./build/write.js";
export {
  CHECK_GROUPS,
  type CheckGroup,
  type CheckIssue,
  type CheckKind,
  type CheckOptions,
  type CheckReport,
  checkCdn,
  checkFailed,
  type TargetReport,
} from "./cdn/check.js";
export {
  CHECK_GROUP_TITLES,
  CHECK_HINTS,
  formatCheckSummary,
  formatCheckTable,
} from "./cdn/check-report.js";
export {
  CACHE_IMMUTABLE,
  CACHE_MANIFEST,
  CDN_HOST,
  CF_CACHE_RULE,
  CF_HEADERS_RULE,
  CF_SVG_RULE,
  CHAIN_LIMIT,
  CHECK_ICON,
  CHECK_MAX_ATTEMPTS,
  CHECK_MISSING,
  CHECK_ORIGIN,
  CHECK_SET,
  CHECK_TIMEOUT_MS,
  CHECKSUM_ALGORITHM,
  CHECKSUMS_LIMIT,
  CHECKSUMS_SUFFIX,
  CONTENT_TYPES,
  CORS_ALLOW_ORIGIN,
  EDGE_CACHED,
  EDGE_DIRECT,
  LIST_PAGE_SIZE,
  MANIFEST_FILE,
  MISMATCH_LIMIT,
  OUT_DIR,
  PROGRESS_EVERY,
  R2_BUCKET,
  R2_ENV,
  R2_REGION,
  r2Endpoint,
  SECURITY_HEADERS,
  SVG_CSP,
  TREE_LIMIT,
  UPLOAD_CONCURRENCY,
  UPLOAD_MAX_ATTEMPTS,
  UPLOAD_TIMEOUT_MS,
  VERSIONS_DIR,
  WRITE_CONCURRENCY,
} from "./cdn/config.js";
export {
  type CdnFile,
  type Checksums,
  checksumsSchema,
  checksumsText,
  effectiveIcon,
  type Manifest,
  type ManifestEntry,
  manifestSchema,
  manifestText,
  nameFile,
  type ResolvedName,
  resolveChain,
  setFiles,
} from "./cdn/files.js";
export { type CdnSet, loadCdnSet, transformedNames } from "./cdn/load.js";
export {
  CDN_STYLE,
  formatCdnReport,
  formatCdnSummary,
  formatCdnTable,
  renderCdnPage,
} from "./cdn/report.js";
export {
  buildCdn,
  type CdnExample,
  type CdnOptions,
  type CdnReport,
  type CdnStatus,
  cdnStop,
  type SetCdnReport,
} from "./cdn/run.js";
export {
  md5Hex,
  type PutOptions,
  parseListPage,
  R2_RUN_STOPS,
  type R2Client,
  type R2Options,
  type R2StopScope,
  type RemoteObject,
  r2Client,
  r2Error,
  r2ErrorScope,
} from "./cdn/s3.js";
export {
  amzDate,
  canonicalPath,
  canonicalQuery,
  EMPTY_SHA256,
  type SignedRequest,
  type SignInput,
  sha256Hex,
  signRequest,
  uriEncode,
} from "./cdn/sigv4.js";
export { type CdnIcon, svgOf, widthEm } from "./cdn/svg.js";
export {
  type Comparison,
  compareWithRemote,
  contentTypeOf,
  type LocalFile,
  type ManifestStatus,
  readSetFiles,
  type SetUploadReport,
  setObjects,
  type UploadOptions,
  type UploadReport,
  type UploadStatus,
  uploadCdn,
  uploadStop,
} from "./cdn/upload.js";
export {
  formatUploadReport,
  formatUploadSummary,
  formatUploadTable,
  MANIFEST_STATUS,
  renderUploadPage,
  UPLOAD_STATUS,
} from "./cdn/upload-report.js";
export {
  checksumsPath,
  cleanupStale,
  sameVersionOnDisk,
  setDir,
  versionDir,
  writeIfChanged,
  writeSetVersion,
} from "./cdn/write.js";
export {
  type ChangelogInput,
  changelogMarkdown,
  humanDate,
  isoDate,
  MARKDOWN_LIMIT,
  type NextChangelog,
  needsApproval,
  nextChangelog,
  releaseSection,
  secondsOf,
} from "./changelog/journal.js";
export {
  type AuthorAlias,
  type FreshSet,
  type HistoryChanges,
  hasChanges,
  type MergeResult,
  mergeHistory,
  noChanges,
  type SkippedAlias,
} from "./changelog/merge.js";
export {
  CARD_LIMIT,
  changelogSection,
  formatChangelog,
  renderChangelogPage,
} from "./changelog/report.js";
export {
  authorAliases,
  type ChangelogOptions,
  type SetChangelog,
  setChangelog,
} from "./changelog/run.js";
export {
  flatten,
  iconsFileOf,
  resolve,
  type SetState,
  type StateIcon,
  sameState,
  stateOf,
  versionOf,
  visibleCount,
} from "./changelog/state.js";
export {
  apiError,
  type EmbeddingClient,
  type EmbedResult,
  errorScope,
  type PolzaOptions,
  polzaEmbeddingClient,
  RUN_STOPS,
  retryable,
  retryDelay,
  type StopScope,
} from "./embed/client.js";
export {
  API_URL,
  BACKOFF_MS,
  CONCURRENCY,
  DEFAULT_MAX_RUB,
  type EmbeddingModel,
  EST_CHARS_PER_TOKEN,
  MAX_ATTEMPTS,
  MODELS,
  NEAREST_PAIRS,
  RETRY_AFTER_MAX_MS,
  SAVE_EVERY_BATCHES,
  TEXT_VERSION,
  TIMEOUT_MS,
  TOP_PAGE,
  TOP_TERMINAL,
} from "./embed/config.js";
export {
  addSpent,
  estimateRub,
  formatRub,
  noSpent,
  rubOfTokens,
  type Spent,
} from "./embed/cost.js";
export {
  type ModelNearest,
  median,
  type NearestOptions,
  type NearestReport,
  type Neighbor,
  nearestQueries,
  nearestStop,
  overlap,
  type QueryResult,
  topK,
  type VectorSet,
} from "./embed/nearest.js";
export {
  type ParsedEmbeddings,
  parseEmbeddings,
  unitVector,
} from "./embed/parse.js";
export {
  EMBED_STYLE,
  formatEmbedReport,
  formatEmbedTable,
  formatMb,
  formatMs,
  formatNearest,
  renderEmbedPage,
  renderNearestPage,
} from "./embed/report.js";
export {
  type EmbedOptions,
  type EmbedReport,
  embedSets,
  embedStatus,
  hasStop,
  type IconText,
  loadTexts,
  type ModelEmbedReport,
  type ModelSetReport,
  type ModelStatus,
  type SetInfo,
  type SetTexts,
  type StatusCell,
  setTexts,
} from "./embed/run.js";
export {
  bytesToFloat32,
  type IndexRead,
  readIndex,
  readStore,
  STORE_FORMAT,
  type StoredVectors,
  type StoreIndex,
  type StoreRead,
  type StoreRow,
  storeIndexSchema,
  storePaths,
  writeStore,
} from "./embed/store.js";
export { iconText, queryInput, textHash } from "./embed/text.js";
export {
  applyEnrichment,
  type CarryResult,
  carryEnrichment,
  type Enrichment,
  enrichmentBases,
  isEnriched,
} from "./enrich/apply.js";
export {
  type BatchClient,
  type BatchMessage,
  type BatchRequest,
  type BatchResponse,
  type BatchResult,
  type BatchState,
  type BatchStatus,
  batchStateSchema,
  readState,
  removeState,
  STATE_FILE,
  writeState,
} from "./enrich/batch.js";
export { anthropicBatchClient } from "./enrich/client.js";
export {
  BATCH_LIMIT,
  BATCH_PRICES,
  CUSTOM_ID_LIMIT,
  DEFAULT_MAX_COST,
  EFFORT,
  EST_INPUT_TOKENS,
  EST_OUTPUT_TOKENS,
  IMAGE_TOKENS,
  MAX_TOKENS,
  MODEL,
  POLL_INTERVAL_MS,
  PREVIEW_SIZE,
  PROMPT_VERSION,
  REPORT_CARDS,
} from "./enrich/config.js";
export {
  type CostTotal,
  estimateCost,
  formatUsd,
  sumCost,
  type TokenUsage,
} from "./enrich/cost.js";
export {
  normalizeSynonyms,
  type ParseOutcome,
  parseAnswer,
  resultOutcome,
  SYNONYMS_MAX,
  SYNONYMS_MIN,
} from "./enrich/parse.js";
export {
  answerFormat,
  answerSchema,
  buildRequest,
  customId,
  type EnrichInput,
  SYSTEM_PROMPT,
  userText,
} from "./enrich/prompt.js";
export {
  ENRICH_STYLE,
  formatEnrichReport,
  formatEnrichTable,
  renderEnrichPage,
} from "./enrich/report.js";
export {
  type CardStatus,
  countBases,
  type EnrichCard,
  type EnrichOptions,
  enrichSets,
  type LoadedSet,
  loadSet,
  type SetEnrichReport,
} from "./enrich/run.js";
export { type Selection, selectIcons } from "./enrich/select.js";
export {
  type ChatClient,
  type ChatOptions,
  type ChatResult,
  polzaChatClient,
} from "./eval/client.js";
export {
  AGREEMENT_SHARE,
  ALPHA_GRID,
  CHUNK_SIZE,
  DEPTH,
  EST_IMAGE_TOKENS,
  EST_OUTPUT_TOKENS as JUDGE_EST_OUTPUT_TOKENS,
  EST_TEXT_TOKENS,
  HIT_K,
  IMAGE_DETAIL,
  IMAGE_SIZE,
  JUDGE_MODEL,
  JUDGE_RUB_PER_MILLION,
  LENGTH_TOLERANCE,
  LENGTHS,
  MAX_ROUNDS,
  MRR_K,
  REASONING_EFFORT,
  SET_DEPTH,
  SIGNIFICANCE,
  SPOT_CHECK,
} from "./eval/config.js";
export {
  COLUMNS,
  csvCell,
  currentLabels,
  fitsOf,
  type GoldenQuery,
  type Judged,
  type Judgments,
  judgmentsSchema,
  LANGS,
  type Labels,
  type Lang,
  type Overrides,
  overridesSchema,
  parseCsv,
  parseQueries,
  type QueryType,
  readJudgments,
  readOverrides,
  readQueries,
  SPLITS,
  type Split,
  TYPES,
  VERDICTS,
  type Verdict as JudgeVerdict,
  writeJudgments,
} from "./eval/golden.js";
export {
  agreementOf,
  estimateRub as estimateJudgeRub,
  type JudgeOptions,
  type JudgeReport,
  type JudgeRound,
  judgeEval,
  judgeStop,
  noSpent as noJudgeSpent,
  pilotSample,
  repeatPair,
  type Spent as JudgeSpent,
  shuffle,
  verdictCounts,
} from "./eval/judge.js";
export {
  type CurvePoint,
  hitAt,
  type LengthPoint,
  type Paired,
  paired,
  pickAlpha,
  pickLength,
  precisionAt,
  type Row,
  reciprocalRank,
  type Summary,
  summarize,
  wilson,
} from "./eval/metrics.js";
export {
  type Candidate,
  candidateLines,
  JUDGE_INSTRUCTIONS,
  judgeBody,
  parseVerdicts,
  promptText,
  VERDICT_SCHEMA,
} from "./eval/prompt.js";
export {
  baselineJson,
  formatEvalReport,
  formatJudgeReport,
  renderEvalPage,
  renderJudgePage,
} from "./eval/report.js";
export {
  type EvalOptions,
  type EvalReport,
  evalStop,
  evaluate,
  GROUPS,
  type Group,
  LANG_KEYS,
  type LangKey,
  type LengthResult,
  type Recommendation,
  type SystemResult,
} from "./eval/run.js";
export {
  type Choice,
  configChoice,
  modelLengths,
  type RankingInput,
  type Rankings,
  type Role,
  rankAll,
  type System,
  systems,
  type Tuned,
  tuneAlphas,
  unlabeled,
} from "./eval/systems.js";
export { fingerprint } from "./metadata/fingerprint.js";
export {
  type AuthorMetadata,
  type MetadataReader,
  READERS,
} from "./metadata/formats.js";
export {
  type LicenseStatus,
  licenseHash,
  normalizeText,
  readLicense,
  type SetLicense,
} from "./metadata/license.js";
export {
  type PhosphorEntry,
  parsePhosphorModule,
} from "./metadata/phosphor.js";
export {
  formatMetadata,
  formatMetadataTable,
  metadataSection,
  renderMetadataPage,
  TAG_SAMPLE,
} from "./metadata/report.js";
export {
  type AuthorRead,
  type IconMetadata,
  type MetadataIcon,
  type MetadataOptions,
  MISSING_METADATA_LIMIT,
  pickSamples,
  readAuthorMetadata,
  SAMPLE_CONCEPTS,
  SAMPLE_COUNT,
  type SetFile,
  type SetMetadata,
  setMetadata,
} from "./metadata/run.js";
export { authorTags, nameTags } from "./metadata/tags.js";
export {
  type Canvas,
  cleanNumber,
  formatNumber,
  placeOnGrid,
  readCanvas,
} from "./normalize/canvas.js";
export {
  cardLink,
  formatNormalizeReport,
  type GalleryFile,
  type GalleryItem,
  type GallerySet,
  PAGE_SIZE,
  type PageKind,
  renderGallery,
} from "./normalize/gallery.js";
export { type IdsResult, renameIds } from "./normalize/ids.js";
export {
  iconToSvg,
  type NormalizedIcon,
  type NormalizeOptions,
  type NormalizeResult,
  type NormalizeStats,
  normalizeSvg,
} from "./normalize/normalize.js";
export {
  FOREGROUND,
  normalizePaint,
  type PaintStats,
  parseColor,
  type Rgba,
} from "./normalize/paint.js";
export {
  type NormalizeCounts,
  type NormalizedEntry,
  normalizeSet,
  type SetNormalizeReport,
} from "./normalize/run.js";
export { PRECISION, SUPPORTED_GRIDS, SVGO_CONFIG } from "./optimize/config.js";
export {
  type OptimizeResult,
  optimizeIcon,
  roundSize,
} from "./optimize/optimize.js";
export {
  type Baseline,
  baselineFromTexts,
  gitHistory,
  type History,
  iconsByName,
  loadBaseline,
} from "./qc/baseline.js";
export {
  CHANGED_NAMES_LIMIT,
  CHANGED_PIXELS,
  CROP_LIMIT,
  EMPTY_LIMIT,
  MARGIN,
  RENDER_SIZE,
  REPORT_LIMIT,
  SPARSE_LIMIT,
} from "./qc/config.js";
export {
  coverage,
  crop,
  difference,
  type Image,
  inkOnly,
  overflow,
  overlay,
  type Rect,
  unpremultiply,
} from "./qc/pixels.js";
export { encodePng, pngDataUri } from "./qc/png.js";
export {
  canvasRect,
  type IconRender,
  initRenderer,
  paddedSvg,
  previewSvg,
  renderIcon,
  renderPreview,
  renderSource,
} from "./qc/render.js";
export {
  formatQc,
  qcSection,
  renderQcPage,
} from "./qc/report.js";
export {
  checkSet,
  QC_KINDS,
  type QcFinding,
  type QcImage,
  type QcInput,
  type QcKind,
  type SetQcReport,
  share,
} from "./qc/run.js";
export { checkSafeSvg } from "./sanitize/check.js";
export {
  formatFixtures,
  formatSanitizeReport,
  renderSanitizeHtml,
} from "./sanitize/report.js";
export {
  EXCLUDE_LIMIT,
  type FixtureOutcome,
  listIcons,
  type SetSanitizeReport,
  sanitizeFixtures,
  sanitizeSet,
} from "./sanitize/run.js";
export {
  countShapes,
  type Removal,
  type RemovalKind,
  type SanitizeOptions,
  type SanitizeResult,
  sanitizeSvg,
} from "./sanitize/sanitize.js";
export {
  buildCatalog,
  type Catalog,
  loadCatalog,
  type SearchDoc,
  type SetDocs,
  setDocs,
} from "./search/catalog.js";
export {
  FIELD_WEIGHTS,
  FIELDS,
  type Field,
  MATCH_QUALITY,
  type MatchKind,
  MODEL_SEARCH,
  type ModelSearch,
  PAGE_PORT,
  PAGE_RESULTS,
  PER_SET_MODEL,
  PREFIX_MAX_EXPANSIONS,
  PREFIX_MIN_LENGTH,
  STOP_WORDS,
  TONE_SUFFIXES,
  TYPO_MIN_LENGTH,
  VECTOR_NORM_RANK,
} from "./search/config.js";
export {
  exactDocs,
  type Mode,
  nameForm,
  type Prepared,
  prepare,
  type Ranked,
  rankPrepared,
  textQuery,
} from "./search/hybrid.js";
export {
  type CardOptions,
  type Column,
  MODE_NAMES,
  renderSearchPage,
  resultCard,
  resultColumn,
  SEARCH_STYLE,
  type SearchPage,
} from "./search/page.js";
export {
  type QueryVectors,
  queryHash,
  queryVectorPath,
  queryVectors,
} from "./search/query-vectors.js";
export {
  allowedHost,
  type Reply,
  reply,
  type SearchContext,
  searchReply,
  startSearchServer,
} from "./search/server.js";
export {
  buildTextIndex,
  type DocWords,
  expansions,
  normalizeWord,
  queryWords,
  searchText,
  type TextIndex,
  type TextResult,
  typoDistance,
  type WordMatch,
  words,
} from "./search/text.js";
export {
  catalogBytes,
  cosines,
  loadModelVectors,
  type ModelVectors,
  vectorLengths,
} from "./search/vectors.js";
export {
  downloadRules,
  extraFiles,
  LICENSE_IDS,
  LICENSE_TITLES,
  type LicenseId,
  METADATA_FILES,
  METADATA_FORMATS,
  type MetadataFormat,
  metadataFiles,
  NOTICE_FILES,
  pathPattern,
  type SourceConfig,
  type SourceConfigInput,
  type SvgFolder,
  sourceConfigSchema,
  wantedPath,
} from "./sources/config.js";
export {
  cachedSourceDir,
  type FetchReport,
  fetchSource,
  listFiles,
  pinEntry,
  sourceLabel,
} from "./sources/fetch.js";
export {
  baseRevision,
  isReleaseTag,
  lastCommit,
  latestReleaseTag,
  parseRemoteTags,
  type RemoteTag,
  releaseTagsByCommit,
  remoteTags,
  resolveGitTag,
} from "./sources/git.js";
export {
  type LockEntry,
  type LockFile,
  readLock,
  writeLock,
} from "./sources/lock.js";
export {
  checkNames,
  iconNameFromFile,
  type NameCheck,
} from "./sources/names.js";
export { loadRegistry } from "./sources/registry.js";
export { formatReport } from "./sources/report.js";
export { compareVersions, parseVersion } from "./sources/version.js";
export { elements, idMap, refsOf, renameRefs } from "./svg/refs.js";
export { escapeAttr, type SvgElement, serializeSvg } from "./svg/serialize.js";
export {
  decodeSvg,
  parseXml,
  type XmlDocument,
  type XmlElement,
  XmlParseError,
} from "./svg/xml.js";
export {
  type Decision,
  decide,
  isDowngrade,
  type Verdict,
} from "./update/decide.js";
export {
  ATTENTION_LIMIT,
  BODY_LIMIT,
  PR_LABELS,
  type PrInput,
  type PrLinks,
  type PrText,
  prMarker,
  prText,
  revisionName,
} from "./update/pr.js";
export {
  ATTENTION_KINDS,
  type AttentionKind,
  type BuildSummary,
  buildSummarySchema,
  type SetSummary,
  SUMMARY_FILE,
  setSummary,
  setSummarySchema,
  summaryText,
} from "./update/summary.js";
export { pool } from "./util/pool.js";
