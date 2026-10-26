// Превью edge API (ADR-0024): ровно бандл dist-api/worker.js в Node на 127.0.0.1 — с R2 из папки
// раздачи dist-cdn/ и кэшем в памяти. Host сверяется, как у страницы поиска: чужой сайт через
// браузер сюда не достучится. На / — страница для глаз, на /_static/… — файлы раздачи для
// сравнения; остальное отвечает функция.

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { MANIFEST_FILE } from "../cdn/config.js";
import { manifestSchema } from "../cdn/files.js";
import { esc, htmlPage } from "../report/html.js";
import { allowedHost } from "../search/server.js";
import { buildApi } from "./build.js";
import { WORKER_FILE } from "./config.js";
import { LIVE_BASE, renderPreviewPage } from "./page.js";

/** Файл внутри dir; путь за её пределы — нет. */
async function fileIn(dir: string, path: string): Promise<Uint8Array | null> {
  const file = normalize(join(dir, path));
  const rel = relative(dir, file);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

/** Привязка R2 из папки раздачи: ключ — путь от её корня. */
export function diskBucket(dir: string) {
  return {
    async get(key: string) {
      const data = await fileIn(dir, key);
      if (data === null) return null;
      const text = Buffer.from(data).toString("utf8");
      return {
        text: async () => text,
        arrayBuffer: async () => data.slice().buffer as ArrayBuffer,
      };
    },
  };
}

const MAX_AGE = /max-age=(\d+)/;

/** Cache API в памяти: только GET, записи живут max-age, как у Workers. */
export function memoryCache(now: () => number = Date.now) {
  const stored = new Map<
    string,
    {
      status: number;
      headers: [string, string][];
      body: ArrayBuffer;
      at: number;
      ttl?: number;
    }
  >();
  return {
    async match(request: Request) {
      const entry = stored.get(request.url);
      if (entry === undefined) return undefined;
      if (entry.ttl !== undefined && now() - entry.at >= entry.ttl) {
        stored.delete(request.url);
        return undefined;
      }
      return new Response(entry.body, {
        status: entry.status,
        headers: entry.headers,
      });
    },
    async put(request: Request, response: Response) {
      if (request.method !== "GET") {
        throw new TypeError("Cannot cache response to non-GET request.");
      }
      const maxAge = MAX_AGE.exec(
        response.headers.get("cache-control") ?? "",
      )?.[1];
      stored.set(request.url, {
        status: response.status,
        headers: [...response.headers],
        body: await response.arrayBuffer(),
        at: now(),
        ...(maxAge === undefined ? {} : { ttl: Number(maxAge) * 1000 }),
      });
    },
  };
}

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
  log?: (line: string) => void;
}

export interface ApiPreview {
  server: Server;
  port: number;
  build: string;
  close(): Promise<void>;
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

  async function reply(
    method: string,
    url: string,
    host: string | undefined,
  ): Promise<Reply> {
    if (!allowedHost(host, port)) {
      return text(403, "Превью открывается только по адресу 127.0.0.1");
    }
    const parsed = new URL(url, `http://127.0.0.1:${port}`);
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
      return data === null || type === undefined
        ? text(404, "Нет такого файла раздачи — сначала pnpm cdn build")
        : { status: 200, headers: { "content-type": type }, body: data };
    }
    const res = await local(`${parsed.pathname}${parsed.search}`, method);
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: new Uint8Array(await res.arrayBuffer()),
    };
  }

  const server = createServer((req, res) => {
    reply(req.method ?? "GET", req.url ?? "/", req.headers.host)
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
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
