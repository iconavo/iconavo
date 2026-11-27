import { describe, expect, it } from "vitest";
import { cleanup } from "./cleanup.js";
import { PHOTO } from "./config.js";
import { cookieOf, register, SITE, world } from "./fake.testing.js";
import { imageInfo } from "./image.js";
import { maskEmail, noticeMail } from "./mail.js";
import { biggerGooglePhoto, copyGooglePhoto } from "./photos.js";
import { cleanName } from "./profile.js";

const ANN = "ann@example.com";
const PASSWORD = "correct horse 1";

/** PNG: подпись и заголовок IHDR нужного размера (остальное сервису не нужно). */
function png(width: number, height = width, extra = 64): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(b.buffer);
  view.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

/** JPEG: APP0, затем SOF0 с размером. */
function jpg(width: number, height = width): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
}

const upload = (
  w: ReturnType<typeof world>,
  cookie: string,
  bytes: Uint8Array,
  type = "image/png",
) => w.send("/api/account/photo", { bytes, type, cookie });

describe("картинки фото", () => {
  it("PNG и JPEG — размер из заголовка; другое — нет", () => {
    expect(imageInfo(png(400))).toEqual({
      type: "image/png",
      ext: "png",
      width: 400,
      height: 400,
    });
    expect(imageInfo(jpg(300, 200))).toEqual({
      type: "image/jpeg",
      ext: "jpg",
      width: 300,
      height: 200,
    });
    expect(imageInfo(new TextEncoder().encode("<svg></svg>"))).toBeUndefined();
    expect(imageInfo(png(400).slice(0, 20))).toBeUndefined();
  });

  it("имя: без служебных знаков и лишних пробелов, до 64 знаков", () => {
    expect(cleanName("  Анна \u0007 Ким  ")).toBe("Анна Ким");
    expect(cleanName("")).toBe("");
    expect(cleanName("я".repeat(64))).toBe("я".repeat(64));
    expect(cleanName("я".repeat(65))).toBeUndefined();
    expect(cleanName(5)).toBeUndefined();
  });
});

describe("кабинет без входа", () => {
  it("данные, профиль и фото — 401", async () => {
    const w = world();
    expect((await w.send("/api/account/me")).status).toBe(401);
    expect(
      (await w.send("/api/account/profile", { body: { name: "x" } })).status,
    ).toBe(401);
    expect(
      (await w.send(`/api/account/photo/${"a".repeat(32)}.png`)).status,
    ).toBe(401);
  });
});

describe("профиль и письма", () => {
  it("me: почта, имя, письма по умолчанию — сводка да, новости нет; пароль есть, Google нет", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const me = await w.send("/api/account/me", { cookie });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({
      email: ANN,
      name: "",
      emailVerified: true,
      photo: null,
      digest: true,
      news: false,
      password: { set: true },
      google: false,
    });
    const password = me.json?.password as { changedAt?: unknown } | undefined;
    expect(typeof password?.changedAt).toBe("string");
  });

  it("имя: пустое и длинное — ошибки макета; письма — только true или false", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const empty = await w.send("/api/account/profile", {
      body: { name: "   " },
      cookie,
    });
    expect([empty.status, empty.json?.code]).toEqual([400, "NAME_EMPTY"]);
    const long = await w.send("/api/account/profile", {
      body: { name: "x".repeat(65) },
      cookie,
    });
    expect([long.status, long.json?.code]).toEqual([400, "NAME_TOO_LONG"]);
    const bad = await w.send("/api/account/profile", {
      body: { news: "yes" },
      cookie,
    });
    expect([bad.status, bad.json?.code]).toEqual([400, "INVALID_FIELD"]);
    const ok = await w.send("/api/account/profile", {
      body: { name: " Ann ", digest: false, news: true },
      cookie,
    });
    expect(ok.json).toMatchObject({ name: "Ann", digest: false, news: true });
    const session = await w.send("/api/auth/get-session", { cookie });
    const user = session.json?.user as { name?: unknown } | undefined;
    expect(user?.name).toBe("Ann");
  });
});

