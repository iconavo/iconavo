export {
  type Canvas,
  cleanNumber,
  formatNumber,
  placeOnGrid,
  readCanvas,
} from "./normalize/canvas.js";
export {
  formatNormalizeReport,
  type GalleryFile,
  PAGE_SIZE,
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
