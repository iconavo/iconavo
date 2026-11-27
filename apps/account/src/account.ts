// Свои адреса сервиса (шаг 3 фазы 5, ADR-0055) — то, чего у Better Auth нет в виде макета «почта → код →
// пароль»:
// - `POST /api/account/sign-up { email, locale }` — начало регистрации: почта свободна и может
//   регистрироваться (закрытый режим) — письмо с кодом. Почта занята — 409, как в макете. Код — код входа
//   Better Auth: вход им создаёт аккаунт с подтверждённой почтой.
// - `POST /api/account/password { newPassword }` — пароль сразу после регистрации: только своему аккаунту,
//   без пароля и не позже 30 минут после создания. Потом пароль задаётся восстановлением по коду на почту
//   (решение владельца 27 ноября 2026: опасное — только с паролем или кодом).

import { APIError } from "better-auth/api";
import type { Auth } from "./auth.js";
import { localeOf, mayRegister } from "./auth.js";
import {
  ACCOUNT_PATH,
  LOCALE_HEADER,
  PASSWORD,
  SET_PASSWORD_WINDOW_MS,
} from "./config.js";
import type { Env } from "./env.js";
import { failure, json } from "./http.js";

export const SIGN_UP_PATH = `${ACCOUNT_PATH}/sign-up`;
export const PASSWORD_PATH = `${ACCOUNT_PATH}/password`;

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>".]{2,}$/;

/** Почта из тела: строчными, без пробелов по краям; не похожа на почту — пустая строка. */
export function emailOf(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && EMAIL.test(email) ? email : "";
}

/** Ошибка Better Auth — тем же ответом { code, message }. */
export function fromApiError(e: unknown): Response | undefined {
  if (!(e instanceof APIError)) return undefined;
  const body = (e.body ?? {}) as { code?: unknown; message?: unknown };
  return failure(
    e.statusCode,
    typeof body.code === "string" ? body.code : String(e.status),
    typeof body.message === "string" ? body.message : e.message,
  );
}

async function signUp(
  body: Record<string, unknown>,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const email = emailOf(body.email);
  if (email === "") {
    return failure(400, "INVALID_EMAIL", "Enter a valid email address");
  }
  if (!mayRegister(env, email)) {
    return failure(403, "SIGN_UP_CLOSED", "Sign-up is not open yet");
  }
  const ctx = await auth.$context;
  if ((await ctx.internalAdapter.findUserByEmail(email)) !== null) {
    return failure(409, "EMAIL_TAKEN", "This email already has an account");
  }
  await auth.api.sendVerificationOTP({
    body: { email, type: "sign-in" },
    headers: new Headers({ [LOCALE_HEADER]: localeOf(String(body.locale)) }),
  });
  return json({ success: true });
}

async function setPassword(
  request: Request,
  body: Record<string, unknown>,
  auth: Auth,
  now: number,
): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (session === null) {
    return failure(401, "UNAUTHORIZED", "Sign in first");
  }
  const created = new Date(session.user.createdAt).getTime();
  if (!(now - created <= SET_PASSWORD_WINDOW_MS)) {
    return failure(
      403,
      "PASSWORD_WINDOW_CLOSED",
      "Set a password with a code sent to your email",
    );
  }
  const ctx = await auth.$context;
  const accounts = await ctx.internalAdapter.findAccounts(session.user.id);
  if (accounts.some((a) => a.providerId === "credential")) {
    return failure(409, "PASSWORD_ALREADY_SET", "The password is already set");
  }
  const password = body.newPassword;
  if (
    typeof password !== "string" ||
    password.length < PASSWORD.min ||
    password.length > PASSWORD.max
  ) {
    return failure(
      400,
      "INVALID_PASSWORD_LENGTH",
      `Use ${PASSWORD.min} to ${PASSWORD.max} characters`,
    );
  }
  await auth.api.setPassword({
    body: { newPassword: password },
    headers: request.headers,
  });
  return json({ success: true });
}

export async function handleAccount(
  path: string,
  request: Request,
  body: Record<string, unknown>,
  env: Env,
  auth: Auth,
  now: number,
): Promise<Response> {
  try {
    if (path === SIGN_UP_PATH) return await signUp(body, env, auth);
    return await setPassword(request, body, auth, now);
  } catch (e) {
    const res = fromApiError(e);
    if (res !== undefined) return res;
    throw e;
  }
}
