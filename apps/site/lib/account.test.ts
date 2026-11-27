import { describe, expect, it } from "vitest";
import {
  ACCOUNT,
  accountsSwitch,
  clock,
  digitsOnly,
  googleReturn,
  googleUrls,
  initialOf,
  messageOf,
  type Reply,
  request,
  secondsLeft,
  userOf,
  validEmail,
  withCaptcha,
  withoutAccountParams,
} from "./account";
import { ACCOUNTS_OPEN } from "./account-config";

/** Подделка fetch: запоминает запросы, отвечает по очереди. */
function fakeFetch(...replies: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (next === undefined) throw new Error("лишний запрос");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("закрытый режим (решение владельца 27 ноября 2026)", () => {
  it("до /security-review интерфейс аккаунтов выключен; включает ?accounts=on", () => {
    expect(ACCOUNTS_OPEN).toBe(false);
    expect(ACCOUNT).toBe("https://account.iconavo.dev");
    expect(accountsSwitch("?accounts=on")).toBe("on");
    expect(accountsSwitch("?q=house&accounts=off")).toBe("off");
    expect(accountsSwitch("?accounts=yes")).toBeUndefined();
    expect(accountsSwitch("")).toBeUndefined();
  });
});

describe("адрес страницы", () => {
  it("служебные параметры уходят, остальные остаются", () => {
    expect(
      withoutAccountParams("https://iconavo.dev/lucide?accounts=on&page=2"),
    ).toBe("https://iconavo.dev/lucide?page=2");
    expect(
      withoutAccountParams(
        "https://iconavo.dev/ru?account=google-error&error=access_denied&error_description=x",
      ),
    ).toBe("https://iconavo.dev/ru");
    // error без возврата после Google — чужой параметр, его не трогаем.
    const plain = "https://iconavo.dev/search?q=error&error=1";
    expect(withoutAccountParams(plain)).toBe(plain);
  });

  it("возврат после Google: новый аккаунт и ошибка с кодом Better Auth", () => {
    expect(googleReturn("?account=welcome")).toEqual({ kind: "welcome" });
    expect(googleReturn("?account=google-error&error=SIGN_UP_CLOSED")).toEqual({
      kind: "error",
      code: "SIGN_UP_CLOSED",
    });
    expect(googleReturn("?account=google-error")).toEqual({
      kind: "error",
      code: "",
    });
    expect(googleReturn("?account=other")).toBeUndefined();
  });

  it("Google возвращает на эту же страницу, без якоря и служебных параметров", () => {
    expect(
      googleUrls(
        "https://iconavo.dev/ru/lucide?icon=lucide:house&accounts=on#x",
      ),
    ).toEqual({
      callbackURL: "https://iconavo.dev/ru/lucide?icon=lucide%3Ahouse",
      errorCallbackURL:
        "https://iconavo.dev/ru/lucide?icon=lucide%3Ahouse&account=google-error",
      newUserCallbackURL:
        "https://iconavo.dev/ru/lucide?icon=lucide%3Ahouse&account=welcome",
    });
  });
});

describe("поля окна", () => {
  it("почта — как её принимает сервис", () => {
    expect(validEmail(" Ann@Example.com ")).toBe(true);
    expect(validEmail("ann@example")).toBe(false);
    expect(validEmail("ann example.com")).toBe(false);
    expect(validEmail(`${"a".repeat(65)}@example.com`)).toBe(false);
  });

  it("код — только цифры, не больше шести", () => {
    expect(digitsOnly("482 913")).toBe("482913");
    expect(digitsOnly("48-29-13-77")).toBe("482913");
    expect(digitsOnly("abc")).toBe("");
  });

  it("повтор письма — через минуту: «Resend in 0:59»", () => {
    expect(secondsLeft(1_000, 1_000)).toBe(60);
    expect(secondsLeft(1_000, 1_500)).toBe(60);
    expect(secondsLeft(1_000, 2_000)).toBe(59);
    expect(secondsLeft(1_000, 61_000)).toBe(0);
    expect(secondsLeft(0, 99_000)).toBe(0);
    expect(clock(59)).toBe("0:59");
    expect(clock(60)).toBe("1:00");
    expect(clock(5)).toBe("0:05");
  });

  it("буква аватара — первая буква имени, иначе почты", () => {
    expect(initialOf({ name: "anna", email: "x@y.z" })).toBe("A");
    expect(initialOf({ name: "", email: "ёж@example.com" })).toBe("Ё");
    expect(initialOf({ name: "🙂 Ann", email: "bob@example.com" })).toBe("B");
    expect(initialOf({ name: "", email: "" })).toBe("?");
  });

  it("из ответа сервиса — только почта и имя", () => {
    expect(
      userOf({
        token: "secret",
        user: { id: "1", email: "ann@example.com", name: null, image: "x" },
      }),
    ).toEqual({ email: "ann@example.com", name: "" });
    expect(userOf(null)).toBeUndefined();
    expect(userOf({ session: {} })).toBeUndefined();
  });
});

describe("запросы к сервису", () => {
  it("POST с cookie, JSON, Turnstile и языком писем", async () => {
    const f = fakeFetch(json({ success: true }));
    const reply = await request("/api/account/sign-up", {
      body: { email: "ann@example.com", locale: "ru" },
      captcha: "token",
      locale: "ru",
      fetchFn: f.fn,
    });
    expect(reply).toEqual({
      ok: true,
      status: 200,
      code: "",
      data: { success: true },
      captcha: false,
    });
    const [call] = f.calls;
    expect(call?.url).toBe("https://account.iconavo.dev/api/account/sign-up");
    expect(call?.init).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-captcha-response": "token",
        "x-iconavo-locale": "ru",
      },
      body: JSON.stringify({ email: "ann@example.com", locale: "ru" }),
    });
  });

  it("GET без тела: сеанс; нет сеанса — null", async () => {
    const f = fakeFetch(new Response("null", { status: 200 }));
    const reply = await request("/api/auth/get-session", { fetchFn: f.fn });
    expect(reply.ok).toBe(true);
    expect(reply.data).toBeNull();
    expect(f.calls[0]?.init.method).toBe("GET");
    expect(f.calls[0]?.init.body).toBeUndefined();
    expect(f.calls[0]?.init.credentials).toBe("include");
  });

  it("ошибки: код сервиса, 429, сбой сети, просьба о Turnstile", async () => {
    const f = fakeFetch(
      json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "x" }, 401, {
        "x-iconavo-captcha": "required",
      }),
      json({ code: "RATE_LIMITED" }, 429),
      new TypeError("Failed to fetch"),
      new Response("<html>", { status: 502 }),
    );
    const send = () => request("/x", { body: {}, fetchFn: f.fn });
    expect(await send()).toEqual({
      ok: false,
      status: 401,
      code: "INVALID_EMAIL_OR_PASSWORD",
      data: null,
      captcha: true,
    });
    expect((await send()).code).toBe("RATE_LIMITED");
    expect(await send()).toEqual({
      ok: false,
      status: 0,
      code: "NETWORK",
      data: null,
      captcha: false,
    });
    expect((await send()).code).toBe("HTTP_502");
  });
});

