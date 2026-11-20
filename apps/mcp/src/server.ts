// Сервер MCP одного запроса (ADR-0044): SDK собирает его заново на каждый запрос (протокол 2026-07-28
// и запасной путь без состояния для клиентов 2025 года), поэтому здесь только регистрация
// инструментов — схемы созданы заранее (schemas.ts, tools/*.ts). Названия инструментов — из ADR-0011,
// дальше они меняются только добавлением: новые необязательные поля, новые инструменты.

import {
  RESOURCE_MIME_TYPE,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import {
  MAX_TOOL_INPUT_ELEMENTS,
  PICKER_TEMPLATE,
  PICKER_VERSION,
  pickerUri,
  SITE_URL,
  TOOLS_LIST_TTL_MS,
} from "./config.js";
import type { Call, McpDeps } from "./context.js";
import {
  getIcon,
  ICON_DESCRIPTION,
  ICON_NAME,
  IconInput,
  IconOutput,
} from "./tools/icon.js";
import {
  LIST_DESCRIPTION,
  LIST_NAME,
  ListInput,
  ListOutput,
  listSets,
} from "./tools/list.js";
import {
  MATCHING_DESCRIPTION,
  MATCHING_NAME,
  MatchingInput,
  MatchingOutput,
  matchingSet,
} from "./tools/matching.js";
import {
  PICK_DESCRIPTION,
  PICK_NAME,
  PickInput,
  PickOutput,
  pickIcon,
} from "./tools/pick.js";
import {
  SEARCH_DESCRIPTION,
  SEARCH_NAME,
  SearchInput,
  SearchOutput,
  searchIcons,
} from "./tools/search.js";
import {
  getUsage,
  USAGE_DESCRIPTION,
  USAGE_NAME,
  UsageInput,
  UsageOutput,
} from "./tools/usage.js";

export const INSTRUCTIONS = [
  "Iconavo is a catalog of open-source icons (Lucide, Tabler, Material Symbols, Phosphor, Fluent Emoji Flat) with search by meaning in any language.",
  "When the user asks to find, show or pick an icon, call pick_icon right away: it shows a grid in the chat where the user picks the icon, its color, stroke width and the kind of code, and the ready code comes back in your context.",
  "When you choose icons yourself, for example while writing UI code: search_icons to find candidates (its PNG preview numbers them in the same order as the list) → get_icon for ready code →",
  "get_usage once per project to install the package. For several icons that must look alike, such as a menu or a toolbar, use get_matching_set.",
  "Code uses the Iconavo package by default (the <iconavo-icon> web component, or React); give raw SVG only when the user asks for it.",
  "Every icon keeps the license of its set: tell the user the license and author shown in each response and keep the attribution.",
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
      // Списки инструментов и ресурсов меняются только выкладкой: подписываться на изменения незачем.
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
      },
      cacheHints: {
        "tools/list": { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: "public" },
        "resources/list": { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: "public" },
        "resources/templates/list": {
          ttlMs: TOOLS_LIST_TTL_MS,
          cacheScope: "public",
        },
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
  server.registerTool(
    ICON_NAME,
    {
      title: "Get icon code",
      description: ICON_DESCRIPTION,
      inputSchema: IconInput,
      outputSchema: IconOutput,
      annotations: { title: "Get icon code", ...READ_ONLY },
    },
    (args) => getIcon(deps, call, args),
  );
  server.registerTool(
    MATCHING_NAME,
    {
      title: "Get a matching set of icons",
      description: MATCHING_DESCRIPTION,
      inputSchema: MatchingInput,
      outputSchema: MatchingOutput,
      annotations: { title: "Get a matching set of icons", ...READ_ONLY },
    },
    (args) => matchingSet(deps, call, args),
  );
  server.registerTool(
    USAGE_NAME,
    {
      title: "How to install and use",
      description: USAGE_DESCRIPTION,
      inputSchema: UsageInput,
      outputSchema: UsageOutput,
      annotations: { title: "How to install and use", ...READ_ONLY },
    },
    (args) => getUsage(deps, args),
  );
  server.registerTool(
    LIST_NAME,
    {
      title: "List icon sets",
      description: LIST_DESCRIPTION,
      inputSchema: ListInput,
      outputSchema: ListOutput,
      annotations: { title: "List icon sets", ...READ_ONLY },
    },
    (args) => listSets(deps, args),
  );
  // Сетка выбора в чате (ADR-0045): инструмент с интерфейсом MCP Apps и сам интерфейс — ресурс.
  const uri = pickerUri(deps.picker.version);
  registerAppTool(
    server,
    PICK_NAME,
    {
      title: "Pick an icon in the chat",
      description: PICK_DESCRIPTION,
      inputSchema: PickInput,
      outputSchema: PickOutput,
      annotations: { title: "Pick an icon in the chat", ...READ_ONLY },
      _meta: { ui: { resourceUri: uri } },
    },
    (args) => pickIcon(deps, call, args),
  );
  server.registerResource(
    "picker",
    new ResourceTemplate(PICKER_TEMPLATE, {
      list: () => ({
        resources: [
          {
            uri,
            name: "picker",
            title: "Icon picker",
            mimeType: RESOURCE_MIME_TYPE,
          },
        ],
      }),
    }),
    {
      title: "Icon picker",
      description:
        "Interactive grid for pick_icon: the user picks an icon right in the chat (MCP Apps)",
      mimeType: RESOURCE_MIME_TYPE,
      cacheHint: { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: "public" },
    },
    (url, variables) => {
      // Любая версия — текущая страница: у клиента список инструментов со старым адресом живёт до часа.
      if (!PICKER_VERSION.test(String(variables.version))) {
        throw new ResourceNotFoundError(url.href);
      }
      return {
        contents: [
          {
            uri: url.href,
            mimeType: RESOURCE_MIME_TYPE,
            text: deps.picker.html,
            // Рамку рисует клиент; сети сетке не нужно — доменов в политике нет.
            _meta: { ui: { prefersBorder: true } },
          },
        ],
      };
    },
  );
  return server;
}
