// Превью MCP-сервера (шаг 10 фазы 4): свежая сборка dist-mcp/ и отдельный процесс Node (runner.ts),
// где запреты Workers включены — eval и компиляция wasm из байтов. Адрес — 127.0.0.1:4285/mcp: к нему
// подключаются MCP Inspector и pnpm mcp check --base=http://127.0.0.1:4285.

import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { WORKER_FILE } from "../api/config.js";
import { buildMcp } from "./build.js";
import { WASM_FILE } from "./config.js";
import type { RunnerConfig, RunnerMessage } from "./runner.js";

export interface McpPreviewOptions {
  root: string;
  /** dist-mcp/ — сюда пересобирается функция. */
  outDir: string;
  /** dist-cdn/ — данные для привязки R2. */
  cdnDir: string;
  /** 0 — любой свободный. */
  port: number;
  /** Meilisearch с ключом только для чтения и Polza из .env; бакет поиска — папка на диске. */
  search?: RunnerConfig["search"];
}

export interface McpPreview {
  port: number;
  build: string;
  close(): Promise<void>;
}

/** Процесс превью — из сборки конвейера (tsc -b): тесты Vitest идут по исходникам, а ребёнку нужен JS. */
const runnerPath = (root: string) =>
  join(root, "packages", "pipeline", "dist", "mcp", "runner.js");

/** Ждёт, пока процесс закончится; на Windows — вместе с дочерними (как у примера Next.js). */
function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

/** Срок ответа «готово» от процесса превью: модуль функции и wasm грузятся за секунды. */
export const RUNNER_READY_MS = 30_000;

/**
 * Пауза после выхода процесса, прежде чем сказать «вышел с кодом»: сообщение о причине, отправленное
 * перед выходом, может прийти по IPC чуть позже события exit.
 */
const EXIT_GRACE_MS = 200;

export interface RunnerProcess {
  port: number;
  close(): Promise<void>;
}

/**
 * Процесс превью с этими настройками. «Готово» ждётся не дольше readyMs — иначе процесс
 * останавливается и называется причина: раньше команда могла ждать вечно (ревизия фазы 5, И-11).
 */
export async function spawnRunner(
  root: string,
  config: RunnerConfig,
  readyMs = RUNNER_READY_MS,
): Promise<RunnerProcess> {
  const child = spawn(
    process.execPath,
    ["--disallow-code-generation-from-strings", runnerPath(root)],
    { stdio: ["ignore", "inherit", "inherit", "ipc"] },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const port = await new Promise<number>((resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `превью MCP не ответило «готово» за ${String(Math.round(readyMs / 100) / 10).replace(".", ",")} с`,
          ),
        ),
      readyMs,
    );
    child.once("exit", (code) => {
      setTimeout(
        () => reject(new Error(`процесс превью MCP вышел с кодом ${code}`)),
        EXIT_GRACE_MS,
      ).unref();
    });
    child.once("error", reject);
    child.on("message", (message: RunnerMessage) => {
      if (message.type === "ready") resolve(message.port);
      else reject(new Error(`превью MCP: ${message.message}`));
    });
    child.send(config);
  })
    .catch(async (e: Error) => {
      await stop(child);
      throw e;
    })
    .finally(() => clearTimeout(timer));
  // Родитель ушёл — превью тоже: на Windows дочерний процесс иначе остался бы жить.
  const onExit = () => child.kill();
  process.once("exit", onExit);
  return {
    port,
    close: async () => {
      process.off("exit", onExit);
      await stop(child);
    },
  };
}

export async function startMcpPreview(
  o: McpPreviewOptions,
): Promise<McpPreview> {
  const built = await buildMcp({ root: o.root, outDir: o.outDir });
  const runner = await spawnRunner(o.root, {
    workerPath: join(o.outDir, WORKER_FILE),
    wasmPath: join(o.outDir, WASM_FILE),
    cdnDir: o.cdnDir,
    port: o.port,
    ...(o.search ? { search: o.search } : {}),
  });
  return { port: runner.port, build: built.build, close: runner.close };
}
