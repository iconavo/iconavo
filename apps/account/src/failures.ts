// Счётчики неудач (шаг 3 фазы 5): неверные пароли при входе — по отпечатку почты, неверный текущий пароль
// в кабинете — по человеку. Окно — 15 минут от последней неудачи, таблица login_failures; уборка по
// расписанию удаляет старые строки.

import type { D1Like } from "@iconavo-ui/d1";
import { LOGIN_FAILURES } from "./config.js";

/** Неудач по ключу за окно; нет — 0. */
export async function failures(
  db: D1Like,
  key: string,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(`select "count", "expires" from "login_failures" where "key" = ?`)
    .bind(key)
    .first<{ count: number; expires: number }>();
  return row !== null && row.expires > now ? row.count : 0;
}

/** Ещё одна неудача; окно — 15 минут от последней. Счёт после записи. */
export async function recordFailure(
  db: D1Like,
  key: string,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      `insert into "login_failures" ("key", "count", "expires") values (?, 1, ?)
on conflict ("key") do update set "count" = case when "expires" > ? then "count" + 1 else 1 end, "expires" = excluded."expires"
returning "count"`,
    )
    .bind(key, now + LOGIN_FAILURES.windowMs, now)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

/** Удачно — счёт с нуля. */
export async function clearFailures(db: D1Like, key: string): Promise<void> {
  await db
    .prepare(`delete from "login_failures" where "key" = ?`)
    .bind(key)
    .run();
}
