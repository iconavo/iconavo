// Обратная связь (шаг 3 фазы 5, PR 6а; кадры K2–K6 макета «Личный кабинет»): сообщение об ошибке со
// скриншотом, запрос иконок, запрос функции и отзыв со звёздами. Только вошедшим — пункты стоят в меню
// аккаунта: спам закрыт входом и пределом частоты, без Turnstile.
//
// Запись — в таблицу feedback (хранится год, cleanup.ts), скриншот — в закрытый бакет фото, письмо — на
// support@iconavo.dev (Email Routing пересылает его владельцу) со скриншотом вложением; Reply-To — почта
// человека, ответ уходит ему напрямую. Письмо не ушло — запись и скриншот удаляются, а человек видит ошибку
// и повторит: иначе отзыв лежал бы в базе, а владелец о нём не узнал бы.

import type { D1Like } from "@iconavo-ui/d1";
import type { Auth } from "./auth.js";
import { localeOf } from "./auth.js";
import { ACCOUNT_PATH, FEEDBACK, MAIL_FROM, SITE_ORIGIN } from "./config.js";
import type { Env, MailMessage } from "./env.js";
import { failure, json } from "./http.js";
import { type ImageInfo, imageInfo } from "./image.js";
import { sendMail } from "./mail.js";
import { deleteObjects } from "./photos.js";
import { type SessionUser, sessionUser, unauthorized } from "./session.js";

export const FEEDBACK_PATH = `${ACCOUNT_PATH}/feedback`;

export const FEEDBACK_KINDS = ["bug", "icons", "feature", "feedback"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Поля формы — строки; скриншот — файл SCREENSHOT_FIELD. */
export const FEEDBACK_FIELDS = [
  "kind",
  "text",
  "icons",
  "family",
  "use",
  "feature",
  "why",
  "rating",
  "page",
  "browser",
] as const;
export const SCREENSHOT_FIELD = "screenshot";

export interface Feedback {
  kind: FeedbackKind;
  /** Поля вида без пустых: text, icons, family, use, feature, why. */
  fields: Record<string, string>;
  rating: number | null;
  /** Страница и браузер — только у ошибки: «We attach the page address and your browser version». */
  page: string | null;
  browser: string | null;
}

const SET_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Текст поля: без служебных знаков (кроме перевода строки и табуляции), пробелы по краям убраны. Не строка —
 * пусто; длиннее предела — undefined.
 */
export function textOf(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return "";
  const text = [...value.replace(/\r\n?/g, "\n")]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code === 0x0a || code === 0x09 || (code >= 0x20 && code !== 0x7f);
    })
    .join("")
    .trim();
  return [...text].length > max ? undefined : text;
}

/** Разобрать форму; ошибка — код для сайта. */
export function parseFeedback(
  body: Record<string, unknown>,
  site: string,
): Feedback | { error: string } {
  const kind = String(body.kind ?? "");
  if (!(FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    return { error: "INVALID_KIND" };
  }
  const fields: Record<string, string> = {};
  const take = (name: string, max: number): string | undefined => {
    const value = textOf(body[name], max);
    if (value !== undefined && value !== "") fields[name] = value;
    return value;
  };
  const long = (name: string) => take(name, FEEDBACK.textMax);
  const short = (name: string) => take(name, FEEDBACK.shortMax);
  let rating: number | null = null;
  let page: string | null = null;
  let browser: string | null = null;
  switch (kind as FeedbackKind) {
    case "bug": {
      const text = long("text");
      if (text === undefined) return { error: "TOO_LONG" };
      if (text === "") return { error: "TEXT_REQUIRED" };
      const where = textOf(body.page, FEEDBACK.shortMax);
      const agent = textOf(body.browser, FEEDBACK.shortMax);
      if (where === undefined || agent === undefined) {
        return { error: "TOO_LONG" };
      }
      // Страница — только сайта: чужой адрес в письме владельцу не нужен.
      if (where !== "" && where !== site && !where.startsWith(`${site}/`)) {
        return { error: "INVALID_PAGE" };
      }
      page = where === "" ? null : where;
      browser = agent === "" ? null : agent;
      break;
    }
    case "icons": {
      const icons = short("icons");
      const family = short("family");
      const use = long("use");
      if (icons === undefined || family === undefined || use === undefined) {
        return { error: "TOO_LONG" };
      }
      if (icons === "") return { error: "ICONS_REQUIRED" };
      if (family !== "" && !SET_NAME.test(family)) {
        return { error: "INVALID_FAMILY" };
      }
      break;
    }
    case "feature": {
      const feature = short("feature");
      const why = long("why");
      if (feature === undefined || why === undefined) {
        return { error: "TOO_LONG" };
      }
      if (feature === "") return { error: "FEATURE_REQUIRED" };
      break;
    }
    default: {
      const value = Number(body.rating);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        return { error: "RATING_REQUIRED" };
      }
      rating = value;
      if (long("text") === undefined) return { error: "TOO_LONG" };
    }
  }
  return { kind: kind as FeedbackKind, fields, rating, page, browser };
}

