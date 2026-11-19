// Процесс превью MCP-сервера (шаг 10 фазы 4): бандл dist-mcp/worker.js в Node так, как его увидит
// Workers. Node запущен с --disallow-code-generation-from-strings — eval и new Function запрещены, как
// в Workers; модуль wasm рисовальщика приходит импорту готовым WebAssembly.Module, а компиляция wasm
// из байтов во время работы запрещена — тоже как в Workers. Данные — из папки раздачи, кэш — в
// памяти, лимитов частоты нет: сервер слушает только 127.0.0.1 и сверяет Host.
// Настройки приходят от родителя по IPC (в них ключ Meilisearch — не в командной строке).

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { registerHooks } from "node:module";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { diskBucket, memoryCache } from "../api/preview.js";
import { allowedHost } from "../search/server.js";
import { WASM_IMPORT } from "./config.js";

export interface RunnerConfig {
  workerPath: string;
  wasmPath: string;
  cdnDir: string;
  port: number;
  search?: { url: string; key: string; polzaKey?: string; dir: string };
}

export type RunnerMessage =
  | { type: "ready"; port: number }
  | { type: "error"; message: string };

interface WorkerModule {
  default: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };
}

const MODULE_KEY = "__iconavoResvgModule";

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function start(config: RunnerConfig): Promise<number> {
  // Модуль wasm компилируется здесь, до запрета, — как Workers при выкладке.
  const resvg = new WebAssembly.Module(await readFile(config.wasmPath));
  (globalThis as Record<string, unknown>)[MODULE_KEY] = resvg;
  const forbidden = () => {
    throw new Error(
      "WebAssembly: компиляция из байтов запрещена, как в Workers — модуль должен прийти импортом",
    );
  };
  const instantiate = WebAssembly.instantiate.bind(WebAssembly);
  Object.assign(WebAssembly, {
    compile: forbidden,
    compileStreaming: forbidden,
    instantiateStreaming: forbidden,
    instantiate: (source: unknown, imports?: WebAssembly.Imports) =>
      source instanceof WebAssembly.Module
        ? instantiate(source, imports)
        : forbidden(),
  });
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === WASM_IMPORT) {
        return {
          url: `data:text/javascript,export default globalThis.${MODULE_KEY};`,
          shortCircuit: true,
        };
      }
      return next(specifier, context);
    },
  });
  const g = globalThis as { caches?: unknown };
  g.caches ??= { default: memoryCache() };
  const worker = (
    (await import(pathToFileURL(config.workerPath).href)) as WorkerModule
  ).default;
  const allow = { limit: async () => ({ success: true }) };
  const env = {
    CDN: diskBucket(config.cdnDir),
    ...(config.search
      ? {
          SEARCH: diskBucket(config.search.dir),
          MCP_SEARCH_LIMIT: allow,
          MCP_ICON_LIMIT: allow,
          MEILISEARCH_URL: config.search.url,
          MEILISEARCH_SEARCH_KEY: config.search.key,
          ...(config.search.polzaKey
            ? { POLZA_API_KEY: config.search.polzaKey }
            : {}),
        }
      : {}),
  };
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      promise.catch(() => {});
    },
  };
  let port = config.port;
  const server = createServer((req, res) => {
    (async () => {
      if (!allowedHost(req.headers.host, port)) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("Превью открывается только по адресу 127.0.0.1\n");
        return;
      }
      const method = req.method ?? "GET";
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(", "));
      }
      // Как у Cloudflare: адрес клиента — заголовком, его берут лимиты частоты.
      headers.set("cf-connecting-ip", req.socket.remoteAddress ?? "127.0.0.1");
      const payload =
        method === "GET" || method === "HEAD" ? undefined : await body(req);
      const response = await worker.fetch(
        new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
          method,
          headers,
          ...(payload === undefined ? {} : { body: new Uint8Array(payload) }),
        }),
        env,
        ctx,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body === null || method === "HEAD") {
        res.end();
        return;
      }
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      ).pipe(res);
    })().catch((e: Error) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      }
      res.end(`Ошибка превью: ${e.message}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  return port;
}

// Родитель ушёл (Ctrl+C, остановка задачи) — превью тоже: на Windows дочерний процесс иначе жил бы
// дальше и держал порт.
process.once("disconnect", () => process.exit(0));

process.once("message", (message) => {
  start(message as RunnerConfig).then(
    (port) => process.send?.({ type: "ready", port } satisfies RunnerMessage),
    (e: Error) => {
      process.send?.({
        type: "error",
        message: e.message,
      } satisfies RunnerMessage);
      process.exit(1);
    },
  );
});
