// Превью MCP-сервера: бандл в отдельном процессе Node с запретами Workers (eval, компиляция wasm из
// байтов) отвечает клиенту SDK на обоих протоколах — 2025 года и 2026-07-28. Поиска в тесте нет
// (Meilisearch не настроен): search_icons отвечает ошибкой инструмента, а не падением функции.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeCdnDemoSet } from "../cdn/fixture.testing.js";
import { buildCdn } from "../cdn/run.js";
import { demoConfig } from "../search/fixture.testing.js";
import { type McpPreview, spawnRunner, startMcpPreview } from "./preview.js";
import type { RunnerConfig } from "./runner.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

let tmp: string;
let preview: McpPreview;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "iconavo-mcp-preview-"));
  const dataDir = join(tmp, "data");
  const cdnDir = join(tmp, "dist-cdn");
  await writeCdnDemoSet(dataDir, {
    id: "demo",
    icons: { house: { body: '<path fill="currentColor" d="M1 1h2"/>' } },
  });
  await buildCdn([demoConfig("demo")], {
    dataDir,
    outDir: cdnDir,
    concurrency: 2,
  });
  preview = await startMcpPreview({
    root: ROOT,
    outDir: join(tmp, "dist-mcp"),
    cdnDir,
    port: 0,
  });
}, 60_000);

afterAll(async () => {
  await preview?.close();
  await rm(tmp, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${preview.port}`;

/** Запрос с чужим заголовком Host: fetch его не позволяет. */
const statusWithHost = (host: string) =>
  new Promise<number>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: preview.port, path: "/", headers: { host } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });

describe("превью MCP-сервера", () => {
  it("/ — страница функции с меткой этой сборки; чужой Host — 403", async () => {
    const res = await fetch(`${base()}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-iconavo-build")).toBe(preview.build);
    expect(await statusWithHost("evil.example")).toBe(403);
  });

  it.each([
    ["2025 года", undefined],
    ["2026-07-28", { mode: { pin: "2026-07-28" as const } }],
  ])(
    "клиент SDK, протокол %s: список инструментов и вызов без поиска — ошибка инструмента",
    async (_, versionNegotiation) => {
      const client = new Client(
        { name: "iconavo-test", version: "1" },
        versionNegotiation === undefined ? {} : { versionNegotiation },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base()}/mcp`)),
      );
      try {
        const tools = await client.listTools();
        expect(tools.tools.map((t) => t.name)).toEqual([
          "search_icons",
          "get_icon",
          "get_matching_set",
          "get_usage",
          "list_sets",
          "pick_icon",
        ]);
        // Сетка выбора (ADR-0045): адрес интерфейса — у инструмента, страница — ресурс по этому адресу.
        const pick = tools.tools.find((t) => t.name === "pick_icon");
        const uri = (pick?._meta?.ui as { resourceUri?: string } | undefined)
          ?.resourceUri;
        expect(uri).toMatch(/^ui:\/\/picker\/[0-9a-f]{8}$/);
        const page = await client.readResource({ uri: uri as string });
        const content = page.contents[0] as {
          mimeType?: string;
          text?: string;
        };
        expect(content.mimeType).toBe("text/html;profile=mcp-app");
        expect(content.text).toMatch(/^<!doctype html>/);
        const result = await client.callTool({
          name: "search_icons",
          arguments: { query: "house" },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain("search_unavailable");
        // Ошибка схемы — по-английски, как в Workers: настройки zod конвейера (русские сообщения,
        // общие через globalThis) в процесс превью не попадают.
        const invalid = await client.callTool({
          name: "search_icons",
          arguments: { query: "" },
        });
        expect(invalid.isError).toBe(true);
        expect(JSON.stringify(invalid.content)).not.toMatch(/[а-яё]/i);
      } finally {
        await client.close();
      }
    },
  );
});

// Процесс превью сам по себе — на крошечных функциях вместо бандла (ревизия фазы 5, И-11, И-22).
describe("процесс превью: запреты Workers, «готово», поток ответа", () => {
  const runnerConfig = async (
    name: string,
    source: string,
  ): Promise<RunnerConfig> => {
    const wasmPath = join(tmp, "tiny.wasm");
    await writeFile(wasmPath, Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]));
    const workerPath = join(tmp, name);
    await writeFile(workerPath, source);
    return { workerPath, wasmPath, cdnDir: join(tmp, "dist-cdn"), port: 0 };
  };

  it("new WebAssembly.Module из байтов запрещён, как в Workers; причина доходит до родителя", async () => {
    const config = await runnerConfig(
      "compile.mjs",
      `new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
export default { fetch: () => new Response("ok") };`,
    );
    await expect(spawnRunner(ROOT, config)).rejects.toThrow(
      /^превью MCP: WebAssembly: компиляция из байтов запрещена/,
    );
  });

  it("встроенный fetch Node в превью работает: запрет конструктора — только коду функции", async () => {
    // Сам Node (undici) собирает свой разборщик HTTP через new WebAssembly.Module: общий запрет ломал
    // все запросы превью к Meilisearch и Polza.
    const server = createServer((_, res) => res.end("from-server"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const port = (server.address() as AddressInfo).port;
    const config = await runnerConfig(
      "fetch.mjs",
      `export default {
  async fetch() {
    const res = await fetch("http://127.0.0.1:${port}/");
    return new Response(await res.text());
  },
};`,
    );
    const runner = await spawnRunner(ROOT, config);
    try {
      const res = await fetch(`http://127.0.0.1:${runner.port}/`);
      expect(await res.text()).toBe("from-server");
    } finally {
      await runner.close();
      server.close();
    }
  });

  it("превью не ответило «готово» в срок — ошибка с причиной, процесс остановлен", async () => {
    const config = await runnerConfig(
      "hang.mjs",
      `await new Promise(() => {});
export default {};`,
    );
    await expect(spawnRunner(ROOT, config, 500)).rejects.toThrow(
      /^превью MCP не ответило «готово» за 0,5 с$/,
    );
  });

  it("сбой потока ответа обрывает один ответ, превью живёт", async () => {
    const config = await runnerConfig(
      "stream.mjs",
      `export default {
  fetch(request) {
    if (new URL(request.url).pathname !== "/broken") return new Response("ok");
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([111]));
        controller.error(new Error("boom"));
      },
    }));
  },
};`,
    );
    const runner = await spawnRunner(ROOT, config);
    try {
      const url = `http://127.0.0.1:${runner.port}`;
      await fetch(`${url}/broken`)
        .then((res) => res.text())
        .catch(() => "");
      expect(await (await fetch(`${url}/`)).text()).toBe("ok");
    } finally {
      await runner.close();
    }
  });
});
