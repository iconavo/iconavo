// Превью edge API (ADR-0024): ровно бандл dist-api/worker.js в Node на 127.0.0.1 — с R2 из папки
// раздачи dist-cdn/ и кэшем в памяти. Host сверяется, как у страницы поиска: чужой сайт через
// браузер сюда не достучится. На / — страница для глаз, на /_static/… — файлы раздачи для
// сравнения; остальное отвечает функция. Подделки привязок — в local.ts. Приём событий /event (шаг 2
// фазы 5) пишет в базу node:sqlite в памяти: она создаётся при первой пачке, и модуль Node грузится
// только тогда — у остальных команд нет его предупреждения «experimental».

export { diskBucket, memoryCache } from "./local.js";

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { EVENT_PATH, MAX_BODY_BYTES } from "@iconavo-ui/analytics";
import type { D1Like } from "@iconavo-ui/d1";
import { sqliteD1 } from "@iconavo-ui/d1/sqlite";
import { MANIFEST_FILE } from "../cdn/config.js";
import { manifestSchema } from "../cdn/files.js";
import { esc, htmlPage } from "../report/html.js";
import { buildApi } from "./build.js";
import { WORKER_FILE } from "./config.js";
import { allowedHost, diskBucket, fileIn, memoryCache } from "./local.js";
import { LIVE_BASE, renderPreviewPage } from "./page.js";

interface WorkerModule {
  default: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };
}

export interface ApiPreviewOptions {
  root: string;
  /** dist-api/ — сюда пересобирается функция. */
  outDir: string;
  /** dist-cdn/ — данные для привязки R2. */
  cdnDir: string;
  /** 0 — любой свободный. */
  port: number;
  /**
   * Поиск (ADR-0049): Meilisearch с ключом только для чтения и Polza из .env; бакет поиска — папка на
   * диске (нет — версии индекса и векторов фраз нет, вектор каждого запроса считает Polza).
   */
  search?: { url: string; key: string; polzaKey?: string; dir: string };
  /**
   * Страницы, с которых /event берёт события (шаг 2 фазы 5): проверка сайта даёт свой адрес. Нет —
   * как у живой функции: только https://iconavo.dev.
   */
  eventOrigins?: readonly string[];
  log?: (line: string) => void;
}

export interface ApiPreview {
  server: Server;
  port: number;
  build: string;
  /** База событий /event; undefined — ни одной пачки ещё не пришло. */
  analytics(): D1Like | undefined;
  close(): Promise<void>;
}

/** Заголовки, которые приём читает: остальные превью функции не передаёт. */
const EVENT_HEADERS = ["origin", "content-type", "x-iconavo-test"] as const;

/**
 * Тело запроса — до max байт и ещё один: «слишком длинное» функция видит сама. Дочитывается до конца
 * (выход из цикла закрыл бы соединение раньше ответа), лишнее не копится.
 */
async function readBody(
  req: IncomingMessage,
  max: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    if (size <= max) chunks.push(part);
    size += part.byteLength;
  }
  return new Uint8Array(Buffer.concat(chunks).subarray(0, max + 1));
}

const STATIC_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | string | null;
}

const text = (status: number, message: string): Reply => ({
  status,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: htmlPage(message, "", `<p>${esc(message)}</p>`),
});