describe("фото профиля", () => {
  it("не картинка, не квадрат, мало или много — отказ; PNG хранится и отдаётся только хозяину", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const svg = await w.send("/api/account/photo", {
      raw: "<svg/>",
      type: "image/svg+xml",
      cookie,
    });
    expect([svg.status, svg.json?.code]).toEqual([
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ]);
    const fake = await upload(w, cookie, new TextEncoder().encode("not png"));
    expect([fake.status, fake.json?.code]).toEqual([415, "UNSUPPORTED_IMAGE"]);
    for (const bytes of [png(400, 300), png(64), png(2048)]) {
      const r = await upload(w, cookie, bytes);
      expect([r.status, r.json?.code]).toEqual([400, "INVALID_IMAGE_SIZE"]);
    }
    const huge = await upload(w, cookie, png(400, 400, PHOTO.maxBytes));
    expect([huge.status, huge.json?.code]).toEqual([413, "TOO_LARGE"]);

    const ok = await upload(w, cookie, png(400));
    expect(ok.status).toBe(200);
    const url = String(ok.json?.photo);
    expect(url).toMatch(/^\/api\/account\/photo\/[0-9a-f]{32}\.png$/);
    expect([...w.files.objects.keys()]).toHaveLength(1);
    const file = await w.send(url, { cookie });
    expect(file.status).toBe(200);
    expect(file.res.headers.get("content-type")).toBe("image/png");
    expect(file.res.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(new Uint8Array(await file.res.arrayBuffer())).toEqual(png(400));

    // Чужой человек не видит чужое фото, даже зная адрес.
    const bob = await register(w, "bob@example.com");
    expect((await w.send(url, { cookie: bob })).status).toBe(404);
  });

  it("новое фото, «Undo» 10 минут и «Remove»: прежнее возвращается, лишнее удаляется", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const first = String((await upload(w, cookie, png(400))).json?.photo);
    const second = String(
      (await upload(w, cookie, jpg(512), "image/jpeg")).json?.photo,
    );
    expect(second).toMatch(/\.jpg$/);
    expect(w.files.objects.size).toBe(2);
    // Прежнее фото ещё отдаётся — для «Undo».
    expect((await w.send(first, { cookie })).status).toBe(200);
    const undo = await w.send("/api/account/photo/undo", { body: {}, cookie });
    expect(undo.json).toEqual({ photo: first });
    expect(w.files.objects.size).toBe(1);
    expect((await w.send(second, { cookie })).status).toBe(404);
    const again = await w.send("/api/account/photo/undo", { body: {}, cookie });
    expect([again.status, again.json?.code]).toEqual([409, "NOTHING_TO_UNDO"]);

    const removed = await w.send("/api/account/photo/remove", {
      body: {},
      cookie,
    });
    expect(removed.json).toEqual({ photo: null });
    expect(
      (await w.send("/api/account/me", { cookie })).json?.photo,
    ).toBeNull();
    const back = await w.send("/api/account/photo/undo", { body: {}, cookie });
    expect(back.json).toEqual({ photo: first });

    // Через 10 минут «Undo» уже нет, а уборка удаляет прежнее фото.
    await w.send("/api/account/photo/remove", { body: {}, cookie });
    w.clock.now += PHOTO.undoMs + 1;
    const late = await w.send("/api/account/photo/undo", { body: {}, cookie });
    expect(late.status).toBe(409);
    expect(w.files.objects.size).toBe(1);
    const swept = await cleanup(w.env.DB, w.clock.now, w.env.FILES);
    expect(swept.photos).toBe(1);
    expect(w.files.objects.size).toBe(0);
  });
});

