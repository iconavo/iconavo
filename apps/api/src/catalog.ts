// Каталог наборов (шаг 2 фазы 4; ADR-0004, ADR-0024): /collections, /collection и /last-modified —
// как у Iconify — и наш /changelog. Данные — файлы каталога в R2 (pnpm cdn build): оглавление — по полю
// catalog манифеста, тела /collection — готовые ответы, функция их не разбирает (10 мс процессора
// бесплатного тарифа). Имя файла каталога — отпечаток содержимого, файл не меняется: оглавление живёт в
// памяти, пока жива копия функции, а готовые ответы — в кэше дата-центра по ключу с отпечатком
// оглавления; новый каталог — новые ключи, сбрасывать ничего не нужно (ADR-0023). В адресах версии нет,
// поэтому браузеру — 5 минут, как манифест. Параметры prefix и prefixes — как у Iconify: имя, список
// через запятую, «mdi-» — начало имени; неизвестные параметры (pretty) не читаются.

import { isValidNamePart } from "@iconavo-ui/core/internal";
import { isStyle, type StyleTable } from "@iconavo-ui/search";
import { cacheKey, sharedText } from "./cache.js";
import {
  CATALOG_CACHE_BROWSER,
  CATALOG_CACHE_EDGE,
  CATALOG_DIR,
  CATALOG_PATTERN,
  TYPES,
} from "./config.js";
import type { Bucket, EdgeCache } from "./env.js";
import { ApiError, respond, StorageError } from "./http.js";
import { compactJson, type Json } from "./json.js";
import type { Manifest } from "./manifest.js";
import { parseBool, single } from "./params.js";

type JsonObject = { [key: string]: Json };

/** Адрес каталога → его вид. Map: путь из запроса не должен найти что-то в прототипе объекта. */
export const CATALOG_ROUTES: ReadonlyMap<string, CatalogKind> = new Map([
  ["/collections", "collections"],
  ["/collection", "collection"],
  ["/last-modified", "last-modified"],
  ["/changelog", "changelog"],
]);

export type CatalogKind =
  | "collections"
  | "collection"
  | "last-modified"
  | "changelog";

/** Часть набора от другого автора — запись credits оглавления (ADR-0017). */
export interface CatalogCredit {
  name: string;
  author: string;
  url: string;
  license: string;
  icons: string[];
}

export interface IndexEntry {
  /** Отпечаток тела /collection: catalog/{набор}/{хэш}.json. */
  collection: string;
  /** IconifyInfo набора. */
  info: JsonObject;
  /** Полный текст лицензии, NOTICE, источник, ревизия — дополнение к info.license. */
  license: JsonObject;
  /** Отпечаток содержимого набора (шаг 4 фазы 4); нет — каталог до шага 4. */
  content?: string;
  /** Таблица стилей: стиль → суффиксы с дефисом в порядке показа (ADR-0052). */
  styles?: StyleTable;
  credits?: CatalogCredit[];
}

export interface CatalogIndex {
  /** Отпечаток файла выпусков: catalog/changelog/{хэш}.json. */
  changelog: string;
  sets: ReadonlyMap<string, IndexEntry>;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const SUFFIX = /^(-[a-z0-9]+)*$/;

/** Таблица стилей записи; не по форме — undefined, и запись неверна. */
function stylesOf(value: unknown): StyleTable | undefined {
  if (!isObject(value)) return undefined;
  const out: StyleTable = {};
  for (const [style, list] of Object.entries(value)) {
    if (
      !isStyle(style) ||
      !isStrings(list) ||
      !list.every((s) => SUFFIX.test(s))
    )
      return undefined;
    out[style] = list;
  }
  return out;
}

/** Части от других авторов; не по форме — undefined. */
function creditsOf(value: unknown): CatalogCredit[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: CatalogCredit[] = [];
  for (const c of value) {
    if (
      !isObject(c) ||
      typeof c.name !== "string" ||
      typeof c.author !== "string" ||
      typeof c.url !== "string" ||
      typeof c.license !== "string" ||
      !isStrings(c.icons)
    ) {
      return undefined;
    }
    out.push({
      name: c.name,
      author: c.author,
      url: c.url,
      license: c.license,
      icons: c.icons,
    });
  }
  return out;
}

/** Оглавление по тексту; не тот формат — ошибка хранилища. */
export function parseCatalogIndex(text: string): CatalogIndex {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new StorageError("оглавление каталога не JSON");
  }
  if (
    !isObject(data) ||
    typeof data.changelog !== "string" ||
    !CATALOG_PATTERN.test(data.changelog) ||
    !isObject(data.sets)
  ) {
    throw new StorageError("оглавление каталога не по формату");
  }
  const sets = new Map<string, IndexEntry>();
  for (const [id, entry] of Object.entries(data.sets)) {
    if (
      !isValidNamePart(id) ||
      !isObject(entry) ||
      typeof entry.collection !== "string" ||
      !CATALOG_PATTERN.test(entry.collection) ||
      !isObject(entry.info) ||
      !isObject(entry.info.license) ||
      !isObject(entry.license)
    ) {
      throw new StorageError(`в оглавлении каталога неверная запись «${id}»`);
    }
    const styles =
      entry.styles === undefined ? undefined : stylesOf(entry.styles);
    const credits =
      entry.credits === undefined ? undefined : creditsOf(entry.credits);
    if (
      (entry.content !== undefined &&
        (typeof entry.content !== "string" ||
          !CATALOG_PATTERN.test(entry.content))) ||
      (entry.styles !== undefined && styles === undefined) ||
      (entry.credits !== undefined && credits === undefined)
    ) {
      throw new StorageError(`в оглавлении каталога неверная запись «${id}»`);
    }
    sets.set(id, {
      collection: entry.collection,
      info: entry.info,
      license: entry.license,
      ...(typeof entry.content === "string" ? { content: entry.content } : {}),
      ...(styles === undefined ? {} : { styles }),
      ...(credits === undefined ? {} : { credits }),
    });
  }
  return { changelog: data.changelog, sets };
}

