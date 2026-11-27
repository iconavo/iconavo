// Адреса /api сервиса аккаунтов (шаг 3 фазы 5, ADR-0055) и охрана перед Better Auth. Снаружи открыты только
// адреса из ROUTES — то, что нужно окнам сайта; остальное у Better Auth (регистрация паролем без кода,
// письма с кодом в обход Turnstile, удаление по ссылке) отвечает 404, пока для него нет экрана.
//
// Порядок: CORS → адрес и метод → у POST: страница сайта (Origin), JSON до 8 КБ, только поля адреса →
// лимиты частоты → таблицы → Turnstile → Better Auth или свои адреса (account.ts) → счёт неудачных входов.
// Адрес человека — только ключ лимита (ADR-0028), почта — только отпечатком: в ключе лимита и в счётчике.

import {
  emailOf,
  handleAccount,
  PASSWORD_PATH,
  SIGN_UP_PATH,
} from "./account.js";
import { createAuth } from "./auth.js";
import {
  AUTH_PATH,
  CAPTCHA_HEADER,
  LOGIN_FAILURES,
  MAX_BODY_BYTES,
  SITE_ORIGIN,
  TURNSTILE_VERIFY_URL,
} from "./config.js";
import type { Env, RateLimiter } from "./env.js";
import {
  CAPTCHA_STATE_HEADER,
  corsHeaders,
  decorate,
  failure,
  preflight,
  readCapped,
} from "./http.js";
import { ensureSchema } from "./migrations.js";
import { verifyTurnstile } from "./turnstile.js";

export interface Route {
  methods: readonly ("GET" | "POST")[];
  /** Поля тела, которые уходят дальше; остальные отбрасываются. */
  fields?: readonly string[];
  /** Turnstile: всегда или после трёх неудачных входов. */
  captcha?: "always" | "after-failures";
  /** Адрес отправляет письмо с кодом: лимит на почту и на адрес человека. */
  code?: boolean;
}

export const ROUTES: Readonly<Record<string, Route>> = {
  [`${AUTH_PATH}/get-session`]: { methods: ["GET"] },
  [`${AUTH_PATH}/sign-in/email`]: {
    methods: ["POST"],
    fields: ["email", "password", "rememberMe"],
    captcha: "after-failures",
  },
  [`${AUTH_PATH}/sign-in/email-otp`]: {
    methods: ["POST"],
    fields: ["email", "otp", "locale"],
  },
  [`${AUTH_PATH}/sign-in/social`]: {
    methods: ["POST"],
    fields: [
      "provider",
      "callbackURL",
      "errorCallbackURL",
      "newUserCallbackURL",
    ],
  },
  [`${AUTH_PATH}/callback/google`]: { methods: ["GET"] },
  [`${AUTH_PATH}/sign-out`]: { methods: ["POST"], fields: [] },
  [`${AUTH_PATH}/email-otp/request-password-reset`]: {
    methods: ["POST"],
    fields: ["email"],
    captcha: "always",
    code: true,
  },
  [`${AUTH_PATH}/email-otp/check-verification-otp`]: {
    methods: ["POST"],
    fields: ["email", "type", "otp"],
  },
  [`${AUTH_PATH}/email-otp/reset-password`]: {
    methods: ["POST"],
    fields: ["email", "otp", "password"],
  },
  [SIGN_UP_PATH]: {
    methods: ["POST"],
    fields: ["email", "locale"],
    captcha: "always",
    code: true,
  },
  [PASSWORD_PATH]: { methods: ["POST"], fields: ["newPassword"] },
};

/** Проверить код можно только у регистрации и нового пароля. */
const CHECKABLE = new Set(["sign-in", "forget-password"]);

export interface ApiDeps {
  waitUntil(promise: Promise<unknown>): void;
  log(line: string): void;
  /** Запрос к Turnstile. */
  fetch(input: string, init?: RequestInit): Promise<Response>;
  now(): number;
}

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Отпечаток для ключа: SHA-256, 32 знака. Почта и адрес в ключи лимитов и в базу так не попадают. */
export const fingerprint = async (text: string): Promise<string> =>
  hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  ).slice(0, 32);

/** Адрес человека для лимита: IPv6 — по сети /64, как у edge API. */
export function ipKey(ip: string | null): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const [head = "", tail] = ip.toLowerCase().split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros = Math.max(0, 8 - left.length - right.length);
  const groups = [...left, ...Array<string>(zeros).fill("0"), ...right];
  return groups.slice(0, 4).join(":");
}

/** Лимит частоты; привязка не ответила — пропустить и записать в журнал (как у edge API). */
async function allowed(
  limiter: RateLimiter | undefined,
  key: string,
  log: (line: string) => void,
): Promise<boolean> {
  if (limiter === undefined) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (e) {
    log(
      `аккаунты: лимит частоты не ответил: ${(e as Error).message.slice(0, 100)}`,
    );
    return true;
  }
}

/** Неудачных входов по отпечатку почты за окно; нет — 0. */
async function failures(env: Env, key: string, now: number): Promise<number> {
  const row = await env.DB.prepare(
    `select "count", "expires" from "login_failures" where "key" = ?`,
  )
    .bind(key)
    .first<{ count: number; expires: number }>();
  return row !== null && row.expires > now ? row.count : 0;
}

