// Сведения об одной иконке /icon?icon=набор:иконка (шаг 4 фазы 4; ADR-0041, ADR-0024): боковая панель
// и страница иконки на сайте, потом MCP (шаг 10).
// - Файл имени из R2 (тот же readNames, что у пачек, с кэшем файлов): каноническое имя после алиаса,
//   скрытая ли иконка, рисунок — по нему правило ядра решает, меняет ли его толщина линии.
// - Оглавление каталога: набор, автор, лицензия, таблица стилей и части от других авторов.
// - Индекс поиска: карточка с описаниями (multi-search с фильтром names), затем похожие по её вектору —
//   их внутри multi-search не спросить. Скрытой и ещё не проиндексированной иконки в индексе нет.
// Готовый ответ — в кэше дата-центра по ключу «сборка, версия набора, версия индекса, оглавление»:
// новый выпуск, индекс или сборка дают новые ключи (ADR-0023). Лимит частоты — свой и только мимо
// кэша. Meilisearch не ответил — 503, как у поиска.

import { hasStrokeWidth, isValidIconName } from "@iconavo-ui/core/internal";
import {
  cardVariants,
  ICON_RATE,
  type IconCredit,
  type IconDetails,
  type IconHit,
  iconQuery,
  parseIconResult,
  parseSimilar,
  shownInStyle,
  similarBody,
  styleOf,
} from "@iconavo-ui/search";
import { cacheKey } from "./cache.js";
import {
  type CatalogIndexLoader,
  catalogOf,
  type IndexEntry,
} from "./catalog.js";
import {
  CATALOG_CACHE_BROWSER,
  CATALOG_CACHE_EDGE,
  MEILI_TIMEOUT_MS,
  TYPES,
} from "./config.js";
import { readNames, storeNames } from "./data.js";
import type { Bucket, EdgeCache, RateLimiter } from "./env.js";
import { ApiError, respond, StorageError } from "./http.js";
import { compactJson, type Json } from "./json.js";
import type { Manifest } from "./manifest.js";
import { single } from "./params.js";
import { limitKey } from "./search/handler.js";
import {
  type MeiliConfig,
  multiSearchJson,
  SearchError,
  similarJson,
} from "./search/meili.js";

export interface IconContext {
  bucket: Bucket;
  cache: EdgeCache;
  build: string;
  manifest: () => Promise<Manifest>;
  catalog: CatalogIndexLoader;
  indexVersion: () => Promise<string>;
  now: () => number;
  log: (message: string) => void;
}

export interface IconOptions {
  meili?: MeiliConfig;
  limiter?: RateLimiter;
  fetch?: typeof fetch;
}

export type IconRoute = (
  request: Request,
  url: URL,
  waitUntil: (promise: Promise<unknown>) => void,
  head: boolean,
) => Promise<Response>;

/** Самое длинное имя `набор:иконка`: по 64 знака на часть и двоеточие. */
const MAX_ICON_PARAM = 129;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Набор иконки — из IconifyInfo оглавления, только нужное ответу. */
function setSummary(prefix: string, entry: IndexEntry): IconDetails["set"] {
  const info = entry.info;
  const author = isObject(info.author) ? info.author : {};
  const license = isObject(info.license) ? info.license : {};
  return {
    prefix,
    name: String(info.name ?? prefix),
    author: {
      name: String(author.name ?? ""),
      ...(typeof author.url === "string" ? { url: author.url } : {}),
    },
    license: {
      title: String(license.title ?? license.spdx ?? ""),
      spdx: String(license.spdx ?? ""),
      ...(typeof license.url === "string" ? { url: license.url } : {}),
    },
    palette: info.palette === true,
    ...(entry.credits !== undefined && entry.credits.length > 0
      ? {
          credits: entry.credits.map((c) => ({
            name: c.name,
            author: c.author,
            license: c.license,
            url: c.url,
          })),
        }
      : {}),
  };
}

/** Описания и синонимы на обоих языках или ничего: обогащение даёт их парой (ADR-0046). */
function texts(hit: IconHit | undefined) {
  const en = hit?.about.en;
  const ru = hit?.about.ru;
  if (en === undefined || ru === undefined) {
    return { description: null, synonyms: null };
  }
  return {
    description: { en: en.description, ru: ru.description },
    synonyms: { en: en.synonyms, ru: ru.synonyms },
  };
}