describe("смена почты кодом на новый адрес", () => {
  it("текущий пароль; почта занята — 409; неверный код — 400; верный — новая почта и письмо на прежнюю", async () => {
    const w = world();
    const cookie = await register(w, ANN, PASSWORD, "ru");
    await register(w, "taken@example.com");
    const wrongPassword = await w.send("/api/account/email/request", {
      body: { newEmail: "new@example.com", password: "nope nope 1" },
      cookie,
    });
    expect([wrongPassword.status, wrongPassword.json?.code]).toEqual([
      401,
      "INVALID_PASSWORD",
    ]);
    const taken = await w.send("/api/account/email/request", {
      body: { newEmail: "taken@example.com", password: PASSWORD },
      cookie,
    });
    expect([taken.status, taken.json?.code]).toEqual([409, "EMAIL_TAKEN"]);
    const same = await w.send("/api/account/email/request", {
      body: { newEmail: ANN, password: PASSWORD },
      cookie,
    });
    expect([same.status, same.json?.code]).toEqual([400, "SAME_EMAIL"]);

    const ask = await w.send("/api/account/email/request", {
      body: { newEmail: " New@Example.com ", password: PASSWORD },
      cookie,
    });
    expect(ask.status).toBe(200);
    const letter = w.mail.at(-1);
    expect(letter?.to).toBe("new@example.com");
    // Язык — сохранённый у человека.
    expect(letter?.subject).toMatch(/^\d{6} — код для новой почты Iconavo$/);
    const code = w.codeFor("new@example.com");
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await w.send("/api/account/email/confirm", {
      body: { newEmail: "new@example.com", otp: wrong },
      cookie,
    });
    expect(bad.status).toBe(400);
    const ok = await w.send("/api/account/email/confirm", {
      body: { newEmail: "new@example.com", otp: code },
      cookie,
    });
    expect(ok.status).toBe(200);
    const fresh = cookieOf(ok.res) || cookie;
    const me = await w.send("/api/account/me", { cookie: fresh });
    expect(me.json?.email).toBe("new@example.com");
    const notice = w.mail.at(-1);
    expect(notice?.to).toBe(ANN);
    expect(notice?.subject).toBe("Почта аккаунта Iconavo изменена");
    expect(notice?.text).toContain("n***@example.com");
    expect(notice?.replyTo).toBe("support@iconavo.dev");
    // Прежней почтой войти нельзя, новой — можно.
    expect(
      (
        await w.send("/api/auth/sign-in/email", {
          body: { email: ANN, password: PASSWORD },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await w.send("/api/auth/sign-in/email", {
          body: { email: "new@example.com", password: PASSWORD },
        })
      ).status,
    ).toBe(200);
  });

  it("код уходит не чаще раза в минуту на одну почту", async () => {
    const { counter } = await import("./fake.testing.js");
    const w = world({ CODE_LIMIT: counter(1) });
    const cookie = await register(w, ANN);
    const ask = () =>
      w.send("/api/account/email/request", {
        body: { newEmail: "new@example.com", password: PASSWORD },
        cookie,
      });
    expect((await ask()).status).toBe(200);
    const again = await ask();
    expect([again.status, again.json?.code]).toEqual([429, "RATE_LIMITED"]);
  });
});

describe("пароль", () => {
  it("неверный текущий — 401 и счётчик; пять неверных — 429; верный — новый, другие сеансы закрыты, письмо", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const other = cookieOf(
      (
        await w.send("/api/auth/sign-in/email", {
          body: { email: ANN, password: PASSWORD },
        })
      ).res,
    );
    const short = await w.send("/api/account/password/change", {
      body: { currentPassword: PASSWORD, newPassword: "short" },
      cookie,
    });
    expect(short.status).toBe(400);
    for (let i = 0; i < 5; i++) {
      const r = await w.send("/api/account/password/change", {
        body: { currentPassword: "nope nope 1", newPassword: "brand new 2" },
        cookie,
      });
      expect([r.status, r.json?.code]).toEqual([401, "INVALID_PASSWORD"]);
    }
    const locked = await w.send("/api/account/password/change", {
      body: { currentPassword: PASSWORD, newPassword: "brand new 2" },
      cookie,
    });
    expect([locked.status, locked.json?.code]).toEqual([
      429,
      "TOO_MANY_ATTEMPTS",
    ]);
    w.clock.now += 16 * 60_000;
    const ok = await w.send("/api/account/password/change", {
      body: { currentPassword: PASSWORD, newPassword: "brand new 2" },
      cookie,
    });
    expect(ok.status).toBe(200);
    expect(w.mail.at(-1)?.subject).toBe(
      "The password of your Iconavo account was changed",
    );
    // Другой сеанс закрыт, а этот получил новую cookie.
    expect(
      (await w.send("/api/auth/get-session", { cookie: other })).json,
    ).toBeNull();
    const fresh = cookieOf(ok.res);
    expect(fresh).not.toBe("");
    expect((await w.send("/api/account/me", { cookie: fresh })).status).toBe(
      200,
    );
  });
});

/** Человек, у которого вход — только Google: строку пароля заменяем строкой Google. */
async function googleOnly(w: ReturnType<typeof world>, email: string) {
  const cookie = await register(w, email);
  const now = new Date().toISOString();
  await w.env.DB.batch([
    w.env.DB.prepare(
      `delete from "account" where "providerId" = 'credential' and "userId" = (select "id" from "user" where "email" = ?)`,
    ).bind(email),
    w.env.DB.prepare(
      `insert into "account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt") select 'g-' || "id", 'google-sub', 'google', "id", ?, ? from "user" where "email" = ?`,
    ).bind(now, now, email),
  ]);
  return cookie;
}

describe("Google и пароль для опасного", () => {
  it("без пароля: отключить Google, сменить почту, удалить — PASSWORD_REQUIRED (сначала пароль)", async () => {
    const w = world();
    const cookie = await googleOnly(w, ANN);
    const me = await w.send("/api/account/me", { cookie });
    expect(me.json).toMatchObject({ password: { set: false }, google: true });
    const off = await w.send("/api/account/google/disconnect", {
      body: {},
      cookie,
    });
    expect([off.status, off.json?.code]).toEqual([409, "PASSWORD_REQUIRED"]);
    const email = await w.send("/api/account/email/request", {
      body: { newEmail: "new@example.com" },
      cookie,
    });
    expect([email.status, email.json?.code]).toEqual([
      403,
      "PASSWORD_REQUIRED",
    ]);
    const gone = await w.send("/api/account/delete", {
      body: { email: ANN },
      cookie,
    });
    expect([gone.status, gone.json?.code]).toEqual([403, "PASSWORD_REQUIRED"]);
  });

  it("с паролем Google отключается; подключение — только со страниц сайта и с возвратом на них", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const now = new Date().toISOString();
    await w.env.DB.prepare(
      `insert into "account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt") select 'g-' || "id", 'google-sub', 'google', "id", ?, ? from "user" where "email" = ?`,
    )
      .bind(now, now, ANN)
      .run();
    const off = await w.send("/api/account/google/disconnect", {
      body: {},
      cookie,
    });
    expect(off.status).toBe(200);
    expect((await w.send("/api/account/me", { cookie })).json?.google).toBe(
      false,
    );
    const evil = await w.send("/api/auth/link-social", {
      body: { provider: "google", callbackURL: "https://evil.example/" },
      cookie,
    });
    expect([evil.status, evil.json?.code]).toEqual([
      400,
      "INVALID_CALLBACK_URL",
    ]);
    const other = await w.send("/api/auth/link-social", {
      body: { provider: "github", callbackURL: `${SITE}/account` },
      cookie,
    });
    expect([other.status, other.json?.code]).toEqual([
      400,
      "PROVIDER_NOT_FOUND",
    ]);
  });
});

