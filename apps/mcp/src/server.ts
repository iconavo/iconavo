// Сервер MCP одного запроса (ADR-0044): SDK собирает его заново на каждый запрос (протокол 2026-07-28
// и запасной путь без состояния для клиентов 2025 года), поэтому здесь только регистрация
// инструментов — схемы созданы заранее (schemas.ts, tools/*.ts). Названия инструментов — из ADR-0011,
// дальше они меняются только добавлением.

import { McpServer } from "@modelcontextprotocol/server";
import {
  MAX_TOOL_INPUT_ELEMENTS,
  SITE_URL,
  TOOLS_LIST_TTL_MS,
} from "./config.js";
import type { Call, McpDeps } from "./context.js";
import {
  SEARCH_DESCRIPTION,
  SEARCH_NAME,
  SearchInput,
  SearchOutput,
  searchIcons,
} from "./tools/search.js";

export const INSTRUCTIONS = [
  "Iconavo is a catalog of open-source icons with search by meaning in any language.",
  "Find icons with search_icons; its PNG preview shows the results numbered in the same order as the list.",
  "Every icon keeps the license of its set: tell the user the license and author shown in the response.",
].join(" ");

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createServer(deps: McpDeps, call: Call): McpServer {
  const server = new McpServer(
    {
      name: "iconavo",
      title: "Iconavo",
      version: deps.build,
      websiteUrl: SITE_URL,
      description: "Open-source icons with search by meaning in any language",
    },
    {
      instructions: INSTRUCTIONS,
      // Список инструментов меняется только выкладкой: подписываться на его изменения незачем.
      capabilities: { tools: { listChanged: false } },
      cacheHints: {
        "tools/list": { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: "public" },
      },
      maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS,
    },
  );
  server.registerTool(
    SEARCH_NAME,
    {
      title: "Search icons",
      description: SEARCH_DESCRIPTION,
      inputSchema: SearchInput,
      outputSchema: SearchOutput,
      annotations: { title: "Search icons", ...READ_ONLY },
    },
    (args) => searchIcons(deps, call, args),
  );
  return server;
}
