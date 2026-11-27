// Таблицы базы iconavo-account (шаг 3 фазы 5, ADR-0055): нумерованные миграции, которые сервис применяет
// сам при первом запросе копии — без отдельного инструмента и без права D1 у ключа выкладки. Миграция
// с записью о себе — одна пачка D1, то есть одна транзакция: две копии функции не применят одну и ту же
// дважды — номер в iconavo_migrations у второй не запишется, и её пачка откатится целиком.
//
// Таблицы Better Auth — ровно его схема (getMigrations для этих настроек): тест сверяет, что Better Auth
// после всех миграций не просит ни таблицы, ни столбца, ни индекса. Обновление Better Auth с новым
// столбцом — новая миграция здесь.

import type { D1Like } from "@iconavo-ui/d1";

export interface Migration {
  id: number;
  /** Что добавляет — для людей. */
  name: string;
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "Better Auth 1.7: user (+ locale), session, account, verification; login_failures",
    statements: [
      `create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "locale" text)`,
      `create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade)`,
      `create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null)`,
      `create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null)`,
      `create index "session_userId_idx" on "session" ("userId")`,
      `create index "account_userId_idx" on "account" ("userId")`,
      `create index "verification_identifier_idx" on "verification" ("identifier")`,
      // Неудачные входы по отпечатку почты: после трёх за 15 минут вход — только с Turnstile.
      `create table "login_failures" ("key" text not null primary key, "count" integer not null, "expires" integer not null)`,
    ],
  },
];

const JOURNAL = `create table if not exists "iconavo_migrations" ("id" integer not null primary key, "name" text not null, "appliedAt" text not null)`;

/**
 * Применить недостающие миграции; номера применённых этим вызовом. Другая копия успела раньше — её
 * номер уже в журнале, и эта пачка откатилась: не ошибка.
 */
export async function migrate(
  db: D1Like,
  now: () => number = Date.now,
): Promise<number[]> {
  await db.prepare(JOURNAL).run();
  const { results } = await db
    .prepare(`select "id" from "iconavo_migrations"`)
    .all<{ id: number }>();
  const done = new Set(results.map((r) => r.id));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    try {
      await db.batch([
        db
          .prepare(
            `insert into "iconavo_migrations" ("id", "name", "appliedAt") values (?, ?, ?)`,
          )
          .bind(m.id, m.name, new Date(now()).toISOString()),
        ...m.statements.map((sql) => db.prepare(sql)),
      ]);
      applied.push(m.id);
    } catch (e) {
      const again = await db
        .prepare(`select "id" from "iconavo_migrations" where "id" = ?`)
        .bind(m.id)
        .first();
      if (again === null) throw e;
    }
  }
  return applied;
}

/**
 * Базы, где миграции уже проверены этой копией функции. Только отметка, а не общее обещание: в workerd
 * запрос не может ждать работу другого запроса (ADR-0024).
 */
const ready = new WeakSet<D1Like>();

export async function ensureSchema(db: D1Like): Promise<void> {
  if (ready.has(db)) return;
  await migrate(db);
  ready.add(db);
}
