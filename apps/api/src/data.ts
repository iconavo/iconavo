// Файлы имён со статики (ADR-0022): v/{версия}/{набор}/{имя}.json — IconifyJSON одного имени, с
// иконкой в конце цепочки и всей цепочкой алиасов. Не больше шести запросов к R2 сразу (лимит
// соединений Workers); тело читается в той же задаче, что его запросила: соединение, которое ждёт,
// пока другие закончат, Workers может оборвать. Нет файла — null; сбой R2 — ошибка хранилища.
//
// Прочитанные файлы лежат и в кэше дата-центра (шаг 6 фазы 3): новая пачка из знакомых иконок
// собирается без R2. Обращений к кэшу за запрос — не больше FILE_CACHE_CALLS (лимит бесплатного
// тарифа). Сначала проба — FILE_PROBE имён по всей пачке; ни одного в кэше — пачка новая, остальные не
// ищутся, и обращения уходят на запись прочитанного. Сбой кэша или испорченная запись — файл из R2:
// ошибкой ответа кэш не становится.

import type { IconavoIconSet } from "@iconavo-ui/core";
import {
  CACHE_GENERATION,
  CACHE_ORIGIN,
  FILE_CACHE,
  FILE_CACHE_CALLS,
  FILE_PROBE,
  READ_CONCURRENCY,
  TYPES,
} from "./config.js";
import type { Bucket, EdgeCache } from "./env.js";
import { StorageError } from "./http.js";

export const nameKey = (version: string, set: string, name: string) =>
  `v/${version}/${set}/${name}.json`;

/** Ключ файла в кэше дата-центра — без метки сборки: файл зависит только от версии набора. */
export const fileKey = (version: string, set: string, name: string) =>
  new Request(
    `${CACHE_ORIGIN}/${CACHE_GENERATION}/file/${nameKey(version, set, name)}`,
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Файл имени по тексту: IconifyJSON нашего набора с хотя бы одной иконкой. */
export function parseNameFile(text: string, set: string): IconavoIconSet {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new StorageError("файл имени не JSON");
  }
  if (
    !isObject(data) ||
    data.prefix !== set ||
    !isObject(data.icons) ||
    Object.keys(data.icons).length === 0 ||
    !Object.values(data.icons).every(
      (icon) => isObject(icon) && typeof icon.body === "string",
    ) ||
    (data.aliases !== undefined && !isObject(data.aliases))
  ) {
    throw new StorageError(`файл имени набора «${set}» не по формату`);
  }
  return data as unknown as IconavoIconSet;
}

/** Задачи по списку, не больше limit сразу. */
async function inPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++] as T);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

/** Имена пробы: FILE_PROBE штук равномерно по пачке, первое и последнее — всегда. */
export function probeNames(names: readonly string[]): string[] {
  const n = Math.min(FILE_PROBE, names.length);
  if (n <= 1) return names.slice(0, n);
  return Array.from(
    { length: n },
    (_, i) => names[Math.round((i * (names.length - 1)) / (n - 1))] as string,
  );
}

export interface NameFiles {
  /** Имя → данные или null, если такого имени в версии нет. */
  files: Map<string, IconavoIconSet | null>;
  /** Прочитано из R2 и годится в кэш: имя → текст файла. */
  fresh: Map<string, string>;
  /** Сколько обращений к кэшу ещё можно потратить на запись файлов; после сбоя кэша — 0. */
  puts: number;
  /** Сколько имён искали в кэше, сколько нашли и сколько прочитали из R2. */
  looked: number;
  hits: number;
  r2: number;
  /** Ожидание кэша и R2, мс. */
  cacheMs: number;
  r2Ms: number;
}

export interface ReadOptions {
  /** Кэш дата-центра; нет — только R2. */
  cache?: EdgeCache;
  now: () => number;
  log: (message: string) => void;
}

/** Файлы имён набора: сначала кэш дата-центра (в пределах бюджета), затем R2. */
export async function readNames(
  bucket: Bucket,
  version: string,
  set: string,
  names: readonly string[],
  o: ReadOptions,
): Promise<NameFiles> {
  const out: NameFiles = {
    files: new Map(),
    fresh: new Map(),
    puts: 0,
    looked: 0,
    hits: 0,
    r2: 0,
    cacheMs: 0,
    r2Ms: 0,
  };
  const cache = o.cache;
  let budget = FILE_CACHE_CALLS;
  let broken = false;
  let corrupt = false;
  /** Файл из кэша: есть и по формату — в files; иначе имя прочитают из R2. */
  const look = async (name: string) => {
    if (cache === undefined || broken || budget <= 0) return;
    budget--;
    out.looked++;
    let text: string | undefined;
    try {
      text = await (await cache.match(fileKey(version, set, name)))?.text();
    } catch (e) {
      if (!broken) o.log(`кэш файлов: ${(e as Error).message}`);
      broken = true;
      return;
    }
    if (text === undefined) return;
    try {
      out.files.set(name, parseNameFile(text, set));
      out.hits++;
    } catch {
      if (!corrupt) {
        o.log(`кэш файлов: запись «${set}:${name}» не по формату — файл из R2`);
      }
      corrupt = true;
    }
  };
  if (cache !== undefined && names.length > 0) {
    const started = o.now();
    const probe = probeNames(names);
    await inPool(probe, READ_CONCURRENCY, look);
    if (out.hits > 0) {
      const probed = new Set(probe);
      await inPool(
        names.filter((name) => !probed.has(name)),
        READ_CONCURRENCY,
        look,
      );
    }
    out.cacheMs = o.now() - started;
  }
  const missing = names.filter((name) => !out.files.has(name));
  const started = o.now();
  await inPool(missing, READ_CONCURRENCY, async (name) => {
    let text: string | undefined;
    try {
      text = await (await bucket.get(nameKey(version, set, name)))?.text();
    } catch (e) {
      throw new StorageError(`файл имени не прочитан: ${(e as Error).message}`);
    }
    out.r2++;
    if (text === undefined) {
      out.files.set(name, null);
      return;
    }
    out.files.set(name, parseNameFile(text, set));
    out.fresh.set(name, text);
  });
  if (missing.length > 0) out.r2Ms = o.now() - started;
  out.puts = cache === undefined || broken ? 0 : budget;
  return out;
}

/**
 * Прочитанное из R2 — в кэш дата-центра, после ответа (waitUntil): не больше read.puts файлов и не
 * больше READ_CONCURRENCY записей сразу. Сбой записи не мешает: файл прочитают из R2 в другой раз.
 */
export async function storeNames(
  cache: EdgeCache,
  version: string,
  set: string,
  read: NameFiles,
  log: (message: string) => void,
): Promise<void> {
  const errors: Error[] = [];
  await inPool(
    [...read.fresh].slice(0, read.puts),
    READ_CONCURRENCY,
    async ([name, text]) => {
      await cache
        .put(
          fileKey(version, set, name),
          new Response(text, {
            headers: {
              "content-type": TYPES.json,
              "cache-control": FILE_CACHE,
            },
          }),
        )
        .catch((e: Error) => {
          errors.push(e);
        });
    },
  );
  if (errors[0]) log(`кэш файлов не записан: ${errors[0].message}`);
}