/**
 * Фильтр по prefix и prefixes, как у Iconify: точное имя или, с «-» на конце, начало имени; оба
 * параметра складываются. Нет обоих — undefined, подходят все.
 */
export function prefixFilter(
  query: URLSearchParams,
): { match: (id: string) => boolean; params: URLSearchParams } | undefined {
  const one = single(query, "prefix");
  const many = single(query, "prefixes", Number.POSITIVE_INFINITY);
  if (one === undefined && many === undefined) return undefined;
  const wanted = [
    ...new Set([
      ...(one === undefined ? [] : [one]),
      ...(many ?? "").split(",").filter((p) => p !== ""),
    ]),
  ].sort();
  return {
    match: (id) =>
      wanted.some((w) => (w.endsWith("-") ? id.startsWith(w) : id === w)),
    params: new URLSearchParams({ prefixes: wanted.join(",") }),
  };
}

export interface CatalogContext {
  bucket: Bucket;
  cache: EdgeCache;
  build: string;
  manifest: () => Promise<Manifest>;
  log: (message: string) => void;
  /** Общий с /icon загрузчик оглавлений; нет — свой. */
  index?: CatalogIndexLoader;
}

/** Оглавление по отпечатку. */
export type CatalogIndexLoader = (hash: string) => Promise<CatalogIndex>;

/** Файл каталога из R2; нет или не прочитан — ошибка хранилища. */
export async function readCatalogText(
  bucket: Bucket,
  key: string,
): Promise<string> {
  let text: string | undefined;
  try {
    text = await (await bucket.get(key))?.text();
  } catch (e) {
    throw new StorageError(`${key} не прочитан: ${(e as Error).message}`);
  }
  if (text === undefined) throw new StorageError(`${key} нет в R2`);
  return text;
}

/**
 * Загрузчик оглавлений: из памяти копии функции, затем из кэша дата-центра (30 дней — файл
 * неизменяем), затем из R2. Хватит двух в памяти — текущего и прежнего.
 */
export function catalogIndexLoader(
  bucket: Bucket,
  cache: EdgeCache,
): CatalogIndexLoader {
  const indexes = new Map<string, CatalogIndex>();
  return async (hash) => {
    const known = indexes.get(hash);
    if (known !== undefined) return known;
    const key = `${CATALOG_DIR}/${hash}.json`;
    const text = await sharedText(
      cache,
      key,
      () => readCatalogText(bucket, key),
      CATALOG_CACHE_EDGE,
    );
    const index = parseCatalogIndex(text ?? "");
    const oldest = indexes.keys().next().value;
    if (indexes.size >= 2 && oldest !== undefined) indexes.delete(oldest);
    indexes.set(hash, index);
    return index;
  };
}

export type CatalogRoute = (
  kind: CatalogKind,
  query: URLSearchParams,
  head: boolean,
  waitUntil: (promise: Promise<unknown>) => void,
) => Promise<Response>;

/** Отпечаток оглавления из манифеста; манифест до шага 2 фазы 4 — каталога ещё нет. */
export function catalogOf(manifest: Manifest): string {
  if (manifest.catalog === undefined) {
    throw new StorageError("в манифесте нет catalog — каталог ещё не выложен");
  }
  return manifest.catalog;
}

/** info набора с полным текстом лицензии — для /collection?info=true. */
const fullInfo = (entry: IndexEntry): JsonObject => ({
  ...entry.info,
  license: { ...(entry.info.license as JsonObject), ...entry.license },
});