/** Ещё один неудачный вход; окно — 15 минут от последнего. Счёт после записи. */
async function recordFailure(
  env: Env,
  key: string,
  now: number,
): Promise<number> {
  const row = await env.DB.prepare(
    `insert into "login_failures" ("key", "count", "expires") values (?, 1, ?)
on conflict ("key") do update set "count" = case when "expires" > ? then "count" + 1 else 1 end, "expires" = excluded."expires"
returning "count"`,
  )
    .bind(key, now + LOGIN_FAILURES.windowMs, now)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

const pick = (
  body: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(fields.filter((f) => f in body).map((f) => [f, body[f]]));

export async function handleApi(
  request: Request,
  env: Env,
  deps: ApiDeps,
): Promise<Response> {
  const site = env.SITE_ORIGIN ?? SITE_ORIGIN;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const cors = origin === site ? corsHeaders(site) : {};
  if (request.method === "OPTIONS") {
    return origin === site
      ? preflight(site)
      : failure(
          403,
          "FORBIDDEN_ORIGIN",
          `Only ${site} pages may call this service`,
        );
  }
  const route = ROUTES[url.pathname];
  if (route === undefined) return failure(404, "NOT_FOUND", "Not found", cors);
  const method = request.method as "GET" | "POST";
  if (!route.methods.includes(method)) {
    return failure(
      405,
      "METHOD_NOT_ALLOWED",
      `Use ${route.methods.join(", ")}`,
      {
        allow: route.methods.join(", "),
        ...cors,
      },
    );
  }
  const ip = request.headers.get("cf-connecting-ip");
  let body: Record<string, unknown> = {};
  if (method === "POST") {
    // Изменения — только со страниц сайта: Better Auth проверяет Origin не у всех адресов.
    if (origin !== site) {
      return failure(
        403,
        "FORBIDDEN_ORIGIN",
        `Only ${site} pages may call this service`,
      );
    }
    const type = (request.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("application/json")) {
      return failure(415, "UNSUPPORTED_MEDIA_TYPE", "Send JSON", cors);
    }
    const text = await readCapped(request, MAX_BODY_BYTES);
    if (text === null) {
      return failure(
        413,
        "TOO_LARGE",
        `Body is larger than ${MAX_BODY_BYTES} bytes`,
        cors,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text === "" ? "{}" : text);
    } catch {
      parsed = undefined;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return failure(400, "INVALID_JSON", "Body must be a JSON object", cors);
    }
    body = pick(parsed as Record<string, unknown>, route.fields ?? []);
    if (!(await allowed(env.AUTH_LIMIT, `ip:${ipKey(ip)}`, deps.log))) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many requests, retry in a minute",
        {
          "retry-after": "60",
          ...cors,
        },
      );
    }
    if (route.code) {
      const email = emailOf(body.email);
      const ipOk = await allowed(
        env.CODE_IP_LIMIT,
        `code-ip:${ipKey(ip)}`,
        deps.log,
      );
      const emailOk =
        email === "" ||
        (await allowed(
          env.CODE_LIMIT,
          `code:${await fingerprint(email)}`,
          deps.log,
        ));
      if (!ipOk || !emailOk) {
        return failure(
          429,
          "RATE_LIMITED",
          "Wait a minute before asking for a new code",
          {
            "retry-after": "60",
            ...cors,
          },
        );
      }
    }
  }
  if (url.pathname === `${AUTH_PATH}/sign-in/social`) {
    if (body.provider !== "google") {
      return failure(
        400,
        "PROVIDER_NOT_FOUND",
        "Only Google is available",
        cors,
      );
    }
    // Возврат после Google — только на страницы сайта: Better Auth пускал и чужой адрес.
    const back = ["callbackURL", "errorCallbackURL", "newUserCallbackURL"];
    if (
      back.some((f) => f in body && !String(body[f]).startsWith(`${site}/`))
    ) {
      return failure(
        400,
        "INVALID_CALLBACK_URL",
        `Return only to ${site} pages`,
        cors,
      );
    }
  }
  if (
    url.pathname === `${AUTH_PATH}/email-otp/check-verification-otp` &&
    !CHECKABLE.has(String(body.type))
  ) {
    return failure(
      400,
      "INVALID_OTP_TYPE",
      "This code cannot be checked here",
      cors,
    );
  }
  await ensureSchema(env.DB);
  const now = deps.now();
  const failureKey =
    route.captcha === "after-failures" && emailOf(body.email) !== ""
      ? await fingerprint(emailOf(body.email))
      : undefined;
  const needCaptcha =
    route.captcha === "always" ||
    (failureKey !== undefined &&
      (await failures(env, failureKey, now)) >= LOGIN_FAILURES.free);
  if (needCaptcha) {
    const passed = await verifyTurnstile({
      token: request.headers.get(CAPTCHA_HEADER) ?? "",
      ip,
      secret: env.TURNSTILE_SECRET_KEY,
      url: env.TURNSTILE_VERIFY_URL ?? TURNSTILE_VERIFY_URL,
      hostname: new URL(site).hostname,
      fetch: deps.fetch,
    });
    if (!passed) {
      return failure(403, "CAPTCHA_REQUIRED", "Confirm you are not a robot", {
        [CAPTCHA_STATE_HEADER]: "required",
        ...cors,
      });
    }
  }
  const auth = createAuth(env, { waitUntil: deps.waitUntil, log: deps.log });
  const forwarded = new Request(url, {
    method,
    headers: request.headers,
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const res = url.pathname.startsWith(`${AUTH_PATH}/`)
    ? await auth.handler(forwarded)
    : await handleAccount(url.pathname, forwarded, body, env, auth, now);
  const extra: Record<string, string> = { ...cors };
  if (failureKey !== undefined) {
    if (res.status === 401) {
      const count = await recordFailure(env, failureKey, now);
      if (count >= LOGIN_FAILURES.free)
        extra[CAPTCHA_STATE_HEADER] = "required";
    } else if (res.ok) {
      await env.DB.prepare(`delete from "login_failures" where "key" = ?`)
        .bind(failureKey)
        .run();
    }
  }
  return decorate(res, extra);
}
