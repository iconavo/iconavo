// Подделки для тестов функции: R2 из словаря, строгий кэш — только GET, а ответ из кэша менять
// нельзя, как в workerd; кэш считает обращения, как лимит Workers, и падает по команде. И файлы имён в
// формате статики (pnpm cdn build, ADR-0022). Для поиска (ADR-0049) — Meilisearch и Polza за
// подменным fetch и лимит частоты.

import type { IconavoAlias, IconavoIcon } from "@iconavo-ui/core";
import type { Bucket, EdgeCache } from "./env.js";
import { compactJson, type Json } from "./json.js";

export const VERSION = "0123abcd";
export const LAST_MODIFIED = 1792490457;

/** Файл имени: иконка в конце цепочки и, у алиаса, вся цепочка; размеры набора. */
export function nameFileText(
  set: string,
  icons: Record<string, IconavoIcon>,
  aliases?: Record<string, IconavoAlias>,
  size = 24,
): string {
  return compactJson({
    prefix: set,
    icons: icons as unknown as Json,
    ...(aliases === undefined ? {} : { aliases: aliases as unknown as Json }),
    width: size,
    height: size,
  });
}

/** manifest.json: набор → версия; catalog — отпечаток оглавления каталога наборов. */
export function manifestText(
  sets: Record<string, string>,
  catalog?: string,
): string {
  const out: { [key: string]: Json } = {};
  for (const [id, version] of Object.entries(sets)) {
    out[id] = { version, lastModified: LAST_MODIFIED };
  }
  return compactJson(
    catalog === undefined ? { sets: out } : { catalog, sets: out },
  );
}

export interface FakeBucket extends Bucket {
  files: Map<string, string | Uint8Array>;
  reads: string[];
  /** Ключи, на которых R2 «падает»; «*» — на всех. */
  failing: Set<string>;
}

export function fakeBucket(
  files: Record<string, string | Uint8Array>,
): FakeBucket {
  const map = new Map(Object.entries(files));
  const reads: string[] = [];
  const failing = new Set<string>();
  return {
    files: map,
    reads,
    failing,
    async get(key) {
      reads.push(key);
      if (failing.has(key) || failing.has("*")) throw new Error("R2 down");
      const value = map.get(key);
      if (value === undefined) return null;
      const bytes =
        typeof value === "string" ? new TextEncoder().encode(value) : value;
      return {
        text: async () => new TextDecoder().decode(bytes),
        arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
      };
    },
  };
}

interface Stored {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
  /** Когда положен и сколько живёт (max-age), мс; без max-age — вечно. */
  at: number;
  ttl?: number;
}

export interface FakeCache extends EdgeCache {
  stored: Map<string, Stored>;
  /** Обращений match и put — их считает лимит Workers (50 за запрос на бесплатном тарифе). */
  calls: number;
  /** Обращения к адресам, подходящим под выражение, падают. */
  failing?: RegExp;
  /** Ответов в кэше — без служебных файлов (манифест, версия индекса) и файлов имён. */
  answers(): number;
  /** Файлов имён в кэше. */
  files(): number;
}

/** Кэш дата-центра; с часами now записи живут max-age, как в Cache API. */
export function fakeCache(now: () => number = () => 0): FakeCache {
  const stored = new Map<string, Stored>();
  const count = (url: string) => {
    cache.calls++;
    if (cache.failing?.test(url)) throw new Error("cache down");
  };
  const cache: FakeCache = {
    stored,
    calls: 0,
    answers: () =>
      [...stored.keys()].filter(
        (url) => !url.includes("/meta/") && !url.includes("/file/"),
      ).length,
    files: () =>
      [...stored.keys()].filter((url) => url.includes("/file/")).length,
    async match(request) {
      count(request.url);
      const entry = stored.get(request.url);
      if (entry === undefined) return undefined;
      if (entry.ttl !== undefined && now() - entry.at >= entry.ttl) {
        stored.delete(request.url);
        return undefined;
      }
      const response = new Response(entry.body.slice().buffer as ArrayBuffer, {
        status: entry.status,
        headers: entry.headers,
      });
      for (const method of ["set", "append", "delete"] as const) {
        Object.defineProperty(response.headers, method, {
          value: () => {
            throw new TypeError("Can't modify immutable headers.");
          },
        });
      }
      return response;
    },
    async put(request, response) {
      count(request.url);
      if (request.method !== "GET") {
        throw new TypeError("Cannot cache response to non-GET request.");
      }
      if (
        /no-store|private/.test(response.headers.get("cache-control") ?? "")
      ) {
        throw new TypeError("Response is not cacheable.");
      }
      const maxAge = /max-age=(\d+)/.exec(
        response.headers.get("cache-control") ?? "",
      )?.[1];
      stored.set(request.url, {
        status: response.status,
        headers: [...response.headers],
        body: new Uint8Array(await response.arrayBuffer()),
        at: now(),
        ...(maxAge === undefined ? {} : { ttl: Number(maxAge) * 1000 }),
      });
    },
  };
  return cache;
}

/** waitUntil, которого можно дождаться. */
export function waiter() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    flush: () => Promise.all(pending),
  };
}

