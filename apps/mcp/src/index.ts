// Точка входа MCP-сервера на Cloudflare Workers (ADR-0044): mcp.iconavo.dev. Внутри — код edge API с
// теми же хранилищами (context.ts). Глобальный caches и метка сборки — только здесь и только внутри
// fetch: превью конвейера запускает этот же бандл в Node, где caches подставляет само превью.

import "./wasm.js";
import picker from "virtual:iconavo/picker";
import usage from "virtual:iconavo/readme";
import { BUILD } from "../../api/src/config.js";
import type { EdgeCache } from "../../api/src/env.js";
import { createDeps, type McpDeps } from "./context.js";
import type { Context, Env } from "./env.js";
import { serve } from "./http.js";
import { renderPng } from "./png.js";

let deps: McpDeps | undefined;

export default {
  fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    deps ??= createDeps(env, {
      cache: (caches as unknown as { default: EdgeCache }).default,
      build: BUILD,
      log: (message) => console.error(message),
      render: renderPng,
      usage,
      picker,
    });
    return serve(request, deps, (promise) => ctx.waitUntil(promise));
  },
};
