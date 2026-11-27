// Превью сервиса аккаунтов (шаг 3 фазы 5, ADR-0055): ровно бандл dist-account/worker.js в Node на 127.0.0.1.
// База — подделка D1 с её пределами поверх node:sqlite в памяти, бакет фото и письма — в памяти превью, Turnstile —
// свой адрес превью: он принимает только ответ тестового виджета Cloudflare (XXXX.DUMMY.TOKEN.XXXX).
// Google — без ключей, вход через него в превью выключен; проверка сайта включает подставной (google).
// Host сверяется, как у других превью.
//
// - /__preview/mail — письма по порядку: тема, кому, текст и само письмо в рамке;
// - /__preview/mail.json — те же письма для проверок (коды);
// - /__preview/turnstile.js — подставной скрипт Turnstile для сайта (проверка сайта, pnpm site --account);
// - остальное отвечает функция; несколько Set-Cookie доходят до браузера по отдельности;
// - файл фото (/api/account/photo/…) — с `Cross-Origin-Resource-Policy: cross-origin` вместо `same-site`:
//   Chrome считает 127.0.0.1 с разными портами разными сайтами и не показывает фото на странице превью
//   сайта, а iconavo.dev и account.iconavo.dev — один сайт (шаг 3 фазы 5, PR 4).

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { D1Like } from "@iconavo-ui/d1";
import { sqliteD1 } from "@iconavo-ui/d1/sqlite";
import { WORKER_FILE } from "../api/config.js";
import { allowedHost } from "../api/local.js";
import { esc } from "../report/html.js";
import { buildAccount } from "./build.js";
import { PREVIEW_GOOGLE_CLIENT } from "./config.js";

/** Ответ тестового виджета Turnstile (ключ сайта 1x00000000000000000000AA). */
export const PREVIEW_CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

/** CORP файла фото в превью (порты 127.0.0.1 для Chrome — разные сайты). */
export const PREVIEW_PHOTO_CORP = "cross-origin";

/** Адрес — файл фото, который сервис отдаёт хозяину. */
const photoFile = (url: string | undefined): boolean =>
  (url ?? "").startsWith("/api/account/photo/");

/** Страница сайта по умолчанию — превью сайта (pnpm site). */
export const PREVIEW_SITE = "http://127.0.0.1:4284";

export interface PreviewMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  /** Вложения — имя, тип и размер (скриншот обратной связи, PR 6а). */
  attachments?: { filename: string; type: string; size: number }[];
}

/** Письмо, как его отдаёт функция привязке send_email. */
interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: {
    filename: string;
    type: string;
    content: Uint8Array | ArrayBuffer | string;
  }[];
}

/** Размер вложения: байты или base64. */
const sizeOf = (c: Uint8Array | ArrayBuffer | string): number =>
  typeof c === "string" ? Math.floor((c.length * 3) / 4) : c.byteLength;

interface WorkerModule {
  default: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
    scheduled(controller: unknown, env: unknown): Promise<void>;
  };
}

export interface AccountPreviewOptions {
  root: string;
  /** dist-account/ — сюда пересобирается функция. */
  outDir: string;
  /** 0 — любой свободный. */
  port: number;
  /** Страница, которой сервис отвечает с cookie; проверка сайта даёт свою. */
  siteOrigin?: string;
  /** Пройти регистрацию и восстановление на двух языках — четыре письма для глаз. */
  samples?: boolean;
  /**
   * Подставной Google — ключ PREVIEW_GOOGLE_CLIENT: сервис собирает адрес Google, а проверка сайта
   * перехватывает переход к нему и возвращается с ответом Google. Без него вход через Google выключен.
   */
  google?: boolean;
  log?: (line: string) => void;
}

/**
 * Подставной скрипт Turnstile для сайта (проверка сайта и pnpm site --account): тот же вызов render, что у
 * Cloudflare, но без сети — сразу ответ тестового виджета, его и принимает превью. Каждый виджет оставляет
 * в контейнере скрытую метку, число виджетов — window.__previewTurnstile.
 */
