// Обработчик edge API (ADR-0024): маршрут → параметры → манифест → кэш дата-центра → файлы имён из
// R2 → ответ. Поиск /search (ADR-0049) — свой путь: search/handler.ts. Новый выпуск набора или новая сборка дают новые ключи кэша, сбрасывать ничего не нужно
// (ADR-0023). В кэш попадают только ответы, которым понадобился R2. Ответ из кэша менять нельзя —
// он оборачивается в новый Response; тело собирается строкой, и из неё делаются два ответа: в кэш и
// клиенту.

import type { IconavoIconSet } from "@iconavo-ui/core";
import { isValidNamePart } from "@iconavo-ui/core/internal";
import { batchBody } from "./batch.js";
import { cacheKey } from "./cache.js";
import { CACHE_OK, SVG_CSP, TYPES } from "./config.js";
import { cssBody, cssOptionsKey, parseCssOptions } from "./css.js";
import { readNames } from "./data.js";
import type { Bucket, EdgeCache } from "./env.js";
import {
  ApiError,
  errorResponse,
  preflight,
  respond,
  StorageError,
} from "./http.js";
import { manifestLoader, type SetEntry } from "./manifest.js";
import { parseNames, searchable } from "./params.js";
import {
  createSearch,
  SearchError,
  type SearchOptions,
} from "./search/handler.js";
import { parseSvgOptions, svgBody, svgOptionsKey } from "./svg.js";

export interface HandlerOptions {
  bucket: Bucket;
  cache: EdgeCache;
  /** Метка сборки — в ключе кэша и в заголовке X-Iconavo-Build. */
  build: string;
  now?: () => number;
  /** Сообщения об ошибках — в журнал Workers; без адресов и IP (ADR-0028). */
  log?: (message: string) => void;
  /** Поиск (ADR-0049); нет — /search отвечает 503. */
  search?: SearchOptions;
}

export type Handler = (
  request: Request,
  waitUntil: (promise: Promise<unknown>) => void,
) => Promise<Response>;

type Route =
  | { kind: "json" | "css"; set: string }
  | { kind: "svg"; set: string; name: string };

/** Что отвечать: ключ кэша, имена для чтения из R2 и сборка тела; null — иконки нет. */
interface Plan {
  set: string;
  /** Имя иконки у адреса SVG — для сообщения «не найдена». */
  icon?: string;
  path: string;
  params: URLSearchParams;
  names: readonly string[];
  headers: Record<string, string>;
  body: (
    files: ReadonlyMap<string, IconavoIconSet | null>,
    entry: SetEntry,
  ) => string | null;
}

const BATCH = /^\/([a-z0-9-]+)\.json$/;
const CSS = /^\/([a-z0-9-]+)\.css$/;
const SVG = /^\/([a-z0-9-]+)\/([a-z0-9-]+)\.svg$/;

const setNotFound = (set: string) =>
  new ApiError(404, "set_not_found", `Icon set "${set}" not found`);

/** Путь сверяется как есть: «/lucide.json/» и закодированные буквы — 404. */
function route(pathname: string): Route {
  const svg = SVG.exec(pathname);
  const batch = BATCH.exec(pathname);
  const css = CSS.exec(pathname);
  const set = (svg ?? batch ?? css)?.[1];
  if (set === undefined) {
    throw new ApiError(
      404,
      "not_found",
      "Unknown address: use /{set}.json?icons=a,b, /{set}/{icon}.svg, /{set}.css?icons=a,b or /search?query=…",
    );
  }
  if (!isValidNamePart(set)) throw setNotFound(set);
  if (svg) return { kind: "svg", set, name: svg[2] as string };
  return { kind: batch ? "json" : "css", set };
}