export function createIcon(ctx: IconContext, options: IconOptions): IconRoute {
  const fetchFn = options.fetch ?? fetch;

  return async (request, url, waitUntil, head) => {
    const started = ctx.now();
    const name = single(url.searchParams, "icon", MAX_ICON_PARAM);
    if (name === undefined) {
      throw new ApiError(
        400,
        "icon_required",
        'Parameter "icon" with an icon name such as lucide:house is required',
      );
    }
    if (!isValidIconName(name)) {
      throw new ApiError(
        400,
        "invalid_icon",
        `Invalid icon name "${name}": use set:icon, such as lucide:house`,
      );
    }
    const at = name.indexOf(":");
    const prefix = name.slice(0, at);
    const requested = name.slice(at + 1);

    const versionP = ctx.indexVersion();
    const manifest = await ctx.manifest();
    const set = manifest.get(prefix);
    if (set === undefined) {
      throw new ApiError(
        404,
        "set_not_found",
        `Icon set "${prefix}" not found`,
      );
    }
    const catalog = catalogOf(manifest);
    const entry = (await ctx.catalog(catalog)).sets.get(prefix);
    if (entry === undefined) {
      throw new StorageError(`набора «${prefix}» нет в оглавлении ${catalog}`);
    }
    const index = await versionP;
    const meta: Record<string, string> = {
      "x-iconavo-build": ctx.build,
      "x-iconavo-version": set.version,
      "x-iconavo-index": index,
      ...(entry.content === undefined
        ? {}
        : { "x-iconavo-content": entry.content }),
    };
    const key = cacheKey(
      ctx.build,
      `${set.version}-${index}-${catalog}`,
      "/icon",
      new URLSearchParams({ icon: name }),
    );
    let cacheOk = true;
    let hit: Response | undefined;
    try {
      hit = await ctx.cache.match(key);
    } catch (e) {
      ctx.log(`кэш не прочитан: ${(e as Error).message}`);
      cacheOk = false;
    }
    if (hit !== undefined) {
      const response = new Response(head ? null : hit.body, hit);
      response.headers.set("cache-control", CATALOG_CACHE_BROWSER);
      response.headers.set("x-cache", "HIT");
      return response;
    }

    // Лимит частоты — только мимо кэша; сбой счётчика ответ не останавливает.
    if (options.limiter) {
      let allowed = true;
      try {
        allowed = (
          await options.limiter.limit({
            key: limitKey(request.headers.get("cf-connecting-ip")),
          })
        ).success;
      } catch (e) {
        ctx.log(`лимит частоты не ответил: ${(e as Error).message}`);
      }
      if (!allowed) {
        throw new ApiError(
          429,
          "rate_limited",
          `Too many requests: at most ${ICON_RATE.limit} icon details per minute from one address, retry later`,
        );
      }
    }
    const meili = options.meili;
    if (!meili) throw new SearchError("нет ключей Meilisearch");

    const timings: string[] = [];
    const mark = (label: string, from: number) =>
      timings.push(`${label};dur=${Math.round(ctx.now() - from)}`);

    const filesStarted = ctx.now();
    const read = await readNames(ctx.bucket, set.version, prefix, [requested], {
      ...(cacheOk ? { cache: ctx.cache } : {}),
      now: ctx.now,
      log: ctx.log,
    });
    mark("files", filesStarted);
    const file = read.files.get(requested);
    const canonical = file ? Object.keys(file.icons)[0] : undefined;
    const icon = canonical === undefined ? undefined : file?.icons[canonical];
    if (canonical === undefined || icon === undefined) {
      throw new ApiError(404, "icon_not_found", `Icon "${name}" not found`);
    }
    const full = `${prefix}:${canonical}`;

    const meiliStarted = ctx.now();
    const [result] = await multiSearchJson(
      fetchFn,
      meili,
      [iconQuery(full)],
      MEILI_TIMEOUT_MS,
    );
    let card: IconHit | undefined;
    try {
      card = parseIconResult(result);
    } catch {
      throw new SearchError("Meilisearch: карточка не по форме");
    }
    mark("meili", meiliStarted);
    const variants = card ? cardVariants(card, entry.styles) : [];
    const style = styleOf(full, variants);
    let similar: string[] = [];
    if (card !== undefined) {
      const similarStarted = ctx.now();
      const json = await similarJson(
        fetchFn,
        meili,
        similarBody(card.icon),
        MEILI_TIMEOUT_MS,
      );
      if (json === undefined) {
        ctx.log(`похожих нет: ${card.icon}`);
      } else {
        try {
          similar = parseSimilar(json)
            .filter((h) => h.icon !== card?.icon)
            .map((h) => shownInStyle(h, style));
        } catch {
          throw new SearchError("Meilisearch: похожие не по форме");
        }
      }
      mark("similar", similarStarted);
    }

    const credits: IconCredit[] = (entry.credits ?? [])
      .filter((c) => c.icons.includes(canonical))
      .map((c) => ({
        name: c.name,
        author: c.author,
        license: c.license,
        url: c.url,
      }));
    const details: IconDetails = {
      icon: full,
      ...(canonical === requested ? {} : { alias: name }),
      ...(icon.hidden === true ? { hidden: true as const } : {}),
      set: setSummary(prefix, entry),
      card: card?.icon ?? null,
      style,
      variants,
      tones: card ? card.tones.map((t) => `${prefix}:${t}`) : [],
      strokes: hasStrokeWidth(icon.body),
      ...texts(card),
      tags: card?.about.tags ?? [],
      ...(credits.length > 0 ? { credits } : {}),
      similar,
    };
    const body = compactJson(details as unknown as Json);
    const headers = {
      "content-type": TYPES.json,
      "timing-allow-origin": "*",
      ...meta,
    };
    if (cacheOk) {
      waitUntil(
        (async () => {
          await ctx.cache
            .put(
              key,
              respond(
                body,
                200,
                { ...headers, "cache-control": CATALOG_CACHE_EDGE },
                false,
              ),
            )
            .catch((e: Error) => ctx.log(`кэш не записан: ${e.message}`));
          await storeNames(ctx.cache, set.version, prefix, read, ctx.log);
        })(),
      );
    }
    timings.push(`total;dur=${Math.round(ctx.now() - started)}`);
    return respond(
      body,
      200,
      {
        ...headers,
        "cache-control": CATALOG_CACHE_BROWSER,
        "x-cache": "MISS",
        "server-timing": timings.join(", "),
      },
      head,
    );
  };
}
