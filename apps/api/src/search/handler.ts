// Поиск /search (ADR-0049, ADR-0040, ADR-0027):
// 1. Готовый ответ в кэше дата-центра — сразу (ключ: сборка, версия индекса, параметры).
// 2. Мимо кэша — лимит частоты с одного адреса.
// 3. Вектор запроса в кэше дата-центра — сразу гибрид слов и смысла.
// 4. Иначе одновременно: поиск по словам и фраза каталога из бакета. Фраза нашлась и гибрид успел к
//    сроку (≈ 0,25 с) — полная выдача; фразы нет — выдача по словам с пометкой pending, как только
//    слова готовы: модель к сроку не успеет. Вектор от Polza и полная выдача досчитываются в фоне и
//    ложатся в кэш: повторный запрос через секунду — полный.
// 5. Polza недавно не ответила или нет ключа — выдача по словам с пометкой text, не ошибка;
//    Meilisearch недоступен — 503.
// Неполная выдача не кэшируется нигде. В журнал не попадают ни запрос, ни адрес (ADR-0028).

import {
  exactQuery,
  mainQuery,
  pageResults,
  SEARCH_MODEL,
  SEARCH_RATE,
  SEMANTIC_RATIO,
  type SearchHit,
  type SemanticState,
  searchResponse,
  vectorHash,
} from "@iconavo-ui/search";
import { cacheKey } from "../cache.js";
import {
  MEILI_TIMEOUT_MS,
  MODEL_RETRY_MS,
  MODEL_TIMEOUT_MS,
  SEARCH_CACHE_BROWSER,
  SEARCH_CACHE_EDGE,
  SEARCH_DEADLINE_MS,
  TYPES,
} from "../config.js";
import type { Bucket, EdgeCache, RateLimiter } from "../env.js";
import { ApiError, respond } from "../http.js";
import { compactJson, type Json } from "../json.js";
import type { Manifest } from "../manifest.js";
import { indexVersionLoader } from "./index-version.js";
import { type MeiliConfig, multiSearch, SearchError } from "./meili.js";
import { parseSearchParams, searchCacheParams } from "./params.js";
import {
  cachedVector,
  modelVector,
  rememberVector,
  storedVector,
  type VectorSource,
} from "./vectors.js";

export { SearchError } from "./meili.js";

/** Привязки и ключи поиска; нет Meilisearch — /search отвечает 503. */
export interface SearchOptions {
  bucket?: Bucket;
  limiter?: RateLimiter;
  meili?: MeiliConfig;
  polzaKey?: string;
  fetch?: typeof fetch;
  /** Срок первого ответа, мс; тесты ставят свой. */
  deadlineMs?: number;
}

/** Что поиск берёт у обработчика API. */
export interface SearchContext {
  cache: EdgeCache;
  build: string;
  manifest: () => Promise<Manifest>;
  now: () => number;
  log: (message: string) => void;
}

export type SearchRoute = (
  request: Request,
  url: URL,
  waitUntil: (promise: Promise<unknown>) => void,
  head: boolean,
) => Promise<Response>;

interface Lists {
  exact: SearchHit[];
  main: SearchHit[];
}

type VectorResult =
  | { vector: Float32Array; source: VectorSource }
  | { error: string };

const TIMEOUT = Symbol("timeout");

/** Обещание или TIMEOUT, если оно не успело за ms. */
function within<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Ключ лимита частоты: IPv4 — адрес, IPv6 — сеть /64: у одного абонента обычно целая сеть. Адрес
 * нигде не хранится, кроме счётчика Cloudflare.
 */