export function createCatalog(ctx: CatalogContext): CatalogRoute {
  const loadIndex = ctx.index ?? catalogIndexLoader(ctx.bucket, ctx.cache);
  const readText = (key: string) => readCatalogText(ctx.bucket, key);

  const headersOf = (
    version: string,
    content?: string,
  ): Record<string, string> => ({
    "content-type": TYPES.json,
    "cache-control": CATALOG_CACHE_BROWSER,
    "timing-allow-origin": "*",
    "x-iconavo-build": ctx.build,
    ...(version === "" ? {} : { "x-iconavo-version": version }),
    ...(content === undefined ? {} : { "x-iconavo-content": content }),
  });

  /** Готовый ответ из кэша дата-центра или собранный make и положенный туда после ответа. */
  async function cached(
    key: Request,
    make: () => Promise<{ body: string; version: string; content?: string }>,
    head: boolean,
    waitUntil: (promise: Promise<unknown>) => void,
  ): Promise<Response> {
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
    const { body, version, content } = await make();
    const headers = headersOf(version, content);
    if (cacheOk) {
      const stored = { ...headers, "cache-control": CATALOG_CACHE_EDGE };
      waitUntil(
        ctx.cache
          .put(key, respond(body, 200, stored, false))
          .catch((e: Error) => ctx.log(`кэш не записан: ${e.message}`)),
      );
    }
    return respond(body, 200, { ...headers, "x-cache": "MISS" }, head);
  }

  return async (kind, query, head, waitUntil) => {
    if (kind === "last-modified") {
      const filter = prefixFilter(query);
      const manifest = await ctx.manifest();
      const out: JsonObject = {};
      for (const [id, entry] of manifest) {
        if (filter === undefined || filter.match(id)) {
          out[id] = entry.lastModified;
        }
      }
      return respond(
        compactJson({ lastModified: out }),
        200,
        headersOf(manifest.catalog ?? ""),
        head,
      );
    }

    if (kind === "collections") {
      const filter = prefixFilter(query);
      const manifest = await ctx.manifest();
      const hash = catalogOf(manifest);
      const index = await loadIndex(hash);
      const out: JsonObject = {};
      for (const [id, entry] of index.sets) {
        if (manifest.has(id) && (filter === undefined || filter.match(id))) {
          out[id] = entry.info;
        }
      }
      return respond(compactJson(out), 200, headersOf(hash), head);
    }

    if (kind === "collection") {
      const prefix = single(query, "prefix");
      if (prefix === undefined) {
        throw new ApiError(
          400,
          "prefix_required",
          'Parameter "prefix" with an icon set prefix is required',
        );
      }
      const info = parseBool("info", single(query, "info"));
      // Iconify отдаёт с chars карту символов шрифта; наборов из шрифтов у нас нет.
      parseBool("chars", single(query, "chars"));
      const manifest = await ctx.manifest();
      const set = isValidNamePart(prefix) ? manifest.get(prefix) : undefined;
      if (set === undefined) {
        throw new ApiError(
          404,
          "set_not_found",
          `Icon set "${prefix}" not found`,
        );
      }
      const hash = catalogOf(manifest);
      const index = await loadIndex(hash);
      const entry = index.sets.get(prefix);
      if (entry === undefined) {
        throw new StorageError(`набора «${prefix}» нет в оглавлении ${hash}`);
      }
      const params = new URLSearchParams({ prefix });
      if (info) params.set("info", "1");
      return cached(
        cacheKey(ctx.build, hash, "/collection", params),
        async () => {
          const text = await readText(
            `${CATALOG_DIR}/${prefix}/${entry.collection}.json`,
          );
          // Тело — компактный JSON, начинается с «{»: info встаёт первым полем, без разбора тела.
          const body = info
            ? `{"info":${compactJson(fullInfo(entry))},${text.slice(1)}`
            : text;
          return {
            body,
            version: set.version,
            ...(entry.content === undefined ? {} : { content: entry.content }),
          };
        },
        head,
        waitUntil,
      );
    }

    const filter = prefixFilter(query);
    const manifest = await ctx.manifest();
    const hash = catalogOf(manifest);
    const index = await loadIndex(hash);
    return cached(
      cacheKey(
        ctx.build,
        hash,
        "/changelog",
        filter?.params ?? new URLSearchParams(),
      ),
      async () => {
        const text = await readText(
          `${CATALOG_DIR}/changelog/${index.changelog}.json`,
        );
        if (filter === undefined) return { body: text, version: hash };
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new StorageError("файл выпусков не JSON");
        }
        const releases = isObject(data) && Array.isArray(data.releases);
        if (!releases) throw new StorageError("файл выпусков не по формату");
        const list = (data as { releases: Json[] }).releases.filter(
          (r) => isObject(r) && filter.match(String(r.prefix)),
        );
        return { body: compactJson({ releases: list }), version: hash };
      },
      head,
      waitUntil,
    );
  };
}
