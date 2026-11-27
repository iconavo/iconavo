// Помощники тестов сервиса аккаунтов: база — подделка D1 с её пределами (`@iconavo-ui/d1/sqlite`), почта
// копит письма, лимиты считают, Turnstile отвечает «да» на один ответ. Время — своё у счётчика неудачных
// входов и окна пароля; Better Auth живёт по настоящим часам.

import { DatabaseSync } from "node:sqlite";
import { sqliteD1 } from "@iconavo-ui/d1/sqlite";
import { type ApiDeps, handleApi } from "./api.js";
import { CAPTCHA_HEADER, LOCALE_HEADER } from "./config.js";
import type { Env, MailMessage, R2Like, RateLimiter } from "./env.js";

export const SITE = "http://127.0.0.1:4284";
export const SERVICE = "http://127.0.0.1:4287";
export const GOOD_CAPTCHA = "turnstile-ok";

/** Бакет R2 в памяти: ключ → байты и тип. */
export function memoryBucket(): R2Like & {
  objects: Map<string, { bytes: Uint8Array; type?: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  return {
    objects,
    async put(key, value, options) {
      const bytes =
        value instanceof Uint8Array ? value.slice() : new Uint8Array(value);
      objects.set(key, {
        bytes,
        ...(options?.httpMetadata?.contentType === undefined
          ? {}
          : { type: options.httpMetadata.contentType }),
      });
      return {};
    },
    async get(key) {
      const o = objects.get(key);
      if (o === undefined) return null;
      return {
        body: new Blob([o.bytes]).stream(),
        size: o.bytes.byteLength,
        ...(o.type === undefined
          ? {}
          : { httpMetadata: { contentType: o.type } }),
      };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys])
        objects.delete(key);
    },
  };
}

/** Лимит, который пропускает limit вызовов на ключ. */
export function counter(limit: number): RateLimiter & { calls: string[] } {
  const seen = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    limit: async ({ key }) => {
      calls.push(key);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { success: n <= limit };
    },
  };
}

export interface World {
  env: Env;
  files: ReturnType<typeof memoryBucket>;
  mail: MailMessage[];
  logs: string[];
  /** Ответы Turnstile, которые проверял сервис. */
  captchas: string[];
  clock: { now: number };
  send(
    path: string,
    o?: {
      method?: string;
      body?: unknown;
      raw?: string;
      origin?: string | null;
      cookie?: string;
      captcha?: string;
      locale?: string;
      type?: string;
      /** Тело байтами (фото профиля). */
      bytes?: Uint8Array;
      /** Тело — форма multipart (обратная связь): тип с границей ставит сам Request. */
      form?: FormData;
    },
  ): Promise<{
    status: number;
    json: Record<string, unknown> | null;
    res: Response;
  }>;
  /** Последний код из писем на этот адрес. */
  codeFor(email: string): string;
}

export function world(over: Partial<Env> = {}): World {
  const mail: MailMessage[] = [];
  const logs: string[] = [];
  const captchas: string[] = [];
  const clock = { now: Date.now() };
  const background: Promise<unknown>[] = [];
  const files = memoryBucket();
  const env: Env = {
    FILES: files,
    DB: sqliteD1(new DatabaseSync(":memory:")),
    BETTER_AUTH_SECRET: "test-secret-".repeat(4),
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    TURNSTILE_VERIFY_URL: "https://turnstile.test/siteverify",
    SITE_ORIGIN: SITE,
    SERVICE_ORIGIN: SERVICE,
    COOKIE_MODE: "plain",
    ACCOUNT_ACCESS: "open",
    EMAIL: {
      send: async (m) => {
        mail.push(m);
        return { messageId: String(mail.length) };
      },
    },
    ...over,
  };
  const deps: ApiDeps = {
    waitUntil: (p) => {
      background.push(p);
    },
    log: (line) => logs.push(line),
    fetch: async (_url, init) => {
      const token = String(
        (init?.body as FormData | undefined)?.get("response"),
      );
      captchas.push(token);
      return Response.json({
        success: token === GOOD_CAPTCHA,
        hostname: new URL(env.SITE_ORIGIN ?? SITE).hostname,
      });
    },
    now: () => clock.now,
  };
  return {
    env,
    files,
    mail,
    logs,
    captchas,
    clock,
    async send(path, o = {}) {
      const method =
        o.method ??
        (o.body === undefined &&
        o.raw === undefined &&
        o.bytes === undefined &&
        o.form === undefined
          ? "GET"
          : "POST");
      const headers = new Headers();
      if (o.origin !== null) headers.set("origin", o.origin ?? SITE);
      if (method === "POST" && (o.form === undefined || o.type !== undefined))
        headers.set("content-type", o.type ?? "application/json");
      if (o.cookie) headers.set("cookie", o.cookie);
      if (o.captcha) headers.set(CAPTCHA_HEADER, o.captcha);
      if (o.locale) headers.set(LOCALE_HEADER, o.locale);
      headers.set("cf-connecting-ip", "203.0.113.7");
      const res = await handleApi(
        new Request(`${SERVICE}${path}`, {
          method,
          headers,
          ...(method === "POST"
            ? {
                body:
                  o.form ??
                  (o.bytes === undefined
                    ? (o.raw ?? JSON.stringify(o.body ?? {}))
                    : new Blob([o.bytes])),
              }
            : {}),
        }),
        env,
        deps,
      );
      await Promise.all(background.splice(0));
      const text = await res.clone().text();
      let json: Record<string, unknown> | null = null;
      try {
        json =
          text === "" ? null : (JSON.parse(text) as Record<string, unknown>);
      } catch {
        json = null;
      }
      return { status: res.status, json, res };
    },
    codeFor(email) {
      const letter = [...mail].reverse().find((m) => m.to === email);
      const code = /\b\d{6}\b/.exec(letter?.subject ?? "")?.[0];
      if (code === undefined)
        throw new Error(`нет письма с кодом для ${email}`);
      return code;
    },
  };
}

/** cookie сеанса из ответа: «имя=значение». */
export const cookieOf = (res: Response): string =>
  (res.headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[\w.-]+=)/)
    .map((c) => c.trim().split(";")[0] ?? "")
    .filter((c) => c.includes("session_token="))
    .join("; ");

/** Регистрация целиком: почта → код → пароль. cookie сеанса. */
export async function register(
  w: World,
  email: string,
  password = "correct horse 1",
  locale = "en",
): Promise<string> {
  const start = await w.send("/api/account/sign-up", {
    body: { email, locale },
    captcha: GOOD_CAPTCHA,
  });
  if (start.status !== 200) throw new Error(`регистрация: ${start.status}`);
  const signIn = await w.send("/api/auth/sign-in/email-otp", {
    body: { email, otp: w.codeFor(email), locale },
  });
  if (signIn.status !== 200) throw new Error(`код: ${signIn.status}`);
  const cookie = cookieOf(signIn.res);
  const set = await w.send("/api/account/password", {
    body: { newPassword: password },
    cookie,
  });
  if (set.status !== 200) throw new Error(`пароль: ${set.status}`);
  return cookie;
}
