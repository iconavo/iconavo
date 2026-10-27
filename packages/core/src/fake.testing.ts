// Помощники тестов ядра: новый экземпляр модулей на тест и поддельный хост API. В сборку пакета
// не входит: tsconfig ядра исключает *.testing.ts.

import { vi } from "vitest";

export type Core = typeof import("./index.js") &
  typeof import("./internal.js") & {
    store: typeof import("./store.js")["store"];
  };

/** Новые модули ядра: у каждого теста своё хранилище (на «сервере» оно у модуля). */
export async function freshCore(): Promise<Core> {
  vi.resetModules();
  return {
    ...(await import("./index.js")),
    ...(await import("./internal.js")),
    store: (await import("./store.js")).store,
  };
}

/** Дать ядру отправить очередь и разобрать ответы: несколько оборотов цикла событий. */
export async function idle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Хост API как edge API для набора demo: имя на «missing» — в not_found, остальные — иконки,
 * «alias-…» — алиас иконки без приставки. Другой набор — 404.
 */
export function demoBatch(url: URL): Response {
  const prefix = /^\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1];
  if (prefix !== "demo") {
    return Response.json(
      { status: 404, error: "set_not_found", message: "Icon set not found" },
      { status: 404 },
    );
  }
  const icons: Record<string, { body: string }> = {};
  const aliases: Record<string, { parent: string }> = {};
  const notFound: string[] = [];
  for (const name of (url.searchParams.get("icons") ?? "").split(",")) {
    if (name.startsWith("missing")) {
      notFound.push(name);
    } else if (name.startsWith("alias-")) {
      const parent = name.slice("alias-".length);
      aliases[name] = { parent };
      icons[parent] = { body: `<path d="${parent}"/>` };
    } else {
      icons[name] = { body: `<path d="${name}"/>` };
    }
  }
  return Response.json({
    prefix,
    lastModified: 1792490457,
    icons,
    aliases,
    width: 24,
    height: 24,
    ...(notFound.length > 0 ? { not_found: notFound } : {}),
  });
}

/** Подменить глобальный fetch: адреса запросов — в requests, ответы — от handler. */
export function fakeFetch(
  handler: (url: URL) => Response | Promise<Response> = demoBatch,
): string[] {
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    return handler(new URL(url));
  });
  return requests;
}

/** Ответ, который приходит, когда тест скажет. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