function planFor(r: Route, query: URLSearchParams): Plan {
  if (r.kind === "svg") {
    const o = parseSvgOptions(query);
    const { name } = r;
    return {
      set: r.set,
      icon: name,
      path: `/${r.set}/${name}.svg`,
      params: svgOptionsKey(o),
      names: searchable(name) ? [name] : [],
      headers: {
        "content-type": TYPES.svg,
        "content-security-policy": SVG_CSP,
        ...(o.download
          ? { "content-disposition": `attachment; filename="${name}.svg"` }
          : {}),
      },
      body: (files) => {
        const file = files.get(name);
        return file ? svgBody(file, name, o) : null;
      },
    };
  }
  const names = parseNames(query);
  const params = new URLSearchParams({ icons: names.join(",") });
  const read = names.filter(searchable);
  if (r.kind === "json") {
    return {
      set: r.set,
      path: `/${r.set}.json`,
      params,
      names: read,
      headers: { "content-type": TYPES.json },
      body: (files, entry) => batchBody(r.set, entry, names, files),
    };
  }
  const o = parseCssOptions(query);
  for (const [key, value] of cssOptionsKey(o)) params.set(key, value);
  return {
    set: r.set,
    path: `/${r.set}.css`,
    params,
    names: read,
    headers: {
      "content-type": TYPES.css,
      ...(o.download
        ? { "content-disposition": `attachment; filename="${r.set}.css"` }
        : {}),
    },
    body: (files) => cssBody(r.set, names, files, o),
  };
}

export function createHandler(options: HandlerOptions): Handler {
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? (() => {});
  const manifest = manifestLoader(options.bucket, now, log, options.cache);
  const search = createSearch(
    { cache: options.cache, build: options.build, manifest, now, log },
    options.search ?? {},
  );
  return async (request, waitUntil) => {
    const head = request.method === "HEAD";
    try {
      if (request.method === "OPTIONS") return preflight();
      if (request.method !== "GET" && !head) {
        throw new ApiError(
          405,
          "method_not_allowed",
          `Method ${request.method} is not allowed: use GET`,
        );
      }
      const url = new URL(request.url);
      if (url.pathname === "/search") {
        return await search(request, url, waitUntil, head);
      }
      const plan = planFor(route(url.pathname), url.searchParams);
      const entry = (await manifest()).get(plan.set);
      if (entry === undefined) throw setNotFound(plan.set);
      const meta = {
        "x-iconavo-build": options.build,
        "x-iconavo-version": entry.version,
      };
      const key =
        plan.names.length === 0
          ? undefined
          : cacheKey(options.build, entry.version, plan.path, plan.params);
      if (key !== undefined) {
        const hit = await options.cache.match(key);
        if (hit !== undefined) {
          const response = new Response(head ? null : hit.body, hit);
          response.headers.set("x-cache", "HIT");
          return response;
        }
      }
      const files = await readNames(
        options.bucket,
        entry.version,
        plan.set,
        plan.names,
      );
      const body = plan.body(files, entry);
      if (body === null) {
        return errorResponse(
          new ApiError(
            404,
            "icon_not_found",
            `Icon "${plan.set}:${plan.icon}" not found`,
          ),
          head,
          meta,
        );
      }
      const headers = { ...plan.headers, "cache-control": CACHE_OK, ...meta };
      if (key !== undefined) {
        waitUntil(
          options.cache
            .put(key, respond(body, 200, headers, false))
            .catch((e: Error) => log(`кэш не записан: ${e.message}`)),
        );
      }
      return respond(body, 200, { ...headers, "x-cache": "MISS" }, head);
    } catch (e) {
      if (e instanceof ApiError) {
        // Лимит частоты — ждать минуту; браузеру отказ не запоминать.
        return errorResponse(
          e,
          head,
          e.status === 429
            ? { "cache-control": "no-store", "retry-after": "60" }
            : {},
        );
      }
      if (e instanceof SearchError) {
        log(`поиск: ${e.message}`);
        return errorResponse(
          new ApiError(
            503,
            "search_unavailable",
            "Search is temporarily unavailable, retry later",
          ),
          head,
          { "retry-after": "30" },
        );
      }
      if (e instanceof StorageError) {
        log(`R2: ${e.message}`);
        return errorResponse(
          new ApiError(
            503,
            "storage_unavailable",
            "Icon storage is temporarily unavailable, retry later",
          ),
          head,
          { "retry-after": "30" },
        );
      }
      log(`ошибка: ${(e as Error).message}`);
      return errorResponse(
        new ApiError(500, "internal_error", "Internal error"),
        head,
      );
    }
  };
}
