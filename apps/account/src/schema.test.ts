import { DatabaseSync } from "node:sqlite";
import { sqliteD1 } from "@iconavo-ui/d1/sqlite";
import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vitest";
import { createAuth, localeOf, mayRegister, redact } from "./auth.js";
import { cleanup } from "./cleanup.js";
import { UNVERIFIED_TTL_MS } from "./config.js";
import type { Env } from "./env.js";
import { world } from "./fake.testing.js";
import worker from "./index.js";
import { codeMail, sendMail } from "./mail.js";
import { MIGRATIONS, migrate } from "./migrations.js";

const env = (): Env => ({
  DB: sqliteD1(new DatabaseSync(":memory:")),
  BETTER_AUTH_SECRET: "test-secret-".repeat(4),
});

describe("миграции", () => {
  it("после всех миграций Better Auth не просит ни таблицы, ни столбца, ни индекса", async () => {
    const e = env();
    expect(await migrate(e.DB)).toEqual(MIGRATIONS.map((m) => m.id));
    const auth = createAuth(e, { waitUntil: () => {}, log: () => {} });
    const need = await getMigrations(auth.options);
    expect({
      tables: need.toBeCreated.map((t) => t.table),
      columns: need.toBeAdded.map((t) => t.table),
      indexes: need.toBeAddedIndexes.map((i) => i.name),
      unsafe: need.unsafeChanges,
    }).toEqual({ tables: [], columns: [], indexes: [], unsafe: [] });
  });

  it("повтор ничего не делает; другая копия успела раньше — не ошибка", async () => {
    const e = env();
    const [a, b] = await Promise.all([migrate(e.DB), migrate(e.DB)]);
    expect([...(a ?? []), ...(b ?? [])].sort()).toEqual([1]);
    expect(await migrate(e.DB)).toEqual([]);
    const tables = (
      await e.DB.prepare(
        `select "name" from "sqlite_master" where "type" = 'table' order by "name"`,
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    expect(tables).toEqual([
      "account",
      "iconavo_migrations",
      "login_failures",
      "session",
      "user",
      "verification",
    ]);
  });
});

describe("уборка по расписанию", () => {
  it("просроченные коды и сеансы, неподтверждённые аккаунты старше суток; свежее — на месте", async () => {
    const e = env();
    await migrate(e.DB);
    const now = Date.UTC(2026, 10, 27, 12);
    const iso = (ms: number) => new Date(ms).toISOString();
    const user = (id: string, verified: number, created: number) =>
      e.DB.prepare(
        `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (?, '', ?, ?, ?, ?)`,
      ).bind(id, `${id}@example.com`, verified, iso(created), iso(created));
    const session = (id: string, userId: string, expires: number) =>
      e.DB.prepare(
        `insert into "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") values (?, ?, ?, ?, ?, ?)`,
      ).bind(id, iso(expires), `t-${id}`, iso(now), iso(now), userId);
    const code = (id: string, expires: number) =>
      e.DB.prepare(
        `insert into "verification" ("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt") values (?, ?, 'h:0', ?, ?, ?)`,
      ).bind(id, `sign-in-otp-${id}`, iso(expires), iso(now), iso(now));
    await e.DB.batch([
      user("old", 0, now - UNVERIFIED_TTL_MS - 1),
      user("new", 0, now - 60_000),
      user("ok", 1, now - 10 * UNVERIFIED_TTL_MS),
      session("s-old-user", "old", now + 86_400_000),
      session("s-expired", "ok", now - 1),
      session("s-live", "ok", now + 86_400_000),
      code("c-expired", now - 1),
      code("c-live", now + 60_000),
      e.DB.prepare(
        `insert into "login_failures" ("key", "count", "expires") values ('a', 3, ?), ('b', 1, ?)`,
      ).bind(now - 1, now + 60_000),
    ]);
    expect(await cleanup(e.DB, now)).toEqual({
      codes: 1,
      sessions: 1,
      users: 1,
      failures: 1,
    });
    const ids = async (table: string) =>
      (
        await e.DB.prepare(`select "id" from "${table}" order by "id"`).all<{
          id: string;
        }>()
      ).results.map((r) => r.id);
    expect(await ids("user")).toEqual(["new", "ok"]);
    expect(await ids("session")).toEqual(["s-live"]);
    expect(await ids("verification")).toEqual(["c-live"]);
  });
});

describe("письма", () => {
  it.each([
    ["en", "sign-up", /^\d{6} is your Iconavo sign-up code$/],
    ["en", "reset", /^\d{6} is your Iconavo password reset code$/],
    ["ru", "sign-up", /^\d{6} — код для регистрации в Iconavo$/],
    ["ru", "reset", /^\d{6} — код для нового пароля Iconavo$/],
  ] as const)(
    "%s, %s: код в теме, HTML и тексте, срок — 10 минут",
    (locale, kind, subject) => {
      const m = codeMail("ann@example.com", "482913", kind, locale);
      expect(m.subject.replace("482913", "000000")).toMatch(subject);
      expect(m.html).toContain(`<html lang="${locale}">`);
      expect(m.html).toContain("482913");
      expect(m.text).toContain("482913");
      expect(m.text).toMatch(/10 (minutes|минут)/);
    },
  );

  it("нет привязки — false и строка журнала", async () => {
    const log: string[] = [];
    expect(
      await sendMail(undefined, codeMail("a@b.co", "1", "reset", "en"), (l) =>
        log.push(l),
      ),
    ).toBe(false);
    expect(log).toEqual(["аккаунты: письмо не ушло: нет привязки EMAIL"]);
  });
});

describe("мелочи Better Auth", () => {
  it("журнал без почт и длинных токенов", () => {
    expect(
      redact(
        "User ann@example.com token sXoo9PP9YB9ZJmz7NbUgcE0nRvHqtkJc failed",
      ),
    ).toBe("User <почта> token <…> failed");
  });

  it("язык — en или ru, иначе en; закрытый режим — по списку без регистра", () => {
    expect([localeOf("ru"), localeOf("de"), localeOf(null)]).toEqual([
      "ru",
      "en",
      "en",
    ]);
    const e = { ...env(), ACCOUNT_ALLOWLIST: " Owner@Iconavo.dev ,," };
    expect(mayRegister(e, "owner@iconavo.dev")).toBe(true);
    expect(mayRegister(e, "ann@example.com")).toBe(false);
    expect(
      mayRegister({ ...e, ACCOUNT_ACCESS: "open" }, "ann@example.com"),
    ).toBe(true);
  });
});

describe("точка входа функции", () => {
  const ctx = { waitUntil: () => {} };

  it("страница для людей, robots.txt, 404 и 405", async () => {
    const e = env();
    const page = await worker.fetch(
      new Request("https://account.iconavo.dev/"),
      e,
      ctx,
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("x-iconavo-build")).toBe("__ICONAVO_BUILD__");
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await page.text()).toContain("iconavo.dev");
    const robots = await worker.fetch(
      new Request("https://account.iconavo.dev/robots.txt"),
      e,
      ctx,
    );
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(
      (await worker.fetch(new Request("https://account.iconavo.dev/x"), e, ctx))
        .status,
    ).toBe(404);
    expect(
      (
        await worker.fetch(
          new Request("https://account.iconavo.dev/", { method: "POST" }),
          e,
          ctx,
        )
      ).status,
    ).toBe(405);
  });

  it("расписание создаёт таблицы и убирает; /api отвечает через охрану", async () => {
    const w = world();
    await worker.scheduled({}, w.env);
    const tables = await w.env.DB.prepare(
      `select count(*) as "n" from "sqlite_master" where "type" = 'table'`,
    ).first<{ n: number }>();
    expect(tables?.n).toBe(6);
    const res = await worker.fetch(
      new Request("http://127.0.0.1:4287/api/auth/get-session", {
        headers: { origin: "http://127.0.0.1:4284" },
      }),
      w.env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