describe("Turnstile", () => {
  const reply = (code: string): Reply => ({
    ok: code === "",
    status: code === "" ? 200 : 403,
    code,
    data: null,
    captcha: false,
  });

  it("регистрация: сначала задача, потом запрос с её ответом", async () => {
    const sent: (string | undefined)[] = [];
    let solved = 0;
    const r = await withCaptcha(
      async (captcha) => {
        sent.push(captcha);
        return reply("");
      },
      async () => `t${++solved}`,
      true,
    );
    expect(r.ok).toBe(true);
    expect(sent).toEqual(["t1"]);
  });

  it("вход: без задачи; сервис попросил — решить и повторить один раз", async () => {
    const sent: (string | undefined)[] = [];
    let solved = 0;
    const answers = ["CAPTCHA_REQUIRED", ""];
    const r = await withCaptcha(
      async (captcha) => {
        sent.push(captcha);
        return reply(answers.shift() ?? "");
      },
      async () => `t${++solved}`,
      false,
    );
    expect(r.ok).toBe(true);
    expect(sent).toEqual([undefined, "t1"]);
  });

  it("ответ виджета снова не приняли — ошибка, без бесконечных повторов", async () => {
    const sent: (string | undefined)[] = [];
    let solved = 0;
    const r = await withCaptcha(
      async (captcha) => {
        sent.push(captcha);
        return reply("CAPTCHA_REQUIRED");
      },
      async () => `t${++solved}`,
      true,
    );
    expect(r.code).toBe("CAPTCHA_REQUIRED");
    expect(sent).toEqual(["t1", "t2"]);
    expect(messageOf(r.code)).toBe("authErrorCaptcha");
  });
});

describe("тексты ошибок", () => {
  it("каждый код сервиса — свой текст, незнакомое — «что-то пошло не так»", () => {
    expect(messageOf("INVALID_EMAIL_OR_PASSWORD")).toBe("authErrorCredentials");
    expect(messageOf("EMAIL_TAKEN")).toBe("authErrorEmailTaken");
    expect(messageOf("SIGN_UP_CLOSED")).toBe("authErrorSignUpClosed");
    expect(messageOf("INVALID_OTP")).toBe("authErrorCode");
    expect(messageOf("OTP_EXPIRED")).toBe("authErrorCodeExpired");
    expect(messageOf("TOO_MANY_ATTEMPTS")).toBe("authErrorCodeAttempts");
    expect(messageOf("PASSWORD_TOO_SHORT")).toBe("authErrorPasswordLength");
    expect(messageOf("PASSWORD_WINDOW_CLOSED")).toBe("authErrorPasswordWindow");
    expect(messageOf("RATE_LIMITED")).toBe("authErrorRateLimited");
    expect(messageOf("NETWORK")).toBe("authErrorNetwork");
    expect(messageOf("HTTP_502")).toBe("authErrorNetwork");
  });
});
