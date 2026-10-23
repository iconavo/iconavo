// Точка входа функции на Cloudflare Workers (ADR-0024): edge API на api.iconavo.dev. Глобальный
// caches и метка сборки — только здесь и только внутри fetch: превью конвейера запускает этот же
// бандл в Node, где caches подставляет само превью.

import { BUILD } from "./config.js";
import type { Context, EdgeCache, Env } from "./env.js";
import { createHandler, type Handler } from "./handler.js";

let handler: Handler | undefined;

export default {
  fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    handler ??= createHandler({
      bucket: env.CDN,
      cache: (caches as unknown as { default: EdgeCache }).default,
      build: BUILD,
      log: (message) => console.error(message),
    });
    return handler(request, (promise) => ctx.waitUntil(promise));
  },
};
