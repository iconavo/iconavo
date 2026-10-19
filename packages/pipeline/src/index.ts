export { variantAliases } from "./build/aliases.js";
export { canonicalJson, type Json } from "./build/json.js";
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
  renderIcon,
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
  extraFiles,
  type SourceConfig,
  type SourceConfigInput,
  type SvgFolder,
  sourceConfigSchema,
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
export { elements, idMap, refsOf, renameRefs } from "./svg/refs.js";
export { escapeAttr, type SvgElement, serializeSvg } from "./svg/serialize.js";
export {
  decodeSvg,
  parseXml,
  type XmlDocument,
  type XmlElement,
  XmlParseError,
} from "./svg/xml.js";
