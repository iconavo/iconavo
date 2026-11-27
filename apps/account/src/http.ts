// Ответы сервиса: заголовки защиты, CORS только для страниц сайта и короткие ошибки JSON — того же вида,
// что у Better Auth: { code, message }. Тексты ошибок — по-английски: их читает код сайта.

import { BUILD, CAPTCHA_HEADER, LOCALE_HEADER } from "./config.js";

/** Заголовки защиты у каждого ответа. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-site",
  "x-iconavo-build": BUILD,
};

/** У ответов API — без кэша и без вставки куда-либо. */
export const API_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

/** Заголовок для сайта: следующий вход — только с Turnstile. */
export const CAPTCHA_STATE_HEADER = "x-iconavo-captcha";

/** CORS для страниц сайта: с cookie, только этот адрес. */
export function corsHeaders(site: string): Record<string, string> {
  return {
    "access-control-allow-origin": site,
    "access-control-allow-credentials": "true",
    "access-control-expose-headers": CAPTCHA_STATE_HEADER,
    vary: "Origin",
  };
}

/** Предварительный запрос CORS от сайта. */
export function preflight(site: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...SECURITY_HEADERS,
      ...API_HEADERS,
      ...corsHeaders(site),
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers": `content-type, ${CAPTCHA_HEADER}, ${LOCALE_HEADER}`,
      "access-control-max-age": "600",
    },
  });
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      ...API_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

/** Ошибка как у Better Auth: { code, message }. */
export const failure = (
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response => json({ code, message }, status, headers);

/** Заголовки защиты (и CORS для сайта) поверх ответа Better Auth. */
export function decorate(
  res: Response,
  extra: Record<string, string>,
): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries({
    ...SECURITY_HEADERS,
    ...API_HEADERS,
    ...extra,
  })) {
    headers.set(name, value);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** Тело не длиннее max байт — байтами; длиннее — null, дочитывать не нужно (как у приёма /event edge API). */
export async function readCappedBytes(
  request: Request,
  max: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Тело не длиннее max байт — текстом; длиннее — null. */
export async function readCapped(
  request: Request,
  max: number,
): Promise<string | null> {
  const bytes = await readCappedBytes(request, max);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
