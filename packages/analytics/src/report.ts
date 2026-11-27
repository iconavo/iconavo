// Чтение базы аналитики для отчёта pnpm analytics (шаг 3 фазы 5, решение владельца 27 ноября 2026,
// ADR-0055, ADR-0028): запрос `POST /analytics/query` к функции edge API с ключом ANALYTICS_REPORT_KEY.
// Право D1 у ключей Cloudflare — на все базы аккаунта, сузить его до одной базы нельзя, а функция
// привязана только к базе аналитики: так ключ отчёта не видит базу аккаунтов с почтами людей. Только
// чтение — один запрос SELECT без точки с запятой.

/** Адрес чтения у функции edge API. */
export const REPORT_PATH = "/analytics/query";

/** Тело запроса — не больше стольких байт. */
export const REPORT_MAX_BODY_BYTES = 16_384;

/** Параметров запроса — не больше, как у D1. */
export const REPORT_MAX_PARAMS = 100;

/** Значение параметра в JSON. */
export type ReportValue = string | number | null;

export interface ReportQuery {
  sql: string;
  params: ReportValue[];
}

export type ParsedReportQuery =
  | { ok: true; query: ReportQuery }
  | { ok: false; reason: string };

const isValue = (v: unknown): v is ReportValue =>
  v === null ||
  typeof v === "string" ||
  (typeof v === "number" && Number.isFinite(v));

/**
 * Запрос отчёта из тела `{ sql, params }`: SELECT с первого слова и без «;» — SQLite в нём ничего не
 * изменит, а второго запроса не будет (WITH не пускается: за ним может стоять DELETE). Параметры —
 * строки, числа и null. Не так — причина по-английски, для ответа 400.
 */
export function parseReportQuery(raw: unknown): ParsedReportQuery {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "body must be an object { sql, params }" };
  }
  const { sql, params = [] } = raw as { sql?: unknown; params?: unknown };
  if (typeof sql !== "string" || !/^\s*SELECT\s/i.test(sql)) {
    return { ok: false, reason: "sql must start with SELECT" };
  }
  if (sql.includes(";")) {
    return { ok: false, reason: "sql must be one statement without ;" };
  }
  if (
    !Array.isArray(params) ||
    params.length > REPORT_MAX_PARAMS ||
    !params.every(isValue)
  ) {
    return {
      ok: false,
      reason: `params must be at most ${REPORT_MAX_PARAMS} strings, numbers or null`,
    };
  }
  return { ok: true, query: { sql, params } };
}