/** Каждый запуск пересобирает функцию: превью показывает ровно то, что уйдёт в Cloudflare. */
export async function startApiPreview(
  o: ApiPreviewOptions,
): Promise<ApiPreview> {
  const built = await buildApi({ root: o.root, outDir: o.outDir });
  const g = globalThis as { caches?: unknown };
  g.caches ??= { default: memoryCache() };
  const worker = (
    (await import(
      pathToFileURL(join(o.outDir, WORKER_FILE)).href
    )) as WorkerModule
  ).default;
  const env = {
    CDN: diskBucket(o.cdnDir),
    ...(o.search
      ? {
          SEARCH: diskBucket(o.search.dir),
          // Лимита частоты в превью нет: сервер слушает только 127.0.0.1.
          SEARCH_LIMIT: { limit: async () => ({ success: true }) },
          ICON_LIMIT: { limit: async () => ({ success: true }) },
          MEILISEARCH_URL: o.search.url,
          MEILISEARCH_SEARCH_KEY: o.search.key,
          ...(o.search.polzaKey ? { POLZA_API_KEY: o.search.polzaKey } : {}),
        }
      : {}),
  };
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      promise.catch(() => {});
    },
  };
  let analytics: D1Like | undefined;
  const eventEnv = async () => {
    if (analytics === undefined) {
      const { DatabaseSync } = await import("node:sqlite");
      analytics = sqliteD1(new DatabaseSync(":memory:"));
    }
    return {
      ...env,
      ANALYTICS: analytics,
      ...(o.eventOrigins === undefined
        ? {}
        : { EVENT_ORIGINS: o.eventOrigins.join(",") }),
    };
  };
  let port = o.port;
  const local = (path: string, method = "GET") =>
    worker.fetch(
      new Request(`http://127.0.0.1:${port}${path}`, { method }),
      env,
      ctx,
    );

  const versions = async () => {
    const data = await fileIn(o.cdnDir, MANIFEST_FILE);
    const parsed =
      data === null
        ? undefined
        : manifestSchema.safeParse(
            JSON.parse(Buffer.from(data).toString("utf8")),
          );
    return new Map(
      Object.entries(parsed?.success ? parsed.data.sets : {}).map(
        ([id, s]) => [id, s.version] as const,
      ),
    );
  };

  async function reply(req: IncomingMessage): Promise<Reply> {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    if (!allowedHost(req.headers.host, port)) {
      return text(403, "Превью открывается только по адресу 127.0.0.1");
    }
    const parsed = new URL(url, `http://127.0.0.1:${port}`);
    if (parsed.pathname === EVENT_PATH) {
      const headers = new Headers();
      for (const name of EVENT_HEADERS) {
        const value = req.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const res = await worker.fetch(
        new Request(`http://127.0.0.1:${port}${EVENT_PATH}`, {
          method,
          headers,
          ...(method === "POST"
            ? { body: await readBody(req, MAX_BODY_BYTES) }
            : {}),
        }),
        await eventEnv(),
        ctx,
      );
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers),
        body: new Uint8Array(await res.arrayBuffer()),
      };
    }
    if (parsed.pathname === "/") {
      if (method !== "GET" && method !== "HEAD") return text(405, "Только GET");
      // Живой API — только наш адрес: страница не станет ходить куда попало.
      const live = parsed.searchParams.get("base") === LIVE_BASE;
      const page = await renderPreviewPage({
        build: built.build,
        base: live ? LIVE_BASE : "",
        versions: await versions(),
        fetch: live ? (path) => fetch(`${LIVE_BASE}${path}`) : local,
      });
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: page,
      };
    }
    if (parsed.pathname.startsWith("/_static/")) {
      const path = decodeURIComponent(
        parsed.pathname.slice("/_static/".length),
      );
      const type = STATIC_TYPES[extname(path)];
      const data = type === undefined ? null : await fileIn(o.cdnDir, path);
      const file: Reply =
        data === null || type === undefined
          ? text(404, "Нет такого файла раздачи — сначала pnpm cdn build")
          : { status: 200, headers: { "content-type": type }, body: data };
      // Песочница ядра (pnpm sandbox) берёт эти файлы как хост статики со своего адреса, как у
      // раздачи (ADR-0023): CORS — у всех ответов, и у 404 тоже.
      file.headers["access-control-allow-origin"] = "*";
      return file;
    }
    const res = await local(`${parsed.pathname}${parsed.search}`, method);
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: new Uint8Array(await res.arrayBuffer()),
    };
  }

  const server = createServer((req, res) => {
    reply(req)
      .catch((e: Error): Reply => text(500, `Ошибка: ${e.message}`))
      .then((r) => {
        // Браузер не хранит ответы превью: после пересборки видно новое.
        res.writeHead(r.status, {
          ...r.headers,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : (r.body ?? undefined));
        o.log?.(`${req.method} ${req.url} → ${r.status}`);
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    build: built.build,
    analytics: () => analytics,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
