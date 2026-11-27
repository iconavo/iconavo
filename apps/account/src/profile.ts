// My account (шаг 3 фазы 5, PR 4а; ADR-0055) — адреса кабинета по кадрам A2 и B–F макета «Личный кабинет»:
// - GET  /api/account/me — что показывает страница: почта, имя, фото, письма, есть ли пароль и Google;
// - POST /api/account/profile { name?, digest?, news? } — имя и письма;
// - POST /api/account/photo — фото (PNG или JPEG квадратом, байтами), /photo/remove, /photo/undo — «Undo»
//   10 минут; GET /api/account/photo/{имя} — файл фото, только хозяину;
// - POST /api/account/email/request { newEmail, password } — код на новую почту; /email/confirm { newEmail,
//   otp } — смена и письмо на прежний адрес;
// - POST /api/account/password/change { currentPassword, newPassword } — новый пароль, другие сеансы
//   закрываются, письмо на почту аккаунта;
// - POST /api/account/google/disconnect — отключить Google (без пароля нельзя);
// - POST /api/account/delete { email, password } — удалить всё сразу.
//
// Опасное — с текущим паролем (решение 1 владельца 27 ноября 2026): смена почты и удаление. У кого пароля нет
// (вход только через Google), тот сначала задаёт его кодом на свою почту — восстановлением пароля; сервис
// отвечает 403 PASSWORD_REQUIRED, и сайт показывает окно «Set a password first». Неверный текущий пароль —
// счётчик на человека: после пяти за 15 минут — пауза.

import { APIError } from "better-auth/api";
import { emailOf, fromApiError } from "./account.js";
import type { Auth } from "./auth.js";
import { localeOf } from "./auth.js";
import {
  ACCOUNT_PASSWORD_FAILURES,
  ACCOUNT_PATH,
  AUTH_PATH,
  LOCALE_HEADER,
  NAME_MAX,
  PASSWORD,
  PHOTO,
} from "./config.js";
import type { Env } from "./env.js";
import { clearFailures, failures, recordFailure } from "./failures.js";
import { feedbackShots } from "./feedback.js";
import { failure, json, SECURITY_HEADERS } from "./http.js";
import { imageInfo } from "./image.js";
import { noticeMail, sendMail } from "./mail.js";
import {
  deleteObjects,
  PHOTO_FILE_PREFIX,
  PHOTO_NAME,
  photoKey,
  photoProblem,
  photoRow,
  photoUrl,
} from "./photos.js";
import { type SessionUser, sessionUser, unauthorized } from "./session.js";

export { PHOTO_FILE_PREFIX } from "./photos.js";

export const ME_PATH = `${ACCOUNT_PATH}/me`;
export const PROFILE_PATH = `${ACCOUNT_PATH}/profile`;
export const PHOTO_PATH = `${ACCOUNT_PATH}/photo`;
export const PHOTO_REMOVE_PATH = `${ACCOUNT_PATH}/photo/remove`;
export const PHOTO_UNDO_PATH = `${ACCOUNT_PATH}/photo/undo`;
export const EMAIL_REQUEST_PATH = `${ACCOUNT_PATH}/email/request`;
export const EMAIL_CONFIRM_PATH = `${ACCOUNT_PATH}/email/confirm`;
export const PASSWORD_CHANGE_PATH = `${ACCOUNT_PATH}/password/change`;
export const GOOGLE_DISCONNECT_PATH = `${ACCOUNT_PATH}/google/disconnect`;
export const DELETE_PATH = `${ACCOUNT_PATH}/delete`;

export interface ProfileDeps {
  now: number;
  waitUntil(promise: Promise<unknown>): void;
  log(line: string): void;
}

/** Способы входа человека: пароль (когда задан) и Google. */
async function accountsOf(
  env: Env,
  userId: string,
): Promise<{ password?: string; google: boolean }> {
  const { results } = await env.DB.prepare(
    `select "providerId", "updatedAt", "password" from "account" where "userId" = ?`,
  )
    .bind(userId)
    .all<{ providerId: string; updatedAt: string; password: string | null }>();
  const credential = results.find(
    (a) => a.providerId === "credential" && a.password,
  );
  return {
    ...(credential === undefined ? {} : { password: credential.updatedAt }),
    google: results.some((a) => a.providerId === "google"),
  };
}

