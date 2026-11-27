// Общий модуль аналитики (шаг 2 фазы 5, ADR-0043): список событий для сайта, приёма `POST /event`
// edge API и отчёта `pnpm analytics`. База — отдельный вход `@iconavo-ui/analytics/db`: сайту он не
// нужен. База поверх node:sqlite для тестов и превью — общий модуль `@iconavo-ui/d1/sqlite`.

export {
  BATCH_VERSION,
  batchBody,
  type Checked,
  COPY_WHAT,
  type CopyWhat,
  checkEvent,
  DOWNLOAD_FORMATS,
  type DownloadFormat,
  EVENT_NAMES,
  EVENT_ORIGIN,
  EVENT_PATH,
  EVENT_RATE,
  EVENTS,
  type EventName,
  type EventOf,
  LANGS,
  type Lang,
  MAX_BODY_BYTES,
  MAX_EVENTS,
  OPEN_FROM,
  type OpenFrom,
  type ParsedBatch,
  parseBatch,
  SECTIONS,
  type Section,
  type SiteEvent,
  STYLE_WHERE,
  TEST_HEADER,
} from "./events.js";
export {
  type ParsedReportQuery,
  parseReportQuery,
  REPORT_MAX_BODY_BYTES,
  REPORT_MAX_PARAMS,
  REPORT_PATH,
  type ReportQuery,
  type ReportValue,
} from "./report.js";
