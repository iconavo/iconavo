export {
  extraFiles,
  type SourceConfig,
  type SourceConfigInput,
  type SvgFolder,
  sourceConfigSchema,
} from "./sources/config.js";
export { type FetchReport, fetchSource, pinEntry } from "./sources/fetch.js";
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
