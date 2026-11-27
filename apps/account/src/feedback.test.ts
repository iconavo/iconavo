import { describe, expect, it } from "vitest";
import { cleanup } from "./cleanup.js";
import { FEEDBACK } from "./config.js";
import { register, SITE, world } from "./fake.testing.js";
import {
  FEEDBACK_PATH,
  feedbackMail,
  parseFeedback,
  stars,
  textOf,
} from "./feedback.js";

const ANN = "ann@example.com";
const PASSWORD = "correct horse 1";

/** PNG: подпись и заголовок IHDR нужного размера. */
function png(width: number, height = width): Uint8Array {
  const b = new Uint8Array(33 + 64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(b.buffer);
  view.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

/** Форма обратной связи: поля и необязательный скриншот. */
function form(
  fields: Record<string, string>,
  screenshot?: { bytes: Uint8Array; type?: string },
): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (screenshot !== undefined) {
    f.set(
      "screenshot",
      new Blob([screenshot.bytes], { type: screenshot.type ?? "image/png" }),
      "shot.png",
    );
  }
  return f;
}

describe("разбор формы", () => {
  it("каждый вид — свои обязательные поля; лишнее и пустое отбрасываются", () => {
    expect(parseFeedback({ kind: "bug", text: "  " }, SITE)).toEqual({
      error: "TEXT_REQUIRED",
    });
    expect(parseFeedback({ kind: "icons" }, SITE)).toEqual({
      error: "ICONS_REQUIRED",
    });
    expect(parseFeedback({ kind: "feature", why: "x" }, SITE)).toEqual({
      error: "FEATURE_REQUIRED",
    });
    expect(parseFeedback({ kind: "feedback", rating: "6" }, SITE)).toEqual({
      error: "RATING_REQUIRED",
    });
    expect(parseFeedback({ kind: "spam" }, SITE)).toEqual({
      error: "INVALID_KIND",
    });
    expect(
      parseFeedback(
        { kind: "icons", icons: "whisk", family: "Lucide!", use: "" },
        SITE,
      ),
    ).toEqual({ error: "INVALID_FAMILY" });
    expect(
      parseFeedback(
        {
          kind: "bug",
          text: "Copy does nothing",
          page: `${SITE}/lucide?icon=lucide:house`,
          browser: "Safari 18 · macOS",
          icons: "лишнее",
        },
        SITE,
      ),
    ).toEqual({
      kind: "bug",
      fields: { text: "Copy does nothing" },
      rating: null,
      page: `${SITE}/lucide?icon=lucide:house`,
      browser: "Safari 18 · macOS",
    });
    expect(
      parseFeedback({ kind: "feedback", rating: "4", text: "" }, SITE),
    ).toEqual({
      kind: "feedback",
      fields: {},
      rating: 4,
      page: null,
      browser: null,
    });
  });

  it("страница — только сайта; длинное — ошибка; служебные знаки — прочь, переводы строк — нет", () => {
    expect(
      parseFeedback(
        { kind: "bug", text: "x", page: "https://evil.example/" },
        SITE,
      ),
    ).toEqual({ error: "INVALID_PAGE" });
    expect(
      parseFeedback(
        { kind: "bug", text: "x".repeat(FEEDBACK.textMax + 1) },
        SITE,
      ),
    ).toEqual({ error: "TOO_LONG" });
    expect(textOf("a\u0000b\r\nc\u0007", 10)).toBe("ab\nc");
    expect(textOf(42, 10)).toBe("");
    expect(textOf("абв", 2)).toBeUndefined();
  });

  it("письмо владельцу: тема — вид и начало текста, Reply-To — человек, скриншот вложением", () => {
    const shot = {
      bytes: png(800, 600),
      info: {
        type: "image/png" as const,
        ext: "png" as const,
        width: 800,
        height: 600,
      },
    };
    const bug = feedbackMail(
      { email: ANN, name: "Ann <Lee>", locale: "ru" },
      {
        kind: "bug",
        fields: { text: "Copy SVG\nничего не делает в Safari" },
        rating: null,
        page: `${SITE}/lucide`,
        browser: "Safari 18 · macOS",
      },
      shot,
    );
    expect(bug.to).toBe("support@iconavo.dev");
    expect(bug.replyTo).toBe(ANN);
    expect(bug.subject).toBe("[Ошибка] Copy SVG ничего не делает в Safari");
    expect(bug.text).toContain(`Страница: ${SITE}/lucide`);
    expect(bug.text).toContain("Браузер: Safari 18 · macOS");
    expect(bug.html).toContain("Ann &lt;Lee&gt;");
    expect(bug.html).not.toContain("<Lee>");
    expect(bug.attachments).toEqual([
      {
        content: shot.bytes,
        filename: "screenshot.png",
        type: "image/png",
        disposition: "attachment",
      },
    ]);
    const review = feedbackMail(
      { email: ANN, name: "", locale: "en" },
      { kind: "feedback", fields: {}, rating: 4, page: null, browser: null },
    );
    expect(review.subject).toBe(`[Отзыв ${stars(4)}] без текста`);
    expect(review.attachments).toBeUndefined();
    expect(stars(4)).toBe("★★★★☆");
  });
});

describe("POST /api/account/feedback", () => {
  it("без входа — 401; не форма — 415", async () => {
    const w = world();
    const guest = await w.send(FEEDBACK_PATH, {
      form: form({ kind: "feedback", rating: "5" }),
    });
    expect(guest.status).toBe(401);
    const cookie = await register(w, ANN);
    const asJson = await w.send(FEEDBACK_PATH, {
      body: { kind: "feedback", rating: 5 },
      cookie,
    });
    expect(asJson.status).toBe(415);
  });

  it("ошибка со скриншотом: запись, файл в бакете, письмо на support@ с вложением и ответом человеку", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const before = w.mail.length;
    const sent = await w.send(FEEDBACK_PATH, {
      form: form(
        {
          kind: "bug",
          text: "The Copy SVG button does nothing",
          page: `${SITE}/lucide`,
          browser: "Chrome 131 · Windows",
        },
        { bytes: png(1280, 720) },
      ),
      cookie,
    });
    expect(sent.status).toBe(200);
    const letter = w.mail.at(-1);
    expect(w.mail.length).toBe(before + 1);
    expect(letter?.to).toBe("support@iconavo.dev");
    expect(letter?.replyTo).toBe(ANN);
    expect(letter?.subject).toBe("[Ошибка] The Copy SVG button does nothing");
    expect(letter?.attachments?.[0]?.filename).toBe("screenshot.png");
    expect(letter?.text).toContain("1280 × 720");
    const row = await w.env.DB.prepare(
      `select "kind", "screenshot", "page" from "feedback"`,
    ).first<{ kind: string; screenshot: string; page: string }>();
    expect(row?.kind).toBe("bug");
    expect(row?.page).toBe(`${SITE}/lucide`);
    expect(row?.screenshot).toMatch(/^feedback\/[^/]+\/[0-9a-f]{32}\.png$/);
    expect([...w.files.objects.keys()]).toContain(row?.screenshot);
  });

  it("скриншот — только PNG или JPEG и только у ошибки; больше 5 МБ — 413", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const gif = await w.send(FEEDBACK_PATH, {
      form: form(
        { kind: "bug", text: "x" },
        { bytes: new TextEncoder().encode("GIF89a……"), type: "image/gif" },
      ),
      cookie,
    });
    expect([gif.status, gif.json?.code]).toEqual([415, "UNSUPPORTED_IMAGE"]);
    const notBug = await w.send(FEEDBACK_PATH, {
      form: form({ kind: "feedback", rating: "5" }, { bytes: png(100) }),
      cookie,
    });
    expect([notBug.status, notBug.json?.code]).toEqual([
      400,
      "SCREENSHOT_NOT_ALLOWED",
    ]);
    const big = new Uint8Array(FEEDBACK.maxBytes + 1);
    big.set(png(4000));
    const huge = await w.send(FEEDBACK_PATH, {
      form: form({ kind: "bug", text: "x" }, { bytes: big }),
      cookie,
    });
    expect(huge.status).toBe(413);
    expect(w.mail.filter((m) => m.to === "support@iconavo.dev")).toEqual([]);
  });

  it("запрос иконок, функции и отзыв: поля вида — в письме; пять за 10 минут, дальше — 429", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    const kinds = [
      {
        kind: "icons",
        icons: "chef hat, whisk",
        family: "lucide",
        use: "A recipe app",
      },
      { kind: "feature", feature: "Export to Figma", why: "We keep a library" },
      { kind: "feedback", rating: "4", text: "Search is great" },
      { kind: "icons", icons: "rocket" },
      { kind: "feedback", rating: "5" },
    ];
    for (const fields of kinds) {
      const r = await w.send(FEEDBACK_PATH, { form: form(fields), cookie });
      expect(r.status).toBe(200);
    }
    const subjects = w.mail
      .filter((m) => m.to === "support@iconavo.dev")
      .map((m) => m.subject);
    expect(subjects).toEqual([
      "[Иконки] chef hat, whisk",
      "[Функция] Export to Figma",
      "[Отзыв ★★★★☆] Search is great",
      "[Иконки] rocket",
      "[Отзыв ★★★★★] без текста",
    ]);
    expect(w.mail.at(-5)?.text).toContain("Набор: lucide");
    expect(w.mail.at(-2)?.text).toContain("Набор: любой");
    const sixth = await w.send(FEEDBACK_PATH, {
      form: form({ kind: "feedback", rating: "3" }),
      cookie,
    });
    expect([sixth.status, sixth.json?.code]).toEqual([
      429,
      "TOO_MANY_MESSAGES",
    ]);
    expect(Number(sixth.res.headers.get("retry-after"))).toBeGreaterThan(0);
    w.clock.now += FEEDBACK.windowMs + 1;
    const later = await w.send(FEEDBACK_PATH, {
      form: form({ kind: "feedback", rating: "3" }),
      cookie,
    });
    expect(later.status).toBe(200);
  });

  it("письмо не ушло — записи и скриншота нет, ответ 503, в журнале — только код ошибки", async () => {
    const w = world();
    const cookie = await register(w, ANN);
    w.env.EMAIL = {
      send: async () => {
        throw Object.assign(new Error(`down for ${ANN}`), {
          code: "E_DELIVERY_FAILED",
        });
      },
    };
    const r = await w.send(FEEDBACK_PATH, {
      form: form({ kind: "bug", text: "x" }, { bytes: png(300) }),
      cookie,
    });
    expect([r.status, r.json?.code]).toEqual([503, "SEND_FAILED"]);
    const n = await w.env.DB.prepare(
      `select count(*) as n from "feedback"`,
    ).first<{ n: number }>();
    expect(n?.n).toBe(0);
    expect(
      [...w.files.objects.keys()].filter((k) => k.startsWith("feedback/")),
    ).toEqual([]);
    expect(w.logs.join(" ")).toContain("E_DELIVERY_FAILED");
    expect(w.logs.join(" ")).not.toContain(ANN);
  });

  it("удалил аккаунт — отзывы и скриншоты удалены сразу; уборка удаляет отзывы старше года", async () => {
    const w = world();
    const ann = await register(w, ANN);
    await w.send(FEEDBACK_PATH, {
      form: form({ kind: "bug", text: "x" }, { bytes: png(300) }),
      cookie: ann,
    });
    const bob = await register(w, "bob@example.com");
    await w.send(FEEDBACK_PATH, {
      form: form({ kind: "bug", text: "y" }, { bytes: png(300) }),
      cookie: bob,
    });
    expect(
      [...w.files.objects.keys()].filter((k) => k.startsWith("feedback/")),
    ).toHaveLength(2);
    const gone = await w.send("/api/account/delete", {
      body: { email: ANN, password: PASSWORD },
      cookie: ann,
    });
    expect(gone.status).toBe(200);
    const left = await w.env.DB.prepare(
      `select count(*) as n from "feedback"`,
    ).first<{ n: number }>();
    expect(left?.n).toBe(1);
    expect(
      [...w.files.objects.keys()].filter((k) => k.startsWith("feedback/")),
    ).toHaveLength(1);
    const result = await cleanup(
      w.env.DB,
      w.clock.now + FEEDBACK.keepMs + 1,
      w.files,
    );
    expect(result.feedback).toBe(1);
    expect(
      [...w.files.objects.keys()].filter((k) => k.startsWith("feedback/")),
    ).toEqual([]);
  });
});
