// Файлы имён со статики (ADR-0022): v/{версия}/{набор}/{имя}.json — IconifyJSON одного имени, с
// иконкой в конце цепочки и всей цепочкой алиасов. Не больше шести запросов к R2 сразу (лимит
// соединений Workers); тело читается в той же задаче, что его запросила: соединение, которое ждёт,
// пока другие закончат, Workers может оборвать. Нет файла — null; сбой R2 — ошибка хранилища.
//
// Шаг 6 фазы 3 (ADR-0030): прочитанные файлы хранятся в кэше дата-центра. Пачка из знакомых иконок
// собирается без похода в R2, и холодная пачка укладывается в порог перехода на статику.

import type { IconavoIconSet } from "@iconavo-ui/core";
import { CACHE_GENERATION, CACHE_ORIGIN, READ_CONCURRENCY } from "./config.js";
import type { Bucket, EdgeCache } from "./env.js";
import { StorageError } from "./http.js";

export const nameKey = (version: string, set: string, name: string) =>
  `v/${version}/${set}/${name}.json`;

/** Кэш файла неделю: версия неизменяема, а неделя — как у ответов (CACHE_OK). */
const ICON_CACHE = "public, max-age=604800";

/** Ключ кэша файла иконки: без build — версия и так неизменяема. */
function iconCacheKey(version: string, set: string, name: string): Request {
  return new Request(
    `${CACHE_ORIGIN}/${CACHE_GENERATION}/icon/${version}/${set}/${name}`,
  );
}

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

export interface ReadOptions {
  bucket: Bucket;
  cache?: EdgeCache;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Файлы имён набора: имя → данные или null, если такого имени в версии нет. */
export async function readNames(
  options: ReadOptions,
  version: string,
  set: string,
  names: readonly string[],
): Promise<Map<string, IconavoIconSet | null>> {
  const { bucket, cache, waitUntil } = options;
  const files = new Map<string, IconavoIconSet | null>();
  const missing: string[] = [];

  // Шаг 1: ищем в кэше дата-центра (только найденные файлы, null не кэшируется).
  if (cache !== undefined) {
    await Promise.all(
      names.map(async (name) => {
        try {
          const hit = await cache.match(iconCacheKey(version, set, name));
          if (hit !== undefined) {
            files.set(name, parseNameFile(await hit.text(), set));
            return;
          }
        } catch {
          // Сбой кэша — читаем из R2.
        }
        missing.push(name);
      }),
    );
  } else {
    missing.push(...names);
  }

  // Шаг 2: читаем недостающие из R2.
  if (missing.length > 0) {
    let next = 0;
    const toCache: { name: string; text: string }[] = [];
    const worker = async () => {
      while (next < missing.length) {
        const name = missing[next++] as string;
        let text: string | undefined;
        try {
          text = await (await bucket.get(nameKey(version, set, name)))?.text();
        } catch (e) {
          throw new StorageError(
            `файл имени не прочитан: ${(e as Error).message}`,
          );
        }
        files.set(name, text === undefined ? null : parseNameFile(text, set));
        // Кэшируем только найденные файлы: 404 — редкий случай (ошибка в имени).
        if (text !== undefined) toCache.push({ name, text });
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(READ_CONCURRENCY, missing.length) },
        worker,
      ),
    );

    // Шаг 3: кладём прочитанное в кэш (waitUntil — не блокируем ответ).
    if (cache !== undefined && toCache.length > 0) {
      const put = Promise.all(
        toCache.map(({ name, text }) =>
          cache
            .put(
              iconCacheKey(version, set, name),
              new Response(text, { headers: { "cache-control": ICON_CACHE } }),
            )
            .catch(() => {}),
        ),
      );
      if (waitUntil !== undefined) waitUntil(put);
      else await put;
    }
  }

  return files;
}
