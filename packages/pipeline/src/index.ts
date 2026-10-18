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
export { type SvgElement, serializeSvg } from "./svg/serialize.js";
export {
  decodeSvg,
  parseXml,
  type XmlDocument,
  type XmlElement,
  XmlParseError,
} from "./svg/xml.js";