/** Запрос к Better Auth изнутри сервиса — с cookie, Origin и языком исходного запроса. */
function inner(request: Request, path: string, body: unknown): Request {
  const headers = new Headers();
  for (const name of [
    "cookie",
    "origin",
    "user-agent",
    "cf-connecting-ip",
    LOCALE_HEADER,
  ]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("content-type", "application/json");
  return new Request(new URL(`${AUTH_PATH}${path}`, request.url), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Текущий пароль для опасного: нет пароля — 403 PASSWORD_REQUIRED; неверный — 401 INVALID_PASSWORD и
 * счётчик; пять неверных за 15 минут — 429. Верно — undefined.
 */
async function checkPassword(
  request: Request,
  env: Env,
  auth: Auth,
  user: SessionUser,
  password: unknown,
  now: number,
): Promise<Response | undefined> {
  if ((await accountsOf(env, user.id)).password === undefined) {
    return failure(
      403,
      "PASSWORD_REQUIRED",
      "Set a password first: you signed up with Google",
    );
  }
  const key = `pw:${user.id}`;
  if ((await failures(env.DB, key, now)) >= ACCOUNT_PASSWORD_FAILURES) {
    return failure(429, "TOO_MANY_ATTEMPTS", "Too many wrong passwords", {
      "retry-after": "900",
    });
  }
  const wrong = async () => {
    await recordFailure(env.DB, key, now);
    return failure(401, "INVALID_PASSWORD", "Wrong password");
  };
  if (
    typeof password !== "string" ||
    password === "" ||
    password.length > PASSWORD.max
  ) {
    return wrong();
  }
  try {
    await auth.api.verifyPassword({
      body: { password },
      headers: request.headers,
    });
  } catch (e) {
    if (e instanceof APIError) return wrong();
    throw e;
  }
  await clearFailures(env.DB, key);
  return undefined;
}

/** Имя: без пробелов по краям и служебных знаков, пустое — "", слишком длинное — undefined. */
export function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Служебные знаки (коды до 32 и 127) — прочь: в имени их не бывает.
  const name = [...value]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return [...name].length > NAME_MAX ? undefined : name;
}

async function me(request: Request, env: Env, auth: Auth): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const row = await env.DB.prepare(
    `select "photo", "digest", "news" from "user" where "id" = ?`,
  )
    .bind(user.id)
    .first<{ photo: string | null; digest: number; news: number }>();
  const ways = await accountsOf(env, user.id);
  return json({
    email: user.email,
    name: user.name ?? "",
    emailVerified: Boolean(user.emailVerified),
    photo: row?.photo ? photoUrl(row.photo) : null,
    digest: row?.digest !== 0,
    news: row?.news === 1,
    password: {
      set: ways.password !== undefined,
      changedAt: ways.password ?? null,
    },
    google: ways.google,
  });
}

async function updateProfile(
  request: Request,
  body: Record<string, unknown>,
  env: Env,
  auth: Auth,
  now: number,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if ("name" in body) {
    const name = cleanName(body.name);
    if (name === undefined) {
      return failure(400, "NAME_TOO_LONG", `Use up to ${NAME_MAX} characters`);
    }
    if (name === "") return failure(400, "NAME_EMPTY", "Enter your name");
    sets.push(`"name" = ?`);
    values.push(name);
  }
  for (const field of ["digest", "news"] as const) {
    if (!(field in body)) continue;
    if (typeof body[field] !== "boolean") {
      return failure(400, "INVALID_FIELD", `${field} must be true or false`);
    }
    sets.push(`"${field}" = ?`);
    values.push(body[field] ? 1 : 0);
  }
  if (sets.length === 0)
    return failure(400, "NOTHING_TO_SAVE", "Nothing to save");
  sets.push(`"updatedAt" = ?`);
  values.push(new Date(now).toISOString());
  await env.DB.prepare(`update "user" set ${sets.join(", ")} where "id" = ?`)
    .bind(...values, user.id)
    .run();
  return me(request, env, auth);
}

/** Новое фото: прежнее живёт ещё 10 минут для «Undo», то, что было до него, удаляется. */
async function uploadPhoto(
  request: Request,
  bytes: Uint8Array | undefined,
  env: Env,
  auth: Auth,
  now: number,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  if (env.FILES === undefined) {
    return failure(503, "STORAGE_UNAVAILABLE", "Photos are not available");
  }
  const info = imageInfo(bytes ?? new Uint8Array(0));
  const problem = photoProblem(info);
  if (problem === "type" || info === undefined || bytes === undefined) {
    return failure(415, "UNSUPPORTED_IMAGE", "Send a PNG or JPEG image");
  }
  if (problem === "size") {
    return failure(
      400,
      "INVALID_IMAGE_SIZE",
      `Send a square from ${PHOTO.minSide} to ${PHOTO.maxSide} px`,
    );
  }
  const key = photoKey(user.id, info.ext);
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: info.type } });
  const row = await photoRow(env.DB, user.id);
  await deleteObjects(env.FILES, [row?.photoPrev]);
  await env.DB.prepare(
    `update "user" set "photo" = ?, "photoPrev" = ?, "photoPrevUntil" = ?, "updatedAt" = ? where "id" = ?`,
  )
    .bind(
      key,
      row?.photo ?? null,
      now + PHOTO.undoMs,
      new Date(now).toISOString(),
      user.id,
    )
    .run();
  return json({ photo: photoUrl(key) });
}

