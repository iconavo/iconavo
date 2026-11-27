// Better Auth сервиса аккаунтов (шаг 3 фазы 5, ADR-0055): пароли, коды на почту, вход через Google,
// сеансы. Экземпляр собирается на каждый запрос: в workerd запрос не может ждать работу другого запроса
// (ADR-0024), а общих обещаний между запросами так нет совсем.
//
// - База — привязка D1: Better Auth узнаёт её по виду (prepare, batch, exec) и идёт своим путём для D1,
//   без транзакций; драйвер не нужен. В тестах и превью — подделка `@iconavo-ui/d1/sqlite` с пределами D1.
// - Регистрация — только кодом: «пароль сразу» (/sign-up/email) выключен, человек вводит почту, код из
//   письма (вход кодом создаёт аккаунт с подтверждённой почтой), затем пароль (account.ts).
// - Cookie — только у account.iconavo.dev: без Domain, HttpOnly, Secure, SameSite=Lax, имя `__Host-…`.
// - Встроенный лимит частоты Better Auth выключен: он считает в памяти одной копии функции; лимиты —
//   привязки Workers (guard.ts). Телеметрия выключена. В журнал — без почт и ключей (redact).

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import {
  AUTH_PATH,
  CODE,
  LOCALE_HEADER,
  LOCALES,
  type Locale,
  PASSWORD,
  SERVICE_ORIGIN,
  SESSION,
  SITE_ORIGIN,
} from "./config.js";
import type { Env } from "./env.js";
import { codeMail, sendMail } from "./mail.js";

export interface AuthOptions {
  waitUntil: (promise: Promise<unknown>) => void;
  log: (line: string) => void;
}

/** Язык из заголовка страницы; другой или нет — английский. */
export const localeOf = (value: string | null | undefined): Locale =>
  (LOCALES as readonly string[]).includes(value ?? "")
    ? (value as Locale)
    : "en";

/** Почты закрытого режима. */
export const allowlistOf = (env: Env): Set<string> =>
  new Set(
    (env.ACCOUNT_ALLOWLIST ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email !== ""),
  );

/** Можно ли зарегистрировать почту: в закрытом режиме — только из списка (решение 2 владельца). */
export const mayRegister = (env: Env, email: string): boolean =>
  env.ACCOUNT_ACCESS === "open" || allowlistOf(env).has(email.toLowerCase());

const EMAIL = /[^\s@<>"]+@[^\s@<>"]+/g;
const TOKEN = /[A-Za-z0-9_-]{24,}/g;

/** Строка журнала без почт и длинных токенов (ADR-0028). */
export const redact = (text: string): string =>
  text.replace(EMAIL, "<почта>").replace(TOKEN, "<…>").slice(0, 300);

export function createAuth(env: Env, o: AuthOptions) {
  const site = env.SITE_ORIGIN ?? SITE_ORIGIN;
  const host = env.COOKIE_MODE !== "plain";
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account" as const,
          },
        }
      : {};
  return betterAuth({
    appName: "Iconavo",
    baseURL: env.SERVICE_ORIGIN ?? SERVICE_ORIGIN,
    basePath: AUTH_PATH,
    secret: env.BETTER_AUTH_SECRET,
    // Привязка D1 (или подделка с теми же пределами): тип Better Auth — D1Database из workers-types.
    database: env.DB as unknown as Parameters<typeof betterAuth>[0]["database"],
    trustedOrigins: [site],
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    logger: {
      level: "error",
      log: (level, message) => o.log(`аккаунты: ${level}: ${redact(message)}`),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD.min,
      maxPasswordLength: PASSWORD.max,
      revokeSessionsOnPasswordReset: true,
    },
    socialProviders: google,
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        allowUnlinkingAll: false,
      },
    },
    session: {
      expiresIn: SESSION.expiresInSeconds,
      updateAge: SESSION.updateAgeSeconds,
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        locale: {
          type: "string",
          required: false,
          defaultValue: "en",
          input: true,
        },
      },
    },
    advanced: {
      // Имя с приставкой — своё: `__Secure-` Better Auth поставил бы перед `__Host-`.
      useSecureCookies: false,
      cookiePrefix: host ? "__Host-iconavo" : "iconavo",
      defaultCookieAttributes: {
        secure: host,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      backgroundTasks: { handler: o.waitUntil },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!mayRegister(env, user.email)) {
              throw new APIError("FORBIDDEN", {
                code: "SIGN_UP_CLOSED",
                message: "Sign-up is not open yet",
              });
            }
            return {
              data: { ...user, locale: localeOf(String(user.locale ?? "")) },
            };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: CODE.length,
        expiresIn: CODE.ttlSeconds,
        allowedAttempts: CODE.attempts,
        storeOTP: "hashed",
        disableSignUp: false,
        sendVerificationOTP: async ({ email, otp, type }, ctx) => {
          // Вход кодом снаружи закрыт (guard.ts): код «sign-in» — это регистрация, «forget-password» —
          // новый пароль. Язык — сохранённый у человека, иначе — страницы.
          const kind = type === "forget-password" ? "reset" : "sign-up";
          const found =
            await ctx?.context.internalAdapter.findUserByEmail(email);
          const stored = (found?.user as { locale?: unknown } | undefined)
            ?.locale;
          const locale = localeOf(
            typeof stored === "string"
              ? stored
              : (ctx?.headers?.get(LOCALE_HEADER) ?? null),
          );
          await sendMail(env.EMAIL, codeMail(email, otp, kind, locale), o.log);
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