const MESSAGES: Record<string, string> = {
  INVALID_KIND: "Unknown kind of message",
  TOO_LONG: "A field is too long",
  TEXT_REQUIRED: "Describe the problem",
  ICONS_REQUIRED: "Name the icons you need",
  FEATURE_REQUIRED: "Describe the feature",
  RATING_REQUIRED: "Choose a rating from 1 to 5",
  INVALID_FAMILY: "Unknown icon set",
  INVALID_PAGE: "The page must be on the site",
};

const TITLES: Record<FeedbackKind, string> = {
  bug: "Ошибка на сайте",
  icons: "Запрос иконок",
  feature: "Запрос функции",
  feedback: "Отзыв",
};

const TAGS: Record<FeedbackKind, string> = {
  bug: "Ошибка",
  icons: "Иконки",
  feature: "Функция",
  feedback: "Отзыв",
};

/** ★★★★☆ */
export const stars = (rating: number): string =>
  "★".repeat(rating) + "☆".repeat(5 - rating);

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Начало строки для темы письма: одна строка, не длиннее n знаков. */
function clip(text: string, n: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = [...line];
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : line;
}

export interface Screenshot {
  bytes: Uint8Array;
  info: ImageInfo;
}

/**
 * Письмо владельцу на support@ (по-русски: его читает владелец). Тема — вид и начало текста; Reply-To —
 * почта человека; скриншот — вложением.
 */
export function feedbackMail(
  user: Pick<SessionUser, "email" | "name"> & { locale: string },
  f: Feedback,
  screenshot?: Screenshot,
): MailMessage {
  const main =
    f.kind === "icons"
      ? (f.fields.icons ?? "")
      : f.kind === "feature"
        ? (f.fields.feature ?? "")
        : (f.fields.text ?? "");
  const tag =
    f.kind === "feedback" && f.rating !== null
      ? `${TAGS.feedback} ${stars(f.rating)}`
      : TAGS[f.kind];
  const subject = `[${tag}] ${clip(main, 70) || "без текста"}`;
  const who = user.name === "" ? user.email : `${user.name} <${user.email}>`;
  const lines: [string, string][] = [["От", `${who}, язык: ${user.locale}`]];
  if (f.page !== null) lines.push(["Страница", f.page]);
  if (f.browser !== null) lines.push(["Браузер", f.browser]);
  if (f.kind === "icons") {
    lines.push(["Какие иконки", f.fields.icons ?? ""]);
    lines.push(["Набор", f.fields.family ?? "любой"]);
  }
  if (f.kind === "feature") lines.push(["Функция", f.fields.feature ?? ""]);
  if (f.rating !== null) {
    lines.push(["Оценка", `${stars(f.rating)} (${f.rating} из 5)`]);
  }
  if (screenshot !== undefined) {
    lines.push([
      "Скриншот",
      `во вложении, ${screenshot.info.width} × ${screenshot.info.height}`,
    ]);
  }
  const long =
    f.kind === "icons"
      ? f.fields.use
      : f.kind === "feature"
        ? f.fields.why
        : f.fields.text;
  const longTitle =
    f.kind === "icons" || f.kind === "feature" ? "Зачем" : "Текст";
  const footer = "Ответьте на это письмо — ответ уйдёт человеку.";
  const text = [
    TITLES[f.kind],
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    ...(long === undefined ? [] : ["", `${longTitle}:`, long]),
    "",
    footer,
  ].join("\n");
  const row = ([k, v]: [string, string]) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#555555;vertical-align:top">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`;
  const html = `<!doctype html>
<html lang="ru">
<body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto">
<p style="margin:0 0 24px;font-size:16px;font-weight:600">Iconavo</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600">${esc(TITLES[f.kind])}</h1>
<table style="border-collapse:collapse;font-size:14px;line-height:20px;margin:0 0 16px">${lines.map(row).join("")}</table>
${long === undefined ? "" : `<p style="margin:0 0 4px;font-size:14px;color:#555555">${esc(longTitle)}</p>\n<p style="margin:0 0 16px;font-size:15px;line-height:24px;white-space:pre-wrap">${esc(long)}</p>`}
<p style="margin:0;font-size:14px;line-height:20px;color:#555555">${esc(footer)}</p>
</div>
</body>
</html>`;
  return {
    from: { ...MAIL_FROM },
    to: MAIL_FROM.email,
    subject,
    html,
    text,
    replyTo: user.email,
    ...(screenshot === undefined
      ? {}
      : {
          attachments: [
            {
              content: screenshot.bytes,
              filename: `screenshot.${screenshot.info.ext}`,
              type: screenshot.info.type,
              disposition: "attachment" as const,
            },
          ],
        }),
  };
}

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Ключ скриншота в бакете: у каждого — своя папка, имя случайное. */
export const screenshotKey = (userId: string, ext: string): string =>
  `feedback/${userId}/${hex(crypto.getRandomValues(new Uint8Array(16)))}.${ext}`;

