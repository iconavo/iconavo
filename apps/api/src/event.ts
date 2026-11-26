// Приём событий аналитики `POST /event` (шаг 2 фазы 5, ADR-0043): пачки со страниц iconavo.dev — в базу
// D1 `iconavo-analytics`. Адрес есть только у функции edge API: его обрабатывает точка входа index.ts,
// а MCP-сервер берёт маршруты createRoutes без него. Порядок: метод → лимит частоты → Origin → размер →
// JSON → список событий → запись. IP — только ключ лимита, нигде не хранится (ADR-0028); страна — код
// Cloudflare, время — до часа. «Принято» (204) — только после записи: так проверка видит всю дорогу.

import {
  EVENT_ORIGIN,
  EVENT_RATE,
  MAX_BODY_BYTES,
  parseBatch,
  TEST_HEADER,
} from "@iconavo-ui/analytics";
import {
  type D1Like,
  type D1Statement,
  dayOfHour,
  eventStatements,
  hourOf,
  rejectStatements,
  schemaStatements,
} from "@iconavo-ui/analytics/db";
import type { RateLimiter } from "./env.js";
import { ApiError, errorResponse, respond } from "./http.js";
import { limitKey } from "./search/handler.js";

/** Привязки, которые нужны приёму. */
export interface EventEnv {
  ANALYTICS?: D1Like;
  EVENT_LIMIT?: RateLimiter;
  /** Только у превью: страницы через запятую вместо https://iconavo.dev. */
  EVENT_ORIGINS?: string;
}

export interface EventOptions {
  now?: () => number;
  /** Сообщения об ошибках — без содержимого событий и адресов (ADR-0028). */
  log?: (message: string) => void;
}

const NO_STORE = { "cache-control": "no-store" };

/**
 * Базы, где таблицы уже созданы этой копией функции. Только отметка, а не общее обещание загрузки:
 * в workerd запрос не может ждать работу другого запроса (ADR-0024).
 */
const ready = new WeakSet<D1Like>();

const COUNTRY = /^[A-Z][A-Z0-9]$/;

/** Код страны от Cloudflare (`request.cf.country`); «XX» — страна неизвестна. Город и регион не берутся. */
export function countryOf(request: Request): string | null {
  const country = (request as unknown as { cf?: { country?: unknown } }).cf
    ?.country;
  return typeof country === "string" &&
    COUNTRY.test(country) &&
    country !== "XX"
    ? country
    : null;
}

/** Тело не длиннее max байт; длиннее — null, дочитывать не нужно. */
async function readCapped(
  request: Request,
  max: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (request.body === null) return "";
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
  return new TextDecoder().decode(bytes);
}

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

/** Пачка запросов к базе, на первом обращении копии — вместе с таблицами. Сбой — false и строка журнала. */
async function write(
  db: D1Like,
  statements: D1Statement[],
  log: (message: string) => void,
): Promise<boolean> {
  const first = !ready.has(db);
  if (!first && statements.length === 0) return true;
  try {
    await db.batch([...(first ? schemaStatements(db) : []), ...statements]);
    ready.add(db);
    return true;
  } catch (e) {
    ready.delete(db);
    log(
      `аналитика: запись в базу не удалась: ${(e as Error).message.slice(0, 200)}`,
    );
    return false;
  }
}

export async function handleEvent(
  request: Request,
  env: EventEnv,
  options: EventOptions = {},
): Promise<Response> {
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? (() => {});
  if (request.method !== "POST") {
    return fail(
      405,
      "method_not_allowed",
      `Method ${request.method} is not allowed: use POST`,
      { allow: "POST" },
    );
  }
  // Лимит — первым: отказы по нему в базу не пишутся, иначе поток запросов стал бы потоком записей.
  if (env.EVENT_LIMIT) {
    let allowed = true;
    try {
      allowed = (
        await env.EVENT_LIMIT.limit({
          key: limitKey(request.headers.get("cf-connecting-ip")),
        })
      ).success;
    } catch (e) {
      log(`аналитика: лимит частоты не ответил: ${(e as Error).message}`);
    }
    if (!allowed) {
      return fail(
        429,
        "rate_limited",
        `Too many event batches: at most ${EVENT_RATE.limit} per minute from one address, retry later`,
        { "retry-after": "60" },
      );
    }
  }
  const db = env.ANALYTICS;
  if (db === undefined) {
    return fail(
      503,
      "analytics_unavailable",
      "Analytics is temporarily unavailable, retry later",
    );
  }
  const hour = hourOf(now());
  const day = dayOfHour(hour);
  const test = request.headers.get(TEST_HEADER) === "1";
  // Отказ пачки целиком — счётчик причины дня; не записался — ответ тот же.
  const reject = async (
    reason: string,
    status: number,
    code: string,
    message: string,
  ) => {
    await write(db, rejectStatements(db, day, [reason], test), log);
    return fail(status, code, message);
  };

  const origins = env.EVENT_ORIGINS?.split(",") ?? [EVENT_ORIGIN];
  if (!origins.includes(request.headers.get("origin") ?? "")) {
    return reject(
      "origin",
      403,
      "forbidden_origin",
      `Events are accepted only from ${EVENT_ORIGIN} pages`,
    );
  }
  const body = await readCapped(request, MAX_BODY_BYTES);
  if (body === null) {
    return reject(
      "size",
      413,
      "too_large",
      `Event batch is larger than ${MAX_BODY_BYTES} bytes`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return reject("json", 400, "invalid_events", "Event batch is not JSON");
  }
  const batch = parseBatch(raw);
  if (!batch.ok) {
    return reject(
      "shape",
      400,
      "invalid_events",
      "Event batch does not match the event list",
    );
  }
  const statements = [
    ...eventStatements(
      db,
      { hour, lang: batch.lang, country: countryOf(request), test },
      batch.events,
    ),
    ...rejectStatements(db, day, batch.rejected, test),
  ];
  if (!(await write(db, statements, log))) {
    return fail(
      503,
      "analytics_unavailable",
      "Analytics is temporarily unavailable, retry later",
    );
  }
  if (batch.events.length === 0) {
    return fail(400, "invalid_events", "No event matches the event list");
  }
  return respond(null, 204, NO_STORE, true);
}
