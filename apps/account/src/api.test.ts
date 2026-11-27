import { describe, expect, it } from "vitest";
import { SET_PASSWORD_WINDOW_MS } from "./config.js";
import {
  cookieOf,
  counter,
  GOOD_CAPTCHA,
  register,
  SITE,
  world,
} from "./fake.testing.js";

const ANN = "ann@example.com";

describe("регистрация: почта → код → пароль", () => {
  it("код приходит письмом на языке страницы; вход кодом создаёт аккаунт с подтверждённой почтой", async () => {
    const w = world();
    const start = await w.send("/api/account/sign-up", {
      body: { email: " Ann@Example.com ", locale: "ru" },
      captcha: GOOD_CAPTCHA,
    });
    expect([start.status, start.json]).toEqual([200, { success: true }]);
    expect(w.mail).toHaveLength(1);
    expect(w.mail[0]?.to).toBe(ANN);
    expect(w.mail[0]?.subject).toMatch(
      /^\d{6} — код для регистрации в Iconavo$/,
    );
    expect(w.mail[0]?.from).toEqual({
      email: "support@iconavo.dev",
      name: "Iconavo",
    });
    const signIn = await w.send("/api/auth/sign-in/email-otp", {
      body: { email: ANN, otp: w.codeFor(ANN), locale: "ru" },
    });
    expect(signIn.status).toBe(200);
    expect(signIn.json?.user).toMatchObject({
      email: ANN,
      emailVerified: true,
      locale: "ru",
    });
    expect(signIn.res.headers.get("set-cookie")).toMatch(
      /^iconavo\.session_token=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax/,
    );
  });

  it("без Turnstile — 403 и подсказка сайту; письма нет", async () => {
    const w = world();
    for (const captcha of [undefined, "wrong"]) {
      const r = await w.send("/api/account/sign-up", {
        body: { email: ANN },
        ...(captcha ? { captcha } : {}),
      });
      expect([r.status, r.json?.code]).toEqual([403, "CAPTCHA_REQUIRED"]);
      expect(r.res.headers.get("x-iconavo-captcha")).toBe("required");
    }
    expect(w.mail).toEqual([]);
  });

  it("почта занята — 409, как в макете; не почта — 400", async () => {
    const w = world();
    await register(w, ANN);
    const again = await w.send("/api/account/sign-up", {
      body: { email: ANN },
      captcha: GOOD_CAPTCHA,
    });
    expect([again.status, again.json?.code]).toEqual([409, "EMAIL_TAKEN"]);
    const bad = await w.send("/api/account/sign-up", {
      body: { email: "not-an-email" },
      captcha: GOOD_CAPTCHA,
    });
    expect([bad.status, bad.json?.code]).toEqual([400, "INVALID_EMAIL"]);
  });

  it("закрытый режим: регистрируются только адреса из списка — и кодом, и в обход начала", async () => {
    const w = world({
      ACCOUNT_ACCESS: "closed",
      ACCOUNT_ALLOWLIST: "Owner@Iconavo.dev, second@example.com",
    });
    const stranger = await w.send("/api/account/sign-up", {
      body: { email: ANN },
      captcha: GOOD_CAPTCHA,
    });
    expect([stranger.status, stranger.json?.code]).toEqual([
      403,
      "SIGN_UP_CLOSED",
    ]);
    expect(w.mail).toEqual([]);
    await register(w, "owner@iconavo.dev");
    // Даже с кодом входа (его снаружи не получить) — аккаунт не создаётся: охрана в Better Auth.
    const { createAuth } = await import("./auth.js");
    const auth = createAuth(w.env, { waitUntil: () => {}, log: () => {} });
    await auth.api.sendVerificationOTP({
      body: { email: ANN, type: "sign-in" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const bypass = await w.send("/api/auth/sign-in/email-otp", {
      body: { email: ANN, otp: w.codeFor(ANN) },
    });
    expect([bypass.status, bypass.json?.code]).toEqual([403, "SIGN_UP_CLOSED"]);
  });

  it("неверный код — 400; три неверных — код сгорает", async () => {
    const w = world();
    await w.send("/api/account/sign-up", {
      body: { email: ANN },
      captcha: GOOD_CAPTCHA,
    });
    const good = w.codeFor(ANN);
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) {
      const r = await w.send("/api/auth/sign-in/email-otp", {
        body: { email: ANN, otp: wrong },
      });
      expect(r.status).toBe(400);
    }
    const late = await w.send("/api/auth/sign-in/email-otp", {
      body: { email: ANN, otp: good },
    });
    expect(late.status).toBe(403);
    expect(late.json?.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("лишние поля не доходят до Better Auth: картинку при регистрации не задать", async () => {
    const w = world();
    await w.send("/api/account/sign-up", {
      body: { email: ANN },
      captcha: GOOD_CAPTCHA,
    });
    await w.send("/api/auth/sign-in/email-otp", {
      body: {
        email: ANN,
        otp: w.codeFor(ANN),
        image: "https://evil.example/pixel.gif",
        name: "x",
      },
    });
    expect(
      (await w.env.DB.prepare(`select "image", "name" from "user"`).all())
        .results,
    ).toEqual([{ image: null, name: "" }]);
  });
});

describe("пароль сразу после регистрации", () => {
  it("задаётся один раз; потом — только восстановлением по коду", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const again = await w.send("/api/account/password", {
      body: { newPassword: "another pass 2" },
      cookie,
    });
    expect([again.status, again.json?.code]).toEqual([
      409,
      "PASSWORD_ALREADY_SET",
    ]);
  });

  it("без сеанса — 401; позже 30 минут — 403; короткий — 400", async () => {
    const w = world();
    await w.send("/api/account/sign-up", {
      body: { email: ANN },
      captcha: GOOD_CAPTCHA,
    });
    const signIn = await w.send("/api/auth/sign-in/email-otp", {
      body: { email: ANN, otp: w.codeFor(ANN) },
    });
    const cookie = cookieOf(signIn.res);
    expect(
      (
        await w.send("/api/account/password", {
          body: { newPassword: "x".repeat(10) },
        })
      ).status,
    ).toBe(401);
    const short = await w.send("/api/account/password", {
      body: { newPassword: "short" },
      cookie,
    });
    expect([short.status, short.json?.code]).toEqual([
      400,
      "INVALID_PASSWORD_LENGTH",
    ]);
    w.clock.now += SET_PASSWORD_WINDOW_MS + 60_000;
    const late = await w.send("/api/account/password", {
      body: { newPassword: "correct horse 1" },
      cookie,
    });
    expect([late.status, late.json?.code]).toEqual([
      403,
      "PASSWORD_WINDOW_CLOSED",
    ]);
  });
});

describe("вход по паролю", () => {
  it("верный пароль — сеанс; неверный — 401 без подсказки, есть ли почта", async () => {
    const w = world();
    await register(w, ANN);
    const ok = await w.send("/api/auth/sign-in/email", {
      body: { email: ANN, password: "correct horse 1" },
    });
    expect(ok.status).toBe(200);
    expect(cookieOf(ok.res)).toMatch(/^iconavo\.session_token=/);
    for (const email of [ANN, "nobody@example.com"]) {
      const r = await w.send("/api/auth/sign-in/email", {
        body: { email, password: "wrong pass 9" },
      });
      expect([r.status, r.json?.code]).toEqual([
        401,
        "INVALID_EMAIL_OR_PASSWORD",
      ]);
    }
  });

  it("после трёх неудач за 15 минут — только с Turnstile; удача сбрасывает счёт", async () => {
    const w = world();
    await register(w, ANN);
    const wrong = () =>
      w.send("/api/auth/sign-in/email", {
        body: { email: ANN, password: "wrong pass 9" },
      });
    expect((await wrong()).res.headers.get("x-iconavo-captcha")).toBeNull();
    await wrong();
    const third = await wrong();
    expect(third.status).toBe(401);
    expect(third.res.headers.get("x-iconavo-captcha")).toBe("required");
    const blocked = await w.send("/api/auth/sign-in/email", {
      body: { email: ANN, password: "correct horse 1" },
    });
    expect([blocked.status, blocked.json?.code]).toEqual([
      403,
      "CAPTCHA_REQUIRED",
    ]);
    const solved = await w.send("/api/auth/sign-in/email", {
      body: { email: ANN, password: "correct horse 1" },
      captcha: GOOD_CAPTCHA,
    });
    expect(solved.status).toBe(200);
    const fresh = await w.send("/api/auth/sign-in/email", {
      body: { email: ANN, password: "correct horse 1" },
    });
    expect(fresh.status).toBe(200);
    // Окно прошло — счёт с нуля и без Turnstile.
    await wrong();
    await wrong();
    await wrong();
    w.clock.now += 16 * 60_000;
    expect(
      (
        await w.send("/api/auth/sign-in/email", {
          body: { email: ANN, password: "correct horse 1" },
        })
      ).status,
    ).toBe(200);
  });
});

describe("восстановление пароля кодом", () => {
  it("код на почту → проверка кода → новый пароль; прежние сеансы завершены", async () => {
    const w = world();
    const old = await register(w, ANN, "correct horse 1", "ru");
    const ask = await w.send("/api/auth/email-otp/request-password-reset", {
      body: { email: ANN },
      captcha: GOOD_CAPTCHA,
      locale: "en",
    });
    expect(ask.status).toBe(200);
    // Язык — сохранённый у человека, а не страницы.
    expect(w.mail.at(-1)?.subject).toMatch(
      /^\d{6} — код для нового пароля Iconavo$/,
    );
    const otp = w.codeFor(ANN);
    const check = await w.send("/api/auth/email-otp/check-verification-otp", {
      body: { email: ANN, type: "forget-password", otp },
    });
    expect(check.status).toBe(200);
    const reset = await w.send("/api/auth/email-otp/reset-password", {
      body: { email: ANN, otp, password: "brand new pass 3" },
    });
    expect(reset.status).toBe(200);
    const session = await w.send("/api/auth/get-session", { cookie: old });
    expect(session.json).toBeNull();
    expect(
      (
        await w.send("/api/auth/sign-in/email", {
          body: { email: ANN, password: "brand new pass 3" },
        })
      ).status,
    ).toBe(200);
  });

  it("не говорит, есть ли аккаунт: на чужую почту — тот же ответ и без письма", async () => {
    const w = world();
    const r = await w.send("/api/auth/email-otp/request-password-reset", {
      body: { email: "nobody@example.com" },
      captcha: GOOD_CAPTCHA,
    });
    expect([r.status, r.json]).toEqual([200, { success: true }]);
    expect(w.mail).toEqual([]);
  });

  it("без Turnstile — 403; проверять можно только коды регистрации и пароля", async () => {
    const w = world();
    const r = await w.send("/api/auth/email-otp/request-password-reset", {
      body: { email: ANN },
    });
    expect([r.status, r.json?.code]).toEqual([403, "CAPTCHA_REQUIRED"]);
    const check = await w.send("/api/auth/email-otp/check-verification-otp", {
      body: { email: ANN, type: "email-verification", otp: "123456" },
    });
    expect([check.status, check.json?.code]).toEqual([400, "INVALID_OTP_TYPE"]);
  });
});

describe("охрана", () => {
  it("изменения — только со страниц сайта: без Origin и с чужим — 403", async () => {
    const w = world();
    await register(w, ANN);
    for (const origin of [null, "https://evil.example"]) {
      const r = await w.send("/api/auth/sign-in/email", {
        body: { email: ANN, password: "correct horse 1" },
        origin,
      });
      expect([r.status, r.json?.code]).toEqual([403, "FORBIDDEN_ORIGIN"]);
    }
  });

  it("CORS — только сайту, с cookie; предварительный запрос чужого — 403", async () => {
    const w = world();
    const pre = await w.send("/api/auth/sign-in/email", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(Object.fromEntries(pre.res.headers)).toMatchObject({
      "access-control-allow-origin": SITE,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers":
        "content-type, x-captcha-response, x-iconavo-locale",
    });
    const evil = await w.send("/api/auth/sign-in/email", {
      method: "OPTIONS",
      origin: "https://evil.example",
    });
    expect(evil.status).toBe(403);
    const session = await w.send("/api/auth/get-session");
    expect(session.status).toBe(200);
    expect(session.res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(session.res.headers.get("cache-control")).toBe("no-store");
    const foreign = await w.send("/api/auth/get-session", {
      origin: "https://evil.example",
    });
    expect(foreign.res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([
    "/api/auth/sign-up/email",
    "/api/auth/email-otp/send-verification-otp",
    "/api/auth/delete-user",
    "/api/auth/delete-user/callback",
    "/api/auth/update-user",
    "/api/auth/list-accounts",
    "/api/auth/unlink-account",
    "/api/auth/change-password",
    "/api/auth/delete-user",
    "/api/auth/email-otp/request-email-change",
    "/api/auth/email-otp/change-email",
    "/api/auth/change-email",
    "/api/auth/forget-password/email-otp",
    "/api/nothing",
  ])("%s снаружи закрыт — 404", async (path) => {
    const r = await world().send(path, { body: {} });
    expect([r.status, r.json?.code]).toEqual([404, "NOT_FOUND"]);
  });

  it("не тот метод — 405, не JSON — 415, не объект — 400, слишком большое — 413", async () => {
    const w = world();
    const get = await w.send("/api/auth/sign-in/email");
    expect([get.status, get.res.headers.get("allow")]).toEqual([405, "POST"]);
    expect(
      (
        await w.send("/api/auth/sign-in/email", {
          raw: "a=b",
          type: "application/x-www-form-urlencoded",
        })
      ).status,
    ).toBe(415);
    expect(
      (await w.send("/api/auth/sign-in/email", { raw: "[1]" })).status,
    ).toBe(400);
    expect((await w.send("/api/auth/sign-in/email", { raw: "{" })).status).toBe(
      400,
    );
    expect(
      (
        await w.send("/api/auth/sign-in/email", {
          raw: JSON.stringify({ email: "x".repeat(9000) }),
        })
      ).status,
    ).toBe(413);
  });

  it("только Google: другой вход — 400", async () => {
    const r = await world().send("/api/auth/sign-in/social", {
      body: { provider: "github", callbackURL: `${SITE}/` },
    });
    expect([r.status, r.json?.code]).toEqual([400, "PROVIDER_NOT_FOUND"]);
  });

  it("Google: адрес входа ведёт на accounts.google.com с возвратом на сервис", async () => {
    const w = world({
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
    });
    const r = await w.send("/api/auth/sign-in/social", {
      body: { provider: "google", callbackURL: `${SITE}/` },
    });
    expect(r.status).toBe(200);
    const url = new URL(String(r.json?.url));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:4287/api/auth/callback/google",
    );
    expect(url.searchParams.get("prompt")).toBe("select_account");
    // Возврат — только на страницы сайта (Better Auth сам пускал и чужой адрес).
    for (const callbackURL of [
      "https://evil.example/",
      `${SITE}.evil.example/`,
      "/relative",
    ]) {
      const evil = await w.send("/api/auth/sign-in/social", {
        body: { provider: "google", callbackURL },
      });
      expect([evil.status, evil.json?.code]).toEqual([
        400,
        "INVALID_CALLBACK_URL",
      ]);
    }
    const errorBack = await w.send("/api/auth/sign-in/social", {
      body: {
        provider: "google",
        callbackURL: `${SITE}/`,
        errorCallbackURL: "https://evil.example/",
      },
    });
    expect(errorBack.status).toBe(400);
  });

  it("лимиты: письмо с кодом на одну почту — раз в минуту; запросы с адреса — по лимиту", async () => {
    const code = counter(1);
    const w = world({ CODE_LIMIT: code });
    const ask = () =>
      w.send("/api/account/sign-up", {
        body: { email: ANN },
        captcha: GOOD_CAPTCHA,
      });
    expect((await ask()).status).toBe(200);
    const again = await ask();
    expect([again.status, again.json?.code]).toEqual([429, "RATE_LIMITED"]);
    expect(again.res.headers.get("retry-after")).toBe("60");
    // Ключ — отпечаток почты, не сама почта.
    expect(code.calls.every((k) => /^code:[0-9a-f]{32}$/.test(k))).toBe(true);
    const ip = counter(2);
    const v = world({ AUTH_LIMIT: ip });
    for (const status of [401, 401, 429]) {
      expect(
        (
          await v.send("/api/auth/sign-in/email", {
            body: { email: ANN, password: "x".repeat(9) },
          })
        ).status,
      ).toBe(status);
    }
    expect(ip.calls[0]).toBe("ip:203.0.113.7");
  });

  it("лимит не ответил — запрос идёт, в журнале — строка без адреса", async () => {
    const w = world({
      AUTH_LIMIT: {
        limit: async () => {
          throw new Error("down");
        },
      },
    });
    const r = await w.send("/api/auth/sign-in/email", {
      body: { email: ANN, password: "x".repeat(9) },
    });
    expect(r.status).toBe(401);
    expect(w.logs).toEqual(["аккаунты: лимит частоты не ответил: down"]);
  });

  it("журнал без почт: письмо не ушло — только код ошибки", async () => {
    const w = world({
      EMAIL: {
        send: async () => {
          throw Object.assign(new Error(`rejected ${ANN}`), {
            code: "E_RECIPIENT_SUPPRESSED",
          });
        },
      },
    });
    const r = await w.send("/api/account/sign-up", {
      body: { email: ANN },
      captcha: GOOD_CAPTCHA,
    });
    expect(r.status).toBe(200);
    expect(w.logs).toEqual([
      "аккаунты: письмо не ушло: E_RECIPIENT_SUPPRESSED",
    ]);
  });
});

describe("cookie на живом адресе", () => {
  it("https — __Host-, Secure, без Domain", async () => {
    const w = world({
      COOKIE_MODE: undefined,
      SITE_ORIGIN: "https://iconavo.dev",
      SERVICE_ORIGIN: "https://account.iconavo.dev",
    });
    await w.send("/api/account/sign-up", {
      body: { email: ANN },
      origin: "https://iconavo.dev",
      captcha: GOOD_CAPTCHA,
    });
    const r = await w.send("/api/auth/sign-in/email-otp", {
      body: { email: ANN, otp: w.codeFor(ANN) },
      origin: "https://iconavo.dev",
    });
    const cookie = r.res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-iconavo\.session_token=/);
    expect(cookie).toContain("; Secure");
    expect(cookie).toContain("; HttpOnly");
    expect(cookie).toContain("; SameSite=Lax");
    expect(cookie).toContain("; Path=/");
    expect(cookie.toLowerCase()).not.toContain("domain=");
  });
});