export const PREVIEW_TURNSTILE_SCRIPT = `(() => {
  let next = 0;
  const marks = new Map();
  window.turnstile = {
    render(container, params) {
      const id = "preview-" + ++next;
      const mark = document.createElement("span");
      mark.hidden = true;
      mark.dataset.previewTurnstile = id;
      container.append(mark);
      marks.set(id, mark);
      window.__previewTurnstile = (window.__previewTurnstile || 0) + 1;
      setTimeout(() => params.callback?.(${JSON.stringify("XXXX.DUMMY.TOKEN.XXXX")}), 50);
      return id;
    },
    remove(id) {
      marks.get(id)?.remove();
      marks.delete(id);
    },
    reset() {},
    getResponse() {
      return ${JSON.stringify("XXXX.DUMMY.TOKEN.XXXX")};
    },
  };
})();
`;

export interface AccountPreview {
  server: Server;
  port: number;
  origin: string;
  build: string;
  mail(): readonly PreviewMail[];
  db(): D1Like;
  /** Файлы бакета фото превью: ключи. */
  files(): string[];
  close(): Promise<void>;
}

async function body(
  req: IncomingMessage,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

function mailPage(mail: readonly PreviewMail[]): string {
  const items = mail
    .map(
      (m, i) => `<section>
<h2>${i + 1}. ${esc(m.subject)}</h2>
<p class="muted">Кому: ${esc(m.to)}${m.replyTo === undefined ? "" : `, ответ — ${esc(m.replyTo)}`}${m.attachments === undefined ? "" : `; вложения: ${m.attachments.map((a) => `${esc(a.filename)} (${esc(a.type)}, ${a.size} байт)`).join(", ")}`}</p>
<iframe sandbox title="${esc(m.subject)}" src="/__preview/mail/${i + 1}.html"></iframe>
<pre>${esc(m.text)}</pre>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Письма сервиса аккаунтов</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0 auto; max-width: 760px; padding: 24px 16px 64px; font: 15px/1.5 system-ui, sans-serif; }
iframe { width: 100%; height: 360px; border: 1px solid #ccc; border-radius: 8px; background: #fff; }
pre { white-space: pre-wrap; font-size: 13px; } .muted { opacity: 0.7; }
</style>
</head>
<body>
<h1>Письма сервиса аккаунтов</h1>
<p>Превью: письма не уходят, они собираются здесь по порядку. ${mail.length === 0 ? "Писем пока нет." : `Писем: ${mail.length}.`}</p>
${items}
</body>
</html>
`;
}

/** Бакет фото превью — в памяти, как R2 для функции: put, get, delete. */
function memoryFiles() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  return {
    objects,
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      const bytes =
        value instanceof Uint8Array ? value.slice() : new Uint8Array(value);
      const type = options?.httpMetadata?.contentType;
      objects.set(key, { bytes, ...(type === undefined ? {} : { type }) });
      return {};
    },
    async get(key: string) {
      const o = objects.get(key);
      if (o === undefined) return null;
      return {
        body: new Blob([new Uint8Array(o.bytes)]).stream(),
        size: o.bytes.byteLength,
        ...(o.type === undefined
          ? {}
          : { httpMetadata: { contentType: o.type } }),
      };
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys])
        objects.delete(key);
    },
  };
}

