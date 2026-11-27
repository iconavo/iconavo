// Уборка по расписанию (шаг 3 фазы 5, сроки хранения — решение владельца 27 ноября 2026): просроченные
// коды и сеансы, аккаунты без подтверждённой почты старше суток (с их сеансами и способами входа) и
// старые счётчики неудачных входов. Одна пачка D1 — одна транзакция: не прошёл один запрос — не
// изменилось ничего, и следующий запуск уберёт всё сам. Даты Better Auth — строки ISO одного вида,
// поэтому сравниваются как строки.

import type { D1Like } from "@iconavo-ui/d1";
import { UNVERIFIED_TTL_MS } from "./config.js";

export interface CleanupResult {
  codes: number;
  sessions: number;
  users: number;
  failures: number;
}

const changes = (r: unknown): number => {
  const n = (r as { meta?: { changes?: unknown } } | undefined)?.meta?.changes;
  return typeof n === "number" ? n : 0;
};

const UNVERIFIED = `select "id" from "user" where "emailVerified" = 0 and "createdAt" < ?`;

export async function cleanup(db: D1Like, now: number): Promise<CleanupResult> {
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
  return {
    codes: changes(codes),
    sessions: changes(sessions),
    users: changes(users),
    failures: changes(failures),
  };
}
