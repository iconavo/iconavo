// Next.js для примера (фаза 3, шаг 7): сборка, запуск и остановка из конвейера. Next.js запускается тем
// же Node, что и конвейер, — бинарником из папки примера. Останавливается со всеми дочерними
// процессами — иначе рабочие процессы Next.js остались бы сиротами: на Windows — taskkill /T, на
// Linux и macOS — сигналом своей группе процессов. Остановка ждёт выхода: следующий next build в той
// же папке не застанет старый процесс.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { START_TIMEOUT_MS, STOP_TIMEOUT_MS } from "./config.js";

export type Mode = "dev" | "prod";

export interface NextRun {
  /** Папка примера. */
  dir: string;
  /** Переменные окружения поверх своих: адреса хостов иконок. */
  env?: Record<string, string>;
  /** Сборщик webpack вместо Turbopack (по умолчанию в Next.js 16). */
  webpack?: boolean;
  /** Вывод Next.js — в этот терминал; иначе — последние строки для сообщения об ошибке. */
  inherit?: boolean;
}

export interface NextServer {
  url: string;
  /** Остановить Next.js со всеми дочерними процессами и дождаться выхода. */
  stop(): Promise<void>;
}

const bin = (dir: string) =>
  createRequire(join(dir, "package.json")).resolve("next/dist/bin/next");

/** Сигнал группе процессов (на POSIX у Next.js своя группа); не вышло — самому процессу. */
function signal(child: ChildProcess, name: NodeJS.Signals): void {
  try {
    process.kill(-(child.pid as number), name);
  } catch {
    child.kill(name);
  }
}

/**
 * Остановить процесс со всеми дочерними и дождаться его выхода. На Windows — taskkill /T /F, иначе
 * SIGTERM группе; не вышел за STOP_TIMEOUT_MS — SIGKILL.
 */
export async function stopTree(child: ChildProcess): Promise<void> {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  ) {
    return;
  }
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    signal(child, "SIGTERM");
  }
  const timer = setTimeout(() => signal(child, "SIGKILL"), STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(timer);
}

function spawnNext(args: string[], o: NextRun) {
  const output: string[] = [];
  const child = spawn(process.execPath, [bin(o.dir), ...args], {
    cwd: o.dir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...o.env },
    stdio: o.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
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
  const exit = new Promise<number>((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );
  return { child, output, exit };
}

/** next build: код 0 — собрано, иначе ошибка с последними строками вывода. */
export async function buildNext(o: NextRun): Promise<void> {
  const { output, exit } = spawnNext(
    ["build", ...(o.webpack ? ["--webpack"] : [])],
    o,
  );
  const code = await exit;
  if (code !== 0) {
    throw new Error(`next build: код ${code}\n${output.join("\n")}`);
  }
}

/** Свободный порт на 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("порт не выдан")),
      );
    });
  });
}

/**
 * next dev или next start на 127.0.0.1:port. Готов — когда главная страница ответила 200: в режиме
 * разработки Next.js собирает её как раз по первому запросу.
 */
export async function startNext(
  mode: Mode,
  port: number,
  o: NextRun,
): Promise<NextServer> {
  const command =
    mode === "dev" ? ["dev", ...(o.webpack ? ["--webpack"] : [])] : ["start"];
  const { child, output, exit } = spawnNext(
    [...command, "--hostname", "127.0.0.1", "--port", String(port)],
    o,
  );
  let gone = false;
  exit.then(() => {
    gone = true;
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = () => stopTree(child);
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    if (gone) {
      throw new Error(`next ${command[0]} остановился\n${output.join("\n")}`);
    }
    try {
      const response = await fetch(`${url}/`, {
        signal: AbortSignal.timeout(START_TIMEOUT_MS),
      });
      await response.arrayBuffer();
      if (response.ok) return { url, stop };
    } catch {
      // Сервер ещё не слушает порт.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(
        `next ${command[0]} не ответил за ${START_TIMEOUT_MS / 1000} с\n${output.join("\n")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
