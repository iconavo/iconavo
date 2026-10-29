// Запуск рабочих копий примеров в проверке (ADR-0050): HTML — свой сервер файлов на 127.0.0.1, React —
// скрипты примера (npm run dev, npm run preview), Next.js — next dev и next start из example/next.ts.
// Сервер готов, когда главная страница ответила 200; останавливается со всеми дочерними процессами.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { stopTree } from "../example/next.js";
import { allowedHost } from "../search/server.js";
import { RUN_TIMEOUT_MS } from "./config.js";
import { commandLine } from "./pack.js";

export interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Файлы папки на 127.0.0.1: только GET и HEAD, только свой Host, путь за пределы папки — 404. */
export async function startStatic(dir: string): Promise<RunningServer> {
  let port = 0;
  const server: Server = createServer(async (req, res) => {
    if (!allowedHost(req.headers.host, port)) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const file = normalize(
      join(dir, path.endsWith("/") ? `${path}index.html` : path),
    );
    const rel = relative(dir, file);
    const type = TYPES[extname(file).toLowerCase()];
    if (rel.startsWith("..") || isAbsolute(rel) || type === undefined) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Скрипт примера, который поднимает сервер (npm run dev, npm run preview): готов — когда url ответил
 * 200. Вывод — последние строки, для сообщения об ошибке.
 */
export async function startScript(
  args: string[],
  o: { dir: string; url: string; env?: Record<string, string> },
): Promise<RunningServer> {
  const output: string[] = [];
  const line = commandLine("npm", args);
  const child = spawn(line.file, line.args, {
    cwd: o.dir,
    env: { ...process.env, ...o.env },
    windowsVerbatimArguments: line.verbatim,
    stdio: ["ignore", "pipe", "pipe"],
    // На POSIX — своя группа процессов: её останавливает stopTree.
    detached: process.platform !== "win32",
  });
  const keep = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim() === "") continue;
      output.push(line);
      if (output.length > 40) output.shift();
    }
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let gone = false;
  child.once("exit", () => {
    gone = true;
  });
  const stop = () => stopTree(child);
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    if (gone) {
      throw new Error(
        `npm ${args.join(" ")} остановился\n${output.join("\n")}`,
      );
    }
    try {
      const response = await fetch(`${o.url}/`, {
        signal: AbortSignal.timeout(30_000),
      });
      await response.arrayBuffer();
      if (response.ok) return { url: o.url, stop };
    } catch {
      // Сервер ещё не слушает порт.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`npm ${args.join(" ")} не ответил\n${output.join("\n")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
