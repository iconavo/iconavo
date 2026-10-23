// Подделки для тестов функции: R2 из словаря, строгий кэш — только GET, а ответ из кэша менять
// нельзя, как в workerd, — и файлы имён в формате статики (pnpm cdn build, ADR-0022).

import type { IconifyAlias, IconifyIcon } from "@iconavo-ui/core";
import type { Bucket, EdgeCache } from "./env.js";
import { compactJson, type Json } from "./json.js";

export const VERSION = "0123abcd";
export const LAST_MODIFIED = 1792490457;

/** Файл имени: иконка в конце цепочки и, у алиаса, вся цепочка; размеры набора. */
export function nameFileText(
  set: string,
  icons: Record<string, IconifyIcon>,
  aliases?: Record<string, IconifyAlias>,
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

/** manifest.json: набор → версия. */
export function manifestText(sets: Record<string, string>): string {
  const out: { [key: string]: Json } = {};
  for (const [id, version] of Object.entries(sets)) {
    out[id] = { version, lastModified: LAST_MODIFIED };
  }
  return compactJson({ sets: out });
}

export interface FakeBucket extends Bucket {
  files: Map<string, string>;
  reads: string[];
  /** Ключи, на которых R2 «падает»; «*» — на всех. */
  failing: Set<string>;
}

export function fakeBucket(files: Record<string, string>): FakeBucket {
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
      const text = map.get(key);
      return text === undefined ? null : { text: async () => text };
    },
  };
}

interface Stored {
  status: number;
  headers: [string, string][];
  body: string;
}

export interface FakeCache extends EdgeCache {
  stored: Map<string, Stored>;
}

export function fakeCache(): FakeCache {
  const stored = new Map<string, Stored>();
  return {
    stored,
    async match(request) {
      const entry = stored.get(request.url);
      if (entry === undefined) return undefined;
      const response = new Response(entry.body, {
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
      if (request.method !== "GET") {
        throw new TypeError("Cannot cache response to non-GET request.");
      }
      if (
        /no-store|private/.test(response.headers.get("cache-control") ?? "")
      ) {
        throw new TypeError("Response is not cacheable.");
      }
      stored.set(request.url, {
        status: response.status,
        headers: [...response.headers],
        body: await response.text(),
      });
    },
  };
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