/** Карточка подменного индекса: имена для точного совпадения, слова, фильтры и выдача. */
export interface FakeDoc {
  icon: string;
  names: string[];
  words: string[];
  set: string;
  palette?: boolean;
  license?: string;
  /** Стили карточки (фильтр) и стиль → главное имя (выдача), ADR-0052. */
  style?: string[];
  styles?: Record<string, string>;
  variants?: string[];
  tones?: string[];
  /** Сведения для показа (шаг 4 фазы 4) — отдаются, если запрос их просит. */
  about?: { [key: string]: Json };
  /** false — у документа нет вектора: похожие отвечают 400. */
  vector?: boolean;
}

export interface FakeSearchOptions {
  docs: FakeDoc[];
  /** Вектор Polza для текста; ошибка — отказ, обещание без конца — «не успела». */
  polza?: (text: string) => Promise<number[]>;
  /** Meilisearch отвечает этим кодом. */
  meiliStatus?: number;
  /** Похожие отвечают этим кодом. */
  similarStatus?: number;
}

export const MEILI_URL = "https://ms-test.fra.meilisearch.io";

/**
 * fetch для Meilisearch и Polza. Meilisearch понимает фильтры общего модуля поиска (names, NOT names,
 * set IN, palette, license IN, style); слова — по вхождению; с вектором — ещё и все остальные
 * карточки, как смысловая часть. Непонятый фильтр — ошибка теста, а не тихое «подходит».
 */
export function fakeSearchFetch(options: FakeSearchOptions) {
  const meili: { queries: Record<string, unknown>[] }[] = [];
  const polza: { input: string[]; dimensions?: number }[] = [];
  const similar: Record<string, unknown>[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url === `${MEILI_URL}/indexes/icons/similar`) {
      // Похожие: соседи по общим словам, затем по имени; сам документ не отдаётся.
      similar.push(body);
      if (options.similarStatus !== undefined) {
        return new Response("{}", { status: options.similarStatus });
      }
      const source = options.docs.find(
        (d) => d.icon.replace(":", "_") === body.id,
      );
      if (source === undefined) return new Response("{}", { status: 404 });
      if (source.vector === false) return new Response("{}", { status: 400 });
      const shared = (d: FakeDoc) =>
        d.words.filter((w) => source.words.includes(w)).length;
      const hits = options.docs
        .filter((d) => d !== source)
        .sort((a, b) => shared(b) - shared(a) || (a.icon < b.icon ? -1 : 1))
        .slice(0, Number(body.limit ?? 20))
        .map((d) => ({
          icon: d.icon,
          ...(d.styles === undefined ? {} : { styles: d.styles }),
        }));
      return Response.json({ hits, id: body.id });
    }
    if (url === `${MEILI_URL}/multi-search`) {
      meili.push(body);
      if (options.meiliStatus !== undefined) {
        return new Response("{}", { status: options.meiliStatus });
      }
      const results = (body.queries as Record<string, unknown>[]).map((q) => {
        const filter = (q.filter as string[] | undefined) ?? [];
        const words = String(q.q)
          .split(" ")
          .filter((w) => w !== "");
        const ok = (d: FakeDoc) =>
          filter.every((f) => {
            let m = /^NOT names = "(.+)"$/.exec(f);
            if (m) return !d.names.includes(m[1] as string);
            m = /^names = "(.+)"$/.exec(f);
            if (m) return d.names.includes(m[1] as string);
            m = /^set IN \[(.+)\]$/.exec(f);
            if (m) return (m[1] as string).includes(`"${d.set}"`);
            m = /^palette = (true|false)$/.exec(f);
            if (m) return String(d.palette ?? false) === m[1];
            m = /^license IN \[(.+)\]$/.exec(f);
            if (m) return (m[1] as string).includes(`"${d.license ?? ""}"`);
            m = /^style = "(.+)"$/.exec(f);
            if (m) return (d.style ?? []).includes(m[1] as string);
            throw new Error(`подменный Meilisearch: фильтр не понят: ${f}`);
          });
        const byWords = options.docs.filter(
          (d) => ok(d) && words.some((w) => d.words.includes(w)),
        );
        const rest =
          q.vector === undefined
            ? []
            : options.docs.filter((d) => ok(d) && !byWords.includes(d));
        const found =
          q.q === "" ? options.docs.filter(ok) : [...byWords, ...rest];
        const offset = Number(q.offset ?? 0);
        const limit = Number(q.limit ?? 20);
        const fields = (q.attributesToRetrieve as string[] | undefined) ?? [];
        return {
          hits: found.slice(offset, offset + limit).map((d) => ({
            icon: d.icon,
            variants: d.variants ?? [],
            tones: d.tones ?? [],
            ...(d.styles === undefined ? {} : { styles: d.styles }),
            ...(d.about !== undefined && fields.includes("about")
              ? { about: d.about }
              : {}),
          })),
        };
      });
      return Response.json({ results });
    }
    if (url === "https://polza.ai/api/v1/embeddings") {
      polza.push(body);
      const make = options.polza ?? (async () => [1, 0, 0]);
      const values = await make(body.input[0]);
      const embedding = Array.from(
        { length: body.dimensions ?? 1024 },
        (_, i) => values[i % values.length] ?? 0,
      );
      return Response.json({ data: [{ embedding }] });
    }
    throw new TypeError(`подменный fetch: нет адреса ${url}`);
  }) as typeof fetch;
  return { fn, meili, polza, similar };
}

/** Лимит частоты: разрешено allowed запросов на ключ. */
export function fakeLimiter(allowed: number) {
  const counts = new Map<string, number>();
  return {
    counts,
    async limit({ key }: { key: string }) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= allowed };
    },
  };
}
