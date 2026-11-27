// Чтение базы аналитики для отчёта `pnpm analytics` — `POST /analytics/query` (шаг 3 фазы 5, решение
// владельца 27 ноября 2026, ADR-0055, ADR-0028). Ключ — ANALYTICS_REPORT_KEY в заголовке Authorization:
// право D1 у ключей Cloudflare сузить до одной базы нельзя, а функция привязана только к базе
// аналитики — так отчёт не видит базу аккаунтов. Адрес есть только у функции edge API (точка входа
// index.ts), у MCP его нет. Порядок: метод → ключ → база → размер → запрос → чтение. Только чтение:
// один SELECT без «;» (parseReportQuery). Ответы не кэшируются; ни запрос, ни ответ в журнал не идут.

import { parseReportQuery, REPORT_MAX_BODY_BYTES } from "@iconavo-ui/analytics";
import type { D1Like } from "@iconavo-ui/d1";
import { TYPES } from "./config.js";
import { readCapped } from "./event.js";
import { ApiError, errorResponse, respond } from "./http.js";

/** Привязки, которые нужны чтению. */
export interface ReportEnv {
  ANALYTICS?: D1Like;
  /** Секрет окружения GitHub api; нет — адреса для отчёта нет (404). */
  ANALYTICS_REPORT_KEY?: string;
}

const NO_STORE = { "cache-control": "no-store" };

const fail = (
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response =>
  errorResponse(new ApiError(status, code, message), false, {
    ...NO_STORE,
    ...headers,
  });

const digest = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );

/** Одинаковы ли ключи: сравниваются отпечатки SHA-256 целиком — время не зависит от совпавших знаков. */
export async function sameKey(
  given: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function handleReport(
  request: Request,
  env: ReportEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return fail(
      405,
      "method_not_allowed",
      `Method ${request.method} is not allowed: use POST`,
      { allow: "POST" },
    );
  }
  const key = env.ANALYTICS_REPORT_KEY ?? "";
  if (key === "") return fail(404, "not_found", "Not found");
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!(await sameKey(given, key))) {
    return fail(401, "unauthorized", "A valid report key is required", {
      "www-authenticate": "Bearer",
    });
  }
  const db = env.ANALYTICS;
  if (db === undefined) {
    return fail(
      503,
      "analytics_unavailable",
      "Analytics is temporarily unavailable, retry later",
    );
  }
  const body = await readCapped(request, REPORT_MAX_BODY_BYTES);
  if (body === null) {
    return fail(
      413,
      "too_large",
      `Query is larger than ${REPORT_MAX_BODY_BYTES} bytes`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return fail(400, "invalid_query", "Query is not JSON");
  }
  const parsed = parseReportQuery(raw);
  if (!parsed.ok) return fail(400, "invalid_query", parsed.reason);
  try {
    const { results } = await db
      .prepare(parsed.query.sql)
      .bind(...parsed.query.params)
      .all();
    return respond(
      JSON.stringify({ results }),
      200,
      { "content-type": TYPES.json, ...NO_STORE },
      false,
    );
  } catch (e) {
    // Ошибку D1 видит только владелец ключа: она нужна, чтобы поправить запрос отчёта.
    return fail(400, "query_failed", (e as Error).message.slice(0, 300));
  }
}