/** Каждый запуск пересобирает функцию: превью показывает ровно то, что уйдёт в Cloudflare. */
export async function startAccountPreview(
  o: AccountPreviewOptions,
): Promise<AccountPreview> {
  const built = await buildAccount({ root: o.root, outDir: o.outDir });
  const worker = (
    (await import(
      pathToFileURL(join(o.outDir, WORKER_FILE)).href
    )) as WorkerModule
  ).default;
  const { DatabaseSync } = await import("node:sqlite");
  const db = sqliteD1(new DatabaseSync(":memory:"));
  const mail: PreviewMail[] = [];
  const files = memoryFiles();
  const site = o.siteOrigin ?? PREVIEW_SITE;
  let port = o.port;
  const origin = () => `http://127.0.0.1:${port}`;
  const env = () => ({
    DB: db,
    FILES: files,
    EMAIL: {
      send: async (m: SentMail) => {
        mail.push({
          to: m.to,
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(m.replyTo === undefined ? {} : { replyTo: m.replyTo }),
          ...(m.attachments === undefined
            ? {}
            : {
                attachments: m.attachments.map((a) => ({
                  filename: a.filename,
                  type: a.type,
                  size: sizeOf(a.content),
                })),
              }),
        });
        return { messageId: String(mail.length) };
      },
    },
    // Ключ подписи — свой у каждого запуска: cookie прошлых запусков недействительны.
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    TURNSTILE_SECRET_KEY: "preview",
    TURNSTILE_VERIFY_URL: `${origin()}/__preview/turnstile`,
    SITE_ORIGIN: site,
    SERVICE_ORIGIN: origin(),
    COOKIE_MODE: "plain",
    ACCOUNT_ACCESS: "open",
    ...(o.google
      ? {
          GOOGLE_CLIENT_ID: PREVIEW_GOOGLE_CLIENT,
          GOOGLE_CLIENT_SECRET: "preview",
        }
      : {}),
  });
  let fixedEnv: ReturnType<typeof env> | undefined;
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      promise.catch(() => {});
    },
  };

  async function reply(req: IncomingMessage): Promise<Response> {
    if (!allowedHost(req.headers.host, port)) {
      return new Response("Превью открывается только по адресу 127.0.0.1", {
        status: 403,
      });
    }
    const url = new URL(req.url ?? "/", origin());
    if (url.pathname === "/__preview/turnstile") {
      // Функция шлёт FormData — разбирает его сам Request, как в Workers.
      const form = await new Request(url, {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] ?? "" },
        body: (await body(req)) ?? new Uint8Array(new ArrayBuffer(0)),
      }).formData();
      const raw = form.get("response");
      return Response.json({
        success: raw === PREVIEW_CAPTCHA,
        hostname: new URL(site).hostname,
      });
    }
    if (url.pathname === "/__preview/turnstile.js") {
      return new Response(PREVIEW_TURNSTILE_SCRIPT, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    if (url.pathname === "/__preview/mail.json") return Response.json(mail);
    if (url.pathname === "/__preview/mail") {
      return new Response(mailPage(mail), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const one = /^\/__preview\/mail\/(\d+)\.html$/.exec(url.pathname);
    if (one !== null) {
      const m = mail[Number(one[1]) - 1];
      return m === undefined
        ? new Response("Нет такого письма", { status: 404 })
        : new Response(m.html, {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy":
                "default-src 'none'; style-src 'unsafe-inline'",
            },
          });
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const data = await body(req);
    return worker.fetch(
      new Request(url, {
        method: req.method ?? "GET",
        headers,
        ...(data === undefined ? {} : { body: data }),
      }),
      fixedEnv,
      ctx,
    );
  }

  const server = createServer((req, res) => {
    reply(req)
      .catch(
        (e: Error) => new Response(`Ошибка: ${e.message}`, { status: 500 }),
      )
      .then(async (r) => {
        const headers: [string, string][] = [];
        r.headers.forEach((value, name) => {
          if (name === "set-cookie") return;
          headers.push([
            name,
            photoFile(req.url) && name === "cross-origin-resource-policy"
              ? PREVIEW_PHOTO_CORP
              : value,
          ]);
        });
        for (const cookie of r.headers.getSetCookie()) {
          headers.push(["set-cookie", cookie]);
        }
        res.writeHead(r.status, headers.flat());
        res.end(
          req.method === "HEAD"
            ? undefined
            : Buffer.from(await r.arrayBuffer()),
        );
        o.log?.(`${req.method} ${req.url} → ${r.status}`);
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  fixedEnv = env();
  await worker.scheduled({}, fixedEnv);
  if (o.samples) await sendSamples(origin(), site);
  return {
    server,
    port,
    origin: origin(),
    build: built.build,
    mail: () => mail,
    db: () => db,
    files: () => [...files.objects.keys()],
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Регистрация и восстановление на английском и русском — четыре письма для страницы /__preview/mail. */
async function sendSamples(service: string, site: string): Promise<void> {
  const post = async (path: string, payload: unknown, locale: string) => {
    const res = await fetch(`${service}${path}`, {
      method: "POST",
      headers: {
        origin: site,
        "content-type": "application/json",
        "x-captcha-response": PREVIEW_CAPTCHA,
        "x-iconavo-locale": locale,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(
        `превью: ${path} ответил ${res.status} ${await res.text()}`,
      );
    }
    return res;
  };
  for (const locale of ["en", "ru"]) {
    const email = `${locale}@example.com`;
    await post("/api/account/sign-up", { email, locale }, locale);
    const codes = (await (
      await fetch(`${service}/__preview/mail.json`)
    ).json()) as PreviewMail[];
    const code = /\b\d{6}\b/.exec(codes.at(-1)?.subject ?? "")?.[0] ?? "";
    await post(
      "/api/auth/sign-in/email-otp",
      { email, otp: code, locale },
      locale,
    );
    await post("/api/auth/email-otp/request-password-reset", { email }, locale);
  }
}
