// Превью MCP-сервера: бандл в отдельном процессе Node с запретами Workers (eval, компиляция wasm из
// байтов) отвечает клиенту SDK на обоих протоколах — 2025 года и 2026-07-28. Поиска в тесте нет
// (Meilisearch не настроен): search_icons отвечает ошибкой инструмента, а не падением функции.

import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
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
import { type McpPreview, startMcpPreview } from "./preview.js";

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
        ]);
        const result = await client.callTool({
          name: "search_icons",
          arguments: { query: "house" },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain("search_unavailable");
      } finally {
        await client.close();
      }
    },
  );
});
