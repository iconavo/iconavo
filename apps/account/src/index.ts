// Точка входа функции `iconavo-account` на account.iconavo.dev (шаг 3 фазы 5, ADR-0055): страница для людей,
// robots.txt и /api — вход, регистрация и восстановление (api.ts). Расписание — уборка просроченного
// (cleanup.ts). Журнал — только наши сообщения об ошибках, без почт и адресов (ADR-0028).

import { handleApi } from "./api.js";
import { cleanup } from "./cleanup.js";
import { BUILD, SITE_ORIGIN } from "./config.js";
import type { Context, Env } from "./env.js";
import { failure, SECURITY_HEADERS } from "./http.js";
import { ensureSchema } from "./migrations.js";

const log = (line: string) => console.error(line);

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Iconavo accounts</title></head>
<body>
<h1>Iconavo accounts</h1>
<p>This address signs people in to <a href="${SITE_ORIGIN}">iconavo.dev</a>. There is nothing to open here.</p>
<p>Build ${BUILD}</p>
</body>
</html>
`;

const PAGE_HEADERS = {
  ...SECURITY_HEADERS,
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-robots-tag": "noindex, nofollow",
};

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      return handleApi(request, env, {
        waitUntil: (promise) => ctx.waitUntil(promise),
        log,
        fetch: (input, init) => fetch(input, init),
        now: Date.now,
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return failure(405, "METHOD_NOT_ALLOWED", "Use GET", {
        allow: "GET, HEAD",
      });
    }
    if (pathname === "/") {
      return new Response(request.method === "HEAD" ? null : PAGE, {
        headers: {
          ...PAGE_HEADERS,
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }
    if (pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: {
          ...PAGE_HEADERS,
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }
    return failure(404, "NOT_FOUND", "Not found");
  },

  /** Расписание (раз в сутки): уборка. Сбой — строка журнала и ошибка запуска, её видно в панели. */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    try {
      await ensureSchema(env.DB);
      await cleanup(env.DB, Date.now(), env.FILES);
    } catch (e) {
      log(`аккаунты: уборка не прошла: ${(e as Error).message.slice(0, 200)}`);
      throw e;
    }
  },
};