/** Сколько секунд ждать, если предел частоты исчерпан; 0 — можно. */
export async function feedbackWait(
  db: D1Like,
  userId: string,
  now: number,
): Promise<number> {
  const { results } = await db
    .prepare(
      `select "createdAt" from "feedback" where "userId" = ? and "createdAt" > ? order by "createdAt"`,
    )
    .bind(userId, now - 86_400_000)
    .all<{ createdAt: number }>();
  const day = results.map((r) => r.createdAt);
  const recent = day.filter((t) => t > now - FEEDBACK.windowMs);
  const waits: number[] = [];
  if (day.length >= FEEDBACK.perDay) {
    waits.push((day[day.length - FEEDBACK.perDay] ?? now) + 86_400_000 - now);
  }
  if (recent.length >= FEEDBACK.perWindow) {
    waits.push(
      (recent[recent.length - FEEDBACK.perWindow] ?? now) +
        FEEDBACK.windowMs -
        now,
    );
  }
  return waits.length === 0
    ? 0
    : Math.max(1, Math.ceil(Math.max(...waits) / 1000));
}

/** Скриншоты человека — их удаляет сервис вместе с аккаунтом. */
export async function feedbackShots(
  db: D1Like,
  userId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `select "screenshot" from "feedback" where "userId" = ? and "screenshot" is not null`,
    )
    .bind(userId)
    .all<{ screenshot: string }>();
  return results.map((r) => r.screenshot);
}

export interface FeedbackDeps {
  now: number;
  log(line: string): void;
}

/** POST /api/account/feedback — форма: поля FEEDBACK_FIELDS и необязательный скриншот (только у ошибки). */
export async function handleFeedback(
  request: Request,
  body: Record<string, unknown>,
  file: Uint8Array | undefined,
  env: Env,
  auth: Auth,
  deps: FeedbackDeps,
): Promise<Response> {
  const user = await sessionUser(request, auth);
  if (user === undefined) return unauthorized();
  const parsed = parseFeedback(body, env.SITE_ORIGIN ?? SITE_ORIGIN);
  if ("error" in parsed) {
    return failure(400, parsed.error, MESSAGES[parsed.error] ?? "Bad request");
  }
  let screenshot: Screenshot | undefined;
  if (file !== undefined && file.byteLength > 0) {
    if (parsed.kind !== "bug") {
      return failure(
        400,
        "SCREENSHOT_NOT_ALLOWED",
        "Only a bug report takes a screenshot",
      );
    }
    const info = imageInfo(file);
    if (info === undefined) {
      return failure(415, "UNSUPPORTED_IMAGE", "Send a PNG or JPEG image");
    }
    screenshot = { bytes: file, info };
  }
  const wait = await feedbackWait(env.DB, user.id, deps.now);
  if (wait > 0) {
    return failure(429, "TOO_MANY_MESSAGES", "Too many messages, wait a bit", {
      "retry-after": String(wait),
    });
  }
  let key: string | null = null;
  if (screenshot !== undefined) {
    if (env.FILES === undefined) {
      return failure(503, "STORAGE_UNAVAILABLE", "Screenshots are unavailable");
    }
    key = screenshotKey(user.id, screenshot.info.ext);
    await env.FILES.put(key, screenshot.bytes, {
      httpMetadata: { contentType: screenshot.info.type },
    });
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `insert into "feedback" ("id", "userId", "kind", "body", "rating", "page", "browser", "screenshot", "createdAt") values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      parsed.kind,
      JSON.stringify(parsed.fields),
      parsed.rating,
      parsed.page,
      parsed.browser,
      key,
      deps.now,
    )
    .run();
  const sent = await sendMail(
    env.EMAIL,
    feedbackMail(
      {
        email: user.email,
        name: user.name,
        locale: localeOf(String(user.locale ?? "")),
      },
      parsed,
      screenshot,
    ),
    deps.log,
  );
  if (!sent) {
    await env.DB.prepare(`delete from "feedback" where "id" = ?`)
      .bind(id)
      .run();
    await deleteObjects(env.FILES, [key]);
    return failure(503, "SEND_FAILED", "Couldn’t send, try again");
  }
  return json({ ok: true });
}
