// Фото профиля в закрытом бакете R2 (шаг 3 фазы 5, PR 4а; ADR-0055): ключ — photos/{человек}/{случайное}.png|jpg,
// адрес для сайта — /api/account/photo/{случайное}.png|jpg (без номера человека), отдаёт его только хозяину.
// Фото из Google копируется сюда один раз, при первом входе через Google; ссылка на Google в базе не
// остаётся. Журнал — без адресов и почт (ADR-0028).

import type { D1Like } from "@iconavo-ui/d1";
import { ACCOUNT_PATH, GOOGLE_PHOTO, PHOTO } from "./config.js";
import type { Env, R2Like } from "./env.js";
import { type ImageInfo, imageInfo } from "./image.js";

/** Начало адреса файла фото. */
export const PHOTO_FILE_PREFIX = `${ACCOUNT_PATH}/photo/`;

/** Имя файла в адресе: 32 знака и расширение. */
export const PHOTO_NAME = /^[0-9a-f]{32}\.(png|jpg)$/;

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Новый ключ фото человека. */
export const photoKey = (userId: string, ext: ImageInfo["ext"]): string =>
  `photos/${userId}/${hex(crypto.getRandomValues(new Uint8Array(16)))}.${ext}`;

/** Адрес фото для сайта (путь у сервиса). */
export const photoUrl = (key: string): string =>
  `${PHOTO_FILE_PREFIX}${key.slice(key.lastIndexOf("/") + 1)}`;

/** Фото подходит: PNG или JPEG, квадрат, сторона в пределах. */
export function photoProblem(
  info: ImageInfo | undefined,
  minSide: number = PHOTO.minSide,
): "type" | "size" | undefined {
  if (info === undefined) return "type";
  if (
    info.width !== info.height ||
    info.width < minSide ||
    info.width > PHOTO.maxSide
  ) {
    return "size";
  }
  return undefined;
}

/** Удалить объекты бакета; бакета нет или пустой список — ничего. */
export async function deleteObjects(
  files: R2Like | undefined,
  keys: readonly (string | null | undefined)[],
): Promise<void> {
  const list = keys.filter(
    (k): k is string => typeof k === "string" && k !== "",
  );
  if (files === undefined) return;
  // R2 удаляет до 1000 ключей за вызов.
  for (let i = 0; i < list.length; i += 1000) {
    await files.delete(list.slice(i, i + 1000));
  }
}

/** Строка фото человека. */
export interface PhotoRow {
  photo: string | null;
  photoPrev: string | null;
  photoPrevUntil: number | null;
}

export async function photoRow(
  db: D1Like,
  userId: string,
): Promise<PhotoRow | null> {
  return db
    .prepare(
      `select "photo", "photoPrev", "photoPrevUntil" from "user" where "id" = ?`,
    )
    .bind(userId)
    .first<PhotoRow>();
}

/** Тело ответа не длиннее max байт; длиннее — null. */
async function readResponse(
  res: Response,
  max: number,
): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
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
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Ссылка на фото Google крупнее: «=s96-c» в конце → «=s512-c». */
export function biggerGooglePhoto(url: string): string {
  return /=s\d+(-c)?$/.test(url)
    ? url.replace(/=s\d+(-c)?$/, `=s${GOOGLE_PHOTO.side}-c`)
    : url;
}

export interface CopyDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  log: (line: string) => void;
  now: number;
}

/**
 * Копия фото Google у себя (первый вход через Google): только https с серверов Google, без переходов, до
 * 1 МБ, PNG или JPEG квадратом. Не вышло — фото нет, а ссылка на Google всё равно стирается.
 */
export async function copyGooglePhoto(
  env: Env,
  userId: string,
  url: string,
  deps: CopyDeps,
): Promise<boolean> {
  const forget = (photo: string | null) =>
    env.DB.prepare(
      `update "user" set "image" = null, "photo" = coalesce(?, "photo") where "id" = ?`,
    )
      .bind(photo, userId)
      .run();
  let target: URL;
  try {
    target = new URL(biggerGooglePhoto(url));
  } catch {
    await forget(null);
    return false;
  }
  if (
    target.protocol !== "https:" ||
    !target.hostname.endsWith(GOOGLE_PHOTO.hostSuffix) ||
    env.FILES === undefined
  ) {
    await forget(null);
    return false;
  }
  try {
    const res = await deps.fetch(target.href, {
      redirect: "error",
      signal: AbortSignal.timeout(GOOGLE_PHOTO.timeoutMs),
    });
    const bytes = res.ok ? await readResponse(res, PHOTO.maxBytes) : null;
    const info = bytes === null ? undefined : imageInfo(bytes);
    if (bytes === null || photoProblem(info, 64) !== undefined || !info) {
      if (bytes === null && !res.ok) await res.body?.cancel().catch(() => {});
      deps.log("аккаунты: фото Google не подошло");
      await forget(null);
      return false;
    }
    const key = photoKey(userId, info.ext);
    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: info.type },
    });
    await forget(key);
    return true;
  } catch (e) {
    deps.log(
      `аккаунты: фото Google не скопировалось: ${(e as Error).name.slice(0, 40)}`,
    );
    await forget(null).catch(() => {});
    return false;
  }
}