export function limitKey(ip: string | null): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  // IPv4 внутри IPv6 (::ffff:1.2.3.4) — как IPv4.
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const [head = "", tail] = ip.toLowerCase().split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros = Math.max(0, 8 - left.length - right.length);
  const groups = [...left, ...Array<string>(zeros).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

export function createSearch(
  ctx: SearchContext,
  options: SearchOptions,
): SearchRoute {
  const fetchFn = options.fetch ?? fetch;
  const deadlineMs = options.deadlineMs ?? SEARCH_DEADLINE_MS;
  const indexVersion = indexVersionLoader(
    options.bucket,
    ctx.now,
    ctx.log,
    ctx.cache,
  );
  /**
   * Когда модель последний раз не дала вектор: MODEL_RETRY_MS после этого новые запросы без фразы
   * в бакете сразу получают text и Polza не зовут — иначе при сбое модели они получали бы pending,
   * и повтор ничего бы не дал. Своё у каждой копии функции.
   */
  let modelFailedAt: number | undefined;

  return async (request, url, waitUntil, head) => {
    const started = ctx.now();
    const timings: string[] = [];
    const mark = (name: string, from: number, desc?: string) => {
      timings.push(
        `${name};${desc === undefined ? "" : `desc="${desc}";`}dur=${Math.round(ctx.now() - from)}`,
      );
    };
    // Манифест и версия индекса — одновременно: у холодной копии функции это два чтения хранилища.
    const indexStarted = ctx.now();
    const versionP = indexVersion();
    const manifest = await ctx.manifest();
    const p = parseSearchParams(url.searchParams, (id) => manifest.has(id));
    const version = await versionP;
    mark("index", indexStarted);
    const meta = { "x-iconavo-build": ctx.build, "x-iconavo-index": version };
    const key = cacheKey(ctx.build, version, "/search", searchCacheParams(p));
    const hit = await ctx.cache.match(key);
    if (hit !== undefined) {
      const response = new Response(head ? null : hit.body, hit);
      response.headers.set("cache-control", SEARCH_CACHE_BROWSER);
      response.headers.set("x-cache", "HIT");
      return response;
    }

    // Лимит частоты — только мимо кэша; сбой счётчика поиск не останавливает.
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
          `Too many searches: at most ${SEARCH_RATE.limit} per minute from one address, retry later`,
        );
      }
    }
    const meili = options.meili;
    if (!meili) throw new SearchError("нет ключей Meilisearch");

    const run = async (vector?: Float32Array): Promise<Lists> => {
      const body = [
        ...(p.exact === undefined ? [] : [exactQuery(p.exact, p.filters)]),
        mainQuery({
          q: p.text,
          filters: p.filters,
          ...(p.exact === undefined ? {} : { exclude: p.exact }),
          start: p.start,
          limit: p.limit,
          ...(vector === undefined
            ? {}
            : { vector, semanticRatio: SEMANTIC_RATIO }),
        }),
      ];
      const lists = await multiSearch(fetchFn, meili, body, MEILI_TIMEOUT_MS);
      return {
        exact: p.exact === undefined ? [] : (lists[0] ?? []),
        main: lists[lists.length - 1] ?? [],
      };
    };
    const render = (lists: Lists, semantic: SemanticState) =>
      compactJson(
        searchResponse(
          pageResults(lists.exact, lists.main, p.start, p.limit),
          { start: p.start, limit: p.limit },
          semantic,
        ) as unknown as Json,
      );
    const headersOf = (cacheControl: string) => ({
      "content-type": TYPES.json,
      "cache-control": cacheControl,
      "timing-allow-origin": "*",
      ...meta,
    });
    const storeFull = (body: string) =>
      ctx.cache
        .put(key, respond(body, 200, headersOf(SEARCH_CACHE_EDGE), false))
        .catch((e: Error) => ctx.log(`кэш поиска не записан: ${e.message}`));
    const remember = (vector: Float32Array, hash: string) =>
      rememberVector(ctx.cache, hash, vector).catch((e: Error) =>
        ctx.log(`вектор запроса не запомнен: ${e.message}`),
      );
    const finish = (lists: Lists, semantic: SemanticState) => {
      const body = render(lists, semantic);
      timings.push(`total;dur=${Math.round(ctx.now() - started)}`);
      if (semantic === "full") waitUntil(storeFull(body));
      return respond(
        body,
        200,
        {
          ...headersOf(semantic === "full" ? SEARCH_CACHE_BROWSER : "no-store"),
          "x-cache": "MISS",
          "server-timing": timings.join(", "),
        },
        head,
      );
    };

    const hash = await vectorHash(SEARCH_MODEL.id, p.text);
    // Вектор уже в кэше дата-центра — сразу гибрид, без поиска по словам впереди.
    const cacheStarted = ctx.now();
    const cached =
      p.text === ""
        ? undefined
        : await cachedVector(ctx.cache, hash).catch(() => undefined);
    if (cached !== undefined) {
      mark("vector", cacheStarted, "cache");
      const meiliStarted = ctx.now();
      const lists = await run(cached);
      mark("meili", meiliStarted);
      return finish(lists, "full");
    }

    // Слова — сразу; вектор — фраза каталога из бакета. Фразы нет — вектор считает модель, а это
    // секунда и больше: к сроку он не успеет, поэтому слова уходят, как только готовы, а модель
    // и полная выдача — в фоне (замер скорости 26 октября 2026).
    const textStarted = ctx.now();
    const textP = run();
    textP.catch(() => {});
    const vectorStarted = ctx.now();
    const storedP: Promise<Float32Array | undefined> = (async () => {
      if (p.text === "") return undefined;
      try {
        return await storedVector(options.bucket, hash);
      } catch (e) {
        ctx.log(`вектор фразы не прочитан: ${(e as Error).message}`);
        return undefined;
      }
    })();
    const modelDown = () =>
      modelFailedAt !== undefined && ctx.now() - modelFailedAt < MODEL_RETRY_MS;
    const vectorP: Promise<VectorResult> = (async () => {
      const stored = await storedP;
      if (stored) return { vector: stored, source: "store" };
      if (p.text === "" || !options.polzaKey || modelDown()) {
        return { error: "без модели" };
      }
      try {
        const vector = await modelVector(
          fetchFn,
          options.polzaKey,
          p.text,
          MODEL_TIMEOUT_MS,
        );
        return { vector, source: "model" };
      } catch (e) {
        modelFailedAt = ctx.now();
        ctx.log(`вектор запроса: ${(e as Error).message}`);
        return { error: (e as Error).message };
      }
    })();
    const remaining = () => Math.max(0, started + deadlineMs - ctx.now());
    /** Ответ ушёл раньше смысла: вектор и полная выдача — в фоне, в кэш дата-центра. */
    const background = (fullP?: Promise<Lists>) => {
      waitUntil(
        (async () => {
          const got = await vectorP;
          if (!("vector" in got)) return;
          await remember(got.vector, hash);
          await storeFull(render(await (fullP ?? run(got.vector)), "full"));
        })().catch((e: Error) => ctx.log(`фоновый поиск: ${e.message}`)),
      );
    };
    const textOnly = async (semantic: "pending" | "text") => {
      const lists = await textP;
      mark("meili", textStarted);
      return finish(lists, semantic);
    };

    const stored = await within(storedP, remaining());
    if (stored === TIMEOUT) {
      mark("vector", vectorStarted, "pending");
      background();
      return textOnly("pending");
    }
    if (stored === undefined) {
      // Без ключа, без текста или пока модель не отвечает — только слова; иначе — модель в фоне.
      if (p.text === "" || !options.polzaKey || modelDown()) {
        mark("vector", vectorStarted, "error");
        if (!options.polzaKey) ctx.log("вектор запроса: нет ключа Polza");
        return textOnly("text");
      }
      mark("vector", vectorStarted, "pending");
      background();
      return textOnly("pending");
    }
    mark("vector", vectorStarted, "store");
    waitUntil(remember(stored, hash));
    const fullStarted = ctx.now();
    const fullP = run(stored);
    fullP.catch(() => {});
    const full = await within(fullP, remaining()).catch(() => undefined);
    if (full === undefined) {
      ctx.log("гибрид не ответил — выдача по словам");
      return textOnly("text");
    }
    if (full !== TIMEOUT) {
      mark("meili", fullStarted);
      return finish(full, "full");
    }
    // Смысл не успел к сроку: что придёт первым — слова или полная выдача.
    background(fullP);
    const first = await Promise.any([
      fullP.then((lists) => ({ lists, semantic: "full" as const })),
      textP.then((lists) => ({ lists, semantic: "pending" as const })),
    ]).catch(() => {
      throw new SearchError("Meilisearch не ответил");
    });
    mark("meili", fullStarted);
    return finish(first.lists, first.semantic);
  };
}
