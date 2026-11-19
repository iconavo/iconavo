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

export async function startMcpPreview(
  o: McpPreviewOptions,
): Promise<McpPreview> {
  const built = await buildMcp({ root: o.root, outDir: o.outDir });
  const child = spawn(
    process.execPath,
    ["--disallow-code-generation-from-strings", runnerPath(o.root)],
    { stdio: ["ignore", "inherit", "inherit", "ipc"] },
  );
  const config: RunnerConfig = {
    workerPath: join(o.outDir, WORKER_FILE),
    wasmPath: join(o.outDir, WASM_FILE),
    cdnDir: o.cdnDir,
    port: o.port,
    ...(o.search ? { search: o.search } : {}),
  };
  const port = await new Promise<number>((resolve, reject) => {
    child.once("exit", (code) =>
      reject(new Error(`процесс превью MCP вышел с кодом ${code}`)),
    );
    child.once("error", reject);
    child.on("message", (message: RunnerMessage) => {
      if (message.type === "ready") resolve(message.port);
      else reject(new Error(`превью MCP: ${message.message}`));
    });
    child.send(config);
  }).catch(async (e: Error) => {
    await stop(child);
    throw e;
  });
  // Родитель ушёл — превью тоже: на Windows дочерний процесс иначе остался бы жить.
  const onExit = () => child.kill();
  process.once("exit", onExit);
  return {
    port,
    build: built.build,
    close: async () => {
      process.off("exit", onExit);
      await stop(child);
    },
  };
}