describe("удаление аккаунта", () => {
  it("почта не совпала — 400; неверный пароль — 401; верно — всё сразу: строки, сеансы, фото", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    await upload(w, cookie, png(400));
    await upload(w, cookie, png(512));
    expect(w.files.objects.size).toBe(2);
    const mismatch = await w.send("/api/account/delete", {
      body: { email: "ann@example.co", password: PASSWORD },
      cookie,
    });
    expect([mismatch.status, mismatch.json?.code]).toEqual([
      400,
      "EMAIL_MISMATCH",
    ]);
    const wrong = await w.send("/api/account/delete", {
      body: { email: ANN, password: "nope nope 1" },
      cookie,
    });
    expect([wrong.status, wrong.json?.code]).toEqual([401, "INVALID_PASSWORD"]);
    const ok = await w.send("/api/account/delete", {
      body: { email: " ANN@example.com ", password: PASSWORD },
      cookie,
    });
    expect(ok.status).toBe(200);
    expect(w.files.objects.size).toBe(0);
    const count = async (table: string) =>
      (
        await w.env.DB.prepare(`select count(*) as "n" from "${table}"`).first<{
          n: number;
        }>()
      )?.n;
    expect(await count("user")).toBe(0);
    expect(await count("account")).toBe(0);
    expect(await count("session")).toBe(0);
    expect((await w.send("/api/account/me", { cookie })).status).toBe(401);
  });
});