async function removePhoto(
  request: Request,
  env: Env,
  auth: Auth,
  now: number,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const row = await photoRow(env.DB, user.id);
  if (!row?.photo) return failure(409, "NO_PHOTO", "There is no photo");
  await deleteObjects(env.FILES, [row.photoPrev]);
  await env.DB.prepare(
    `update "user" set "photo" = null, "photoPrev" = ?, "photoPrevUntil" = ?, "updatedAt" = ? where "id" = ?`,
  )
    .bind(row.photo, now + PHOTO.undoMs, new Date(now).toISOString(), user.id)
    .run();
  return json({ photo: null });
}

/** «Undo» фото — в течение 10 минут: вернуть прежнее (или «без фото»), новое удалить. */
async function undoPhoto(
  request: Request,
  env: Env,
  auth: Auth,
  now: number,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const row = await photoRow(env.DB, user.id);
  if (row?.photoPrevUntil == null || row.photoPrevUntil < now) {
    return failure(409, "NOTHING_TO_UNDO", "Nothing to undo");
  }
  await deleteObjects(env.FILES, [row.photo]);
  await env.DB.prepare(
    `update "user" set "photo" = ?, "photoPrev" = null, "photoPrevUntil" = null, "updatedAt" = ? where "id" = ?`,
  )
    .bind(row.photoPrev, new Date(now).toISOString(), user.id)
    .run();
  return json({ photo: row.photoPrev ? photoUrl(row.photoPrev) : null });
}

/**
 * Файл фото — только хозяину: нынешнее и прежнее в пределах «Undo». Кэш — личный и навсегда: у каждого
 * нового фото — новое имя.
 */
