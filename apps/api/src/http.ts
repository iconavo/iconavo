// Ответы API: заголовки ADR-0023 и короткие ошибки JSON (ADR-0024). Тексты ошибок — по-английски:
// их читают разработчики и ИИ-ассистенты.

import {
  ALLOWED_METHODS,
  CACHE_CLIENT_ERROR,
  CACHE_SERVER_ERROR,
  COMMON_HEADERS,
  PREFLIGHT_HEADERS,
  TYPES,
} from "./config.js";
import { compactJson } from "./json.js";

/** Ошибка с кодом ответа и кодом для программ: «set_not_found», «invalid_color»… */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** R2 не ответил или ответил не так: 503 без кэша, повторить позже. */
export class StorageError extends Error {}

/** Ответ с заголовками; на HEAD — без тела. */
export function respond(
  body: string | null,
  status: number,
  headers: Record<string, string>,
  head: boolean,
): Response {
  return new Response(head ? null : body, {
    status,
    headers: { ...COMMON_HEADERS, ...headers },
  });
}

export function errorResponse(
  error: ApiError,
  head: boolean,
  headers: Record<string, string> = {},
): Response {
  const body = compactJson({
    status: error.status,
    error: error.code,
    message: error.message,
  });
  return respond(
    body,
    error.status,
    {
      "content-type": TYPES.json,
      "cache-control":
        error.status >= 500 ? CACHE_SERVER_ERROR : CACHE_CLIENT_ERROR,
      ...(error.status === 405 ? { allow: ALLOWED_METHODS } : {}),
      ...headers,
    },
    head,
  );
}

/** Предварительный запрос CORS: любой путь, без тела. */
export function preflight(): Response {
  return respond(null, 204, PREFLIGHT_HEADERS, true);
}