describe("фото из Google при первом входе", () => {
  const setup = async () => {
    const w = world();
    await register(w, ANN);
    const id = (
      await w.env.DB.prepare(`select "id" from "user"`).first<{ id: string }>()
    )?.id as string;
    await w.env.DB.prepare(`update "user" set "image" = ? where "id" = ?`)
      .bind("https://lh3.googleusercontent.com/a/abc=s96-c", id)
      .run();
    return { w, id };
  };
  const user = async (w: ReturnType<typeof world>, id: string) =>
    w.env.DB.prepare(`select "image", "photo" from "user" where "id" = ?`)
      .bind(id)
      .first<{ image: string | null; photo: string | null }>();

  it("крупная копия у себя; ссылки на Google в базе нет", async () => {
    const { w, id } = await setup();
    const asked: string[] = [];
    const done = await copyGooglePhoto(
      w.env,
      id,
      "https://lh3.googleusercontent.com/a/abc=s96-c",
      {
        fetch: async (url) => {
          asked.push(url);
          return new Response(png(512), {
            headers: { "content-type": "image/png" },
          });
        },
        log: () => {},
        now: Date.now(),
      },
    );
    expect(done).toBe(true);
    expect(asked).toEqual(["https://lh3.googleusercontent.com/a/abc=s512-c"]);
    const row = await user(w, id);
    expect(row?.image).toBeNull();
    expect(row?.photo).toMatch(/^photos\/.+\.png$/);
    expect(w.files.objects.size).toBe(1);
  });

  it("чужой сервер или не картинка — фото нет, ссылка всё равно стёрта, наружу — ни запроса", async () => {
    const { w, id } = await setup();
    const asked: string[] = [];
    const deps = {
      fetch: async (url: string) => {
        asked.push(url);
        return new Response("<html>", {
          headers: { "content-type": "text/html" },
        });
      },
      log: () => {},
      now: Date.now(),
    };
    expect(
      await copyGooglePhoto(w.env, id, "https://evil.example/a.png", deps),
    ).toBe(false);
    expect(asked).toEqual([]);
    expect((await user(w, id))?.image).toBeNull();
    expect(
      await copyGooglePhoto(
        w.env,
        id,
        "https://lh3.googleusercontent.com/a/x",
        deps,
      ),
    ).toBe(false);
    expect((await user(w, id))?.photo).toBeNull();
    expect(
      biggerGooglePhoto("https://lh3.googleusercontent.com/a/x=s96-c"),
    ).toBe("https://lh3.googleusercontent.com/a/x=s512-c");
  });
});

describe("письма-уведомления", () => {
  it("почта скрыта наполовину; на двух языках; ответ — на support@", () => {
    expect(maskEmail("new.address@example.com")).toBe("n***@example.com");
    expect(maskEmail("bad")).toBe("***");
    const en = noticeMail(ANN, "password-changed", "en");
    expect(en.subject).toBe("The password of your Iconavo account was changed");
    expect(en.html).toContain('lang="en"');
    const ru = noticeMail(ANN, "email-changed", "ru", "new@example.com");
    expect(ru.text).toContain("n***@example.com");
    expect(ru.replyTo).toBe("support@iconavo.dev");
  });
});
