// Точка входа функции на Cloudflare Workers (ADR-0024): edge API на api.iconavo.dev. Глобальный
// caches и метка сборки — только здесь и только внутри fetch: превью конвейера запускает этот же
// бандл в Node, где caches подставляет само превью. Приём событий /event, чтение базы для отчёта
// /analytics/query и расписание (итоги дня аналитики) — тоже только здесь: у MCP-сервера, который
// берёт маршруты createRoutes, их нет.

import { EVENT_PATH, REPORT_PATH } from "@iconavo-ui/analytics";
import { rollup } from "@iconavo-ui/analytics/db";
import { BUILD } from "./config.js";
import type { Context, EdgeCache, Env } from "./env.js";
import { handleEvent } from "./event.js";
import { createHandler, type Handler } from "./handler.js";
import { handleReport } from "./report.js";

let handler: Handler | undefined;

const log = (message: string) => console.error(message);

export default {
  fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === EVENT_PATH) return handleEvent(request, env, { log });
    if (pathname === REPORT_PATH) return handleReport(request, env);
    handler ??= createHandler({
      bucket: env.CDN,
      cache: (caches as unknown as { default: EdgeCache }).default,
      build: BUILD,
      log,
      search: {
        ...(env.SEARCH ? { bucket: env.SEARCH } : {}),
        ...(env.SEARCH_LIMIT ? { limiter: env.SEARCH_LIMIT } : {}),
        ...(env.ICON_LIMIT ? { iconLimiter: env.ICON_LIMIT } : {}),
        ...(env.MEILISEARCH_URL && env.MEILISEARCH_SEARCH_KEY
          ? {
              meili: {
                url: env.MEILISEARCH_URL,
                key: env.MEILISEARCH_SEARCH_KEY,
              },
            }
          : {}),
        ...(env.POLZA_API_KEY ? { polzaKey: env.POLZA_API_KEY } : {}),
      },
    });
    return handler(request, (promise) => ctx.waitUntil(promise));
  },

  /**
   * Расписание (Cron Trigger, раз в сутки): итоги прошедших дней и уборка событий старше 30 дней
   * (ADR-0043, ADR-0028). Сбой — строка журнала и ошибка запуска: её видно в панели Cloudflare.
   */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    if (env.ANALYTICS === undefined) return;
    try {
      await rollup(env.ANALYTICS, Date.now());
    } catch (e) {
      log(
        `аналитика: итоги дня не посчитаны: ${(e as Error).message.slice(0, 200)}`,
      );
      throw e;
    }
  },
};
