// Сервер визуального сравнения (фаза 3, шаг 9): слушает только 127.0.0.1 и сверяет Host, как песочница.
// Отдаёт страницы кусков — их кладёт прогон (put) и убирает после снимка (drop), — скрипт страницы и
// скрипт тега для страниц без сборщика. Больше ничего.

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { esc, htmlPage } from "../report/html.js";
import { allowedHost, type Reply } from "../search/server.js";
import { ICON_SCRIPT } from "./config.js";

export interface VisualServerContext {
  /** Скрипт страницы — dist/visual/client.js конвейера. */
  clientFile: string;
  /** Скрипт тега для страниц без сборщика — packages/icon/dist/iconavo-icon.js. */
  iconScript: string;
}

export interface VisualServer {
  /** http://127.0.0.1:порт */
  base: string;
  /** Положить страницу; ответ — её адрес на сервере. */
  put(html: string): string;
  drop(path: string): void;
  close(): Promise<void>;
}

const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";
const PAGE = /^\/page\/[0-9]+$/;

const text = (status: number, message: string): Reply => ({
  status,
  type: HTML,
  body: htmlPage(message, "", `<p>${esc(message)}</p>`),
});

export async function reply(
  ctx: VisualServerContext,
  pages: Map<string, string>,
  port: number,
  method: string | undefined,
  url: string | undefined,
  host: string | undefined,
): Promise<Reply> {
  if (!allowedHost(host, port)) {
    return text(403, "Сравнение открывается только по адресу 127.0.0.1");
  }
  if (method !== "GET" && method !== "HEAD") return text(405, "Только GET");
  const path = new URL(url ?? "/", `http://127.0.0.1:${port}`).pathname;
  if (PAGE.test(path)) {
    const page = pages.get(path);
    return page === undefined
      ? text(404, "Страницы уже нет: её убирают после снимка")
      : { status: 200, type: HTML, body: page };
  }
  const file =
    path === "/visual.js"
      ? ctx.clientFile
      : path === ICON_SCRIPT
        ? ctx.iconScript
        : undefined;
  if (file === undefined) return text(404, "Нет такой страницы");
  try {
    return { status: 200, type: JS, body: await readFile(file) };
  } catch {
    return text(404, "Нет скрипта — запустите pnpm visual: он собирает тег");
  }
}

export async function startVisualServer(
  ctx: VisualServerContext,
): Promise<VisualServer> {
  const pages = new Map<string, string>();
  let port = 0;
  let next = 0;
  const server: Server = createServer((req, res) => {
    reply(ctx, pages, port, req.method, req.url, req.headers.host)
      .catch((e: Error): Reply => text(500, `Ошибка: ${e.message}`))
      .then((r) => {
        res.writeHead(r.status, {
          "content-type": r.type,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : r.body);
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    put(html) {
      const path = `/page/${next++}`;
      pages.set(path, html);
      return path;
    },
    drop(path) {
      pages.delete(path);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
