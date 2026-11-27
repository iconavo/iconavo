// Уборка по расписанию (шаг 3 фазы 5, сроки хранения — решение владельца 27 ноября 2026): просроченные
// коды и сеансы, аккаунты без подтверждённой почты старше суток (с их сеансами и способами входа) и
// старые счётчики неудачных входов. Одна пачка D1 — одна транзакция: не прошёл один запрос — не
// изменилось ничего, и следующий запуск уберёт всё сам. Даты Better Auth — строки ISO одного вида,
// поэтому сравниваются как строки.

import type { D1Like } from "@iconavo-ui/d1";
import { UNVERIFIED_TTL_MS } from "./config.js";
import type { R2Like } from "./env.js";
import { deleteObjects } from "./photos.js";

export interface CleanupResult {
  codes: number;
  sessions: number;
  users: number;
  failures: number;
  /** Прежние фото, у которых кончилось время «Undo» (PR 4а). */
  photos: number;
}

const changes = (r: unknown): number => {
  const n = (r as { meta?: { changes?: unknown } } | undefined)?.meta?.changes;
  return typeof n === "number" ? n : 0;
};

const UNVERIFIED = `select "id" from "user" where "emailVerified" = 0 and "createdAt" < ?`;

export async function cleanup(
  db: D1Like,
  now: number,
  files?: R2Like,
): Promise<CleanupResult> {
  const iso = new Date(now).toISOString();
  const stale = new Date(now - UNVERIFIED_TTL_MS).toISOString();
  const [codes, sessions, , , users, failures] = await db.batch([
    db.prepare(`delete from "verification" where "expiresAt" < ?`).bind(iso),
    db.prepare(`delete from "session" where "expiresAt" < ?`).bind(iso),
    db
      .prepare(`delete from "session" where "userId" in (${UNVERIFIED})`)
      .bind(stale),
    db
      .prepare(`delete from "account" where "userId" in (${UNVERIFIED})`)
      .bind(stale),
    db
      .prepare(
        `delete from "user" where "emailVerified" = 0 and "createdAt" < ?`,
      )
      .bind(stale),
    db.prepare(`delete from "login_failures" where "expires" < ?`).bind(now),
  ]);
  // Прежние фото после «Undo»: сначала файлы, потом строки — не вышло с файлами, строки остаются до
  // следующего запуска.
  const { results: stalePhotos } = await db
    .prepare(
      `select "photoPrev" from "user" where "photoPrevUntil" is not null and "photoPrevUntil" < ?`,
    )
    .bind(now)
    .all<{ photoPrev: string | null }>();
  await deleteObjects(
    files,
    stalePhotos.map((r) => r.photoPrev),
  );
  const photos = await db
    .prepare(
      `update "user" set "photoPrev" = null, "photoPrevUntil" = null where "photoPrevUntil" is not null and "photoPrevUntil" < ?`,
    )
    .bind(now)
    .run();
  return {
    codes: changes(codes),
    sessions: changes(sessions),
    users: changes(users),
    failures: changes(failures),
    photos: changes(photos),
  };
}
