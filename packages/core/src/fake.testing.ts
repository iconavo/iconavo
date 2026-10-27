// Помощники тестов ядра: новый экземпляр модулей на тест, поддельное время и поддельные хосты — edge
// API и статика. В сборку пакета не входит: tsconfig ядра исключает *.testing.ts.

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

/**
 * Поддельное время ядра: setTimeout, clearTimeout и Date. Настоящий таймер повтора, переживший тест,
 * сходил бы в настоящий fetch, когда подмену уже сняли, — до cdn.iconavo.dev прямо из CI.
 */
export function fakeTime(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}

/** Конец теста: таймеры — в мусор, время и fetch — настоящие, шпионы консоли сняты. */
export function realTime(): void {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

/** Дать ядру отправить очередь и разобрать ответы: несколько оборотов цикла событий, время стоит. */
export async function idle(): Promise<void> {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
}

/** Ответ промиса, которому хватает оборотов цикла событий без хода времени. */
export async function settled<T>(promise: Promise<T>): Promise<T> {
  await idle();
  return promise;
}

/** Пройти ms миллисекунд поддельного времени, разбирая ответы по пути. */
export async function wait(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await idle();
}

/** Предупреждения ядра — без вывода в консоль теста. */
export const warnings = () =>
  vi.spyOn(console, "warn").mockImplementation(() => {});

/**
 * Хост API как edge API для набора demo: имя на «missing» — в not_found, остальные — иконки,
 * «alias-…» — алиас иконки без приставки. Другой набор — 404.
 */
export function demoBatch(url: URL): Response {
  const prefix = /\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1];
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

/** Версия набора demo в манифестах поддельной статики. */
export const DEMO_VERSION = "v1";

/**
 * Хост статики с раскладкой cdn.iconavo.dev для набора demo: манифест и файл на имя; «missing…» и
 * другой набор — 404. В рисунке — хост, чтобы было видно, откуда пришла иконка.
 */
export function demoStatic(url: URL): Response {
  if (url.pathname.endsWith("/manifest.json")) {
    return Response.json({
      sets: { demo: { version: DEMO_VERSION, lastModified: 1792490457 } },
    });
  }
  const name = new RegExp(`/v/${DEMO_VERSION}/demo/([a-z0-9-]+)\\.json$`).exec(
    url.pathname,
  )?.[1];
  if (name === undefined || name.startsWith("missing")) {
    return new Response("Not found", { status: 404 });
  }
  const parent = name.startsWith("alias-") ? name.slice("alias-".length) : name;
  return Response.json({
    prefix: "demo",
    icons: {
      [parent]: { body: `<path d="${parent}" data-host="${url.host}"/>` },
    },
    width: 24,
    height: 24,
    ...(parent === name ? {} : { aliases: { [name]: { parent } } }),
  });
}

/** Наши хосты по умолчанию: api.iconavo.dev — пачки, остальные — статика. */
export const demoHosts = (url: URL): Response =>
  url.host === "api.iconavo.dev" ? demoBatch(url) : demoStatic(url);

/** Поведение хоста: работает, ошибка сети, молчит до отмены, отвечает этим кодом или как скажут. */
export type Behavior =
  | "ok"
  | "down"
  | "silent"
  | number
  | ((url: URL) => Response | Promise<Response>);

/** Наши хосты с поведением по имени хоста; не названные работают. */
export function hosts(behaviors: Record<string, Behavior>): Handler {
  return (url) => {
    const behavior = behaviors[url.host] ?? "ok";
    if (behavior === "down") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (behavior === "silent") return new Promise<Response>(() => {});
    if (typeof behavior === "number") {
      return new Response("oops", { status: behavior });
    }
    return behavior === "ok" ? demoHosts(url) : behavior(url);
  };
}

/** Ответ через ms миллисекунд поддельного времени. */
export const later =
  (ms: number, handler: (url: URL) => Response = demoHosts) =>
  (url: URL): Promise<Response> =>
    new Promise((resolve) => setTimeout(() => resolve(handler(url)), ms));

/** Запрос ядра: адрес, когда ушёл (мс поддельного времени от подмены) и сигнал отмены. */
export interface Call {
  url: string;
  at: number;
  signal: AbortSignal | undefined;
}

type Handler = (url: URL) => Response | Promise<Response>;

/**
 * Подменить глобальный fetch: каждый запрос — в record, ответ — от handler. Сигнал отмены — как у
 * настоящего fetch: отменённый запрос отклоняется с причиной отмены.
 */
function stubFetch(handler: Handler, record: (call: Call) => void): void {
  const start = Date.now();
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const signal = init?.signal ?? undefined;
      record({ url, at: Date.now() - start, signal });
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal?.reason);
        signal?.addEventListener("abort", abort, { once: true });
        Promise.resolve()
          .then(() => handler(new URL(url)))
          .then(resolve, reject)
          .finally(() => signal?.removeEventListener("abort", abort));
      });
    },
  );
}

/** Подменить fetch: запросы с временем и сигналом. */
export function fakeNet(handler: Handler = demoHosts): Call[] {
  const calls: Call[] = [];
  stubFetch(handler, (call) => calls.push(call));
  return calls;
}

/** Подменить fetch: только адреса запросов. */
export function fakeFetch(handler: Handler = demoHosts): string[] {
  const urls: string[] = [];
  stubFetch(handler, (call) => urls.push(call.url));
  return urls;
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