export async function servePhoto(
  path: string,
  request: Request,
  env: Env,
  auth: Auth,
  now: number,
): Promise<Response> {
  const name = path.slice(PHOTO_FILE_PREFIX.length);
  if (!PHOTO_NAME.test(name)) return failure(404, "NOT_FOUND", "Not found");
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const row = await photoRow(env.DB, user.id);
  const keys = [
    row?.photo,
    row?.photoPrevUntil != null && row.photoPrevUntil >= now
      ? row.photoPrev
      : null,
  ];
  const key = keys.find(
    (k): k is string => typeof k === "string" && k.endsWith(`/${name}`),
  );
  const file = key === undefined ? null : await env.FILES?.get(key);
  if (file == null) return failure(404, "NOT_FOUND", "Not found");
  return new Response(request.method === "HEAD" ? null : file.body, {
    headers: {
      ...SECURITY_HEADERS,
      "content-type":
        file.httpMetadata?.contentType ??
        (name.endsWith(".png") ? "image/png" : "image/jpeg"),
      "content-length": String(file.size),
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

async function requestEmail(
  request: Request,
  body: Record<string, unknown>,
  env: Env,
  auth: Auth,
  deps: ProfileDeps,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const newEmail = emailOf(body.newEmail);
  if (newEmail === "") {
    return failure(400, "INVALID_EMAIL", "Enter a valid email address");
  }
  if (newEmail === user.email.toLowerCase()) {
    return failure(400, "SAME_EMAIL", "This is your email already");
  }
  const refused = await checkPassword(
    request,
    env,
    auth,
    user,
    body.password,
    deps.now,
  );
  if (refused !== undefined) return refused;
  const ctx = await auth.$context;
  if ((await ctx.internalAdapter.findUserByEmail(newEmail)) !== null) {
    return failure(409, "EMAIL_TAKEN", "This email already has an account");
  }
  return auth.handler(
    inner(request, "/email-otp/request-email-change", { newEmail }),
  );
}

async function confirmEmail(
  request: Request,
  body: Record<string, unknown>,
  env: Env,
  auth: Auth,
  deps: ProfileDeps,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const res = await auth.handler(
    inner(request, "/email-otp/change-email", {
      newEmail: body.newEmail,
      otp: body.otp,
    }),
  );
  if (res.ok) {
    // Прежний адрес узнаёт о смене (решение 3): если это были не вы — ответьте на письмо.
    deps.waitUntil(
      sendMail(
        env.EMAIL,
        noticeMail(
          user.email,
          "email-changed",
          localeOf(String(user.locale ?? "")),
          emailOf(body.newEmail),
        ),
        deps.log,
      ),
    );
  }
  return res;
}

async function changePassword(
  request: Request,
  body: Record<string, unknown>,
  env: Env,
  auth: Auth,
  deps: ProfileDeps,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const refused = await checkPassword(
    request,
    env,
    auth,
    user,
    body.currentPassword,
    deps.now,
  );
  if (refused !== undefined) return refused;
  const res = await auth.handler(
    inner(request, "/change-password", {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      revokeOtherSessions: true,
    }),
  );
  if (res.ok) {
    deps.waitUntil(
      sendMail(
        env.EMAIL,
        noticeMail(
          user.email,
          "password-changed",
          localeOf(String(user.locale ?? "")),
        ),
        deps.log,
      ),
    );
  }
  return res;
}

/**
 * Отключить Google (кадры E2–E3): без пароля нельзя — сначала задать его (E2e). Своим кодом, а не адресом
 * Better Auth unlink-account: тот требует сеанс младше суток, а вход помнится 30 дней.
 */
async function disconnectGoogle(
  request: Request,
  auth: Auth,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const ctx = await auth.$context;
  const accounts = await ctx.internalAdapter.findAccounts(user.id);
  const google = accounts.find((a) => a.providerId === "google");
  if (google === undefined) {
    return failure(409, "NOT_CONNECTED", "Google is not connected");
  }
  if (!accounts.some((a) => a.providerId === "credential" && a.password)) {
    return failure(
      409,
      "PASSWORD_REQUIRED",
      "Set a password first: Google is your only way to log in",
    );
  }
  await ctx.internalAdapter.deleteAccount(google.id);
  return json({ success: true });
}

async function deleteAccount(
  request: Request,
  body: Record<string, unknown>,
  env: Env,
  auth: Auth,
  deps: ProfileDeps,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  if (emailOf(body.email) !== user.email.toLowerCase()) {
    return failure(400, "EMAIL_MISMATCH", "Doesn’t match your email");
  }
  const refused = await checkPassword(
    request,
    env,
    auth,
    user,
    body.password,
    deps.now,
  );
  if (refused !== undefined) return refused;
  const row = await photoRow(env.DB, user.id);
  // Скриншоты обратной связи — до удаления: строки уходят каскадом вместе с человеком (PR 6а).
  const shots = await feedbackShots(env.DB, user.id);
  const res = await auth.handler(
    inner(request, "/delete-user", { password: body.password }),
  );
  if (res.ok) {
    // Сразу всё (решение владельца 27 ноября 2026): фото и отзывы со скриншотами — вместе с аккаунтом.
    await deleteObjects(env.FILES, [row?.photo, row?.photoPrev, ...shots]);
    await env.DB.prepare(`delete from "feedback" where "userId" = ?`)
      .bind(user.id)
      .run();
    await clearFailures(env.DB, `pw:${user.id}`);
  }
  return res;
}

export async function handleProfile(
  path: string,
  request: Request,
  body: Record<string, unknown>,
  bytes: Uint8Array | undefined,
  env: Env,
  auth: Auth,
  deps: ProfileDeps,
): Promise<Response> {
  try {
    switch (path) {
      case ME_PATH:
        return await me(request, env, auth);
      case PROFILE_PATH:
        return await updateProfile(request, body, env, auth, deps.now);
      case PHOTO_PATH:
        return await uploadPhoto(request, bytes, env, auth, deps.now);
      case PHOTO_REMOVE_PATH:
        return await removePhoto(request, env, auth, deps.now);
      case PHOTO_UNDO_PATH:
        return await undoPhoto(request, env, auth, deps.now);
      case EMAIL_REQUEST_PATH:
        return await requestEmail(request, body, env, auth, deps);
      case EMAIL_CONFIRM_PATH:
        return await confirmEmail(request, body, env, auth, deps);
      case PASSWORD_CHANGE_PATH:
        return await changePassword(request, body, env, auth, deps);
      case GOOGLE_DISCONNECT_PATH:
        return await disconnectGoogle(request, auth);
      default:
        return await deleteAccount(request, body, env, auth, deps);
    }
  } catch (e) {
    const res = fromApiError(e);
    if (res !== undefined) return res;
    throw e;
  }
}
