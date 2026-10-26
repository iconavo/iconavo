// Ключ кэша дата-центра (ADR-0023): поколение, сборка, версия набора, путь и проверенные параметры в
// постоянном порядке. Значения кодирует URLSearchParams: «&», «=» и «%» в значении не подделают чужой
// ключ. Ключ — всегда GET: Cache API хранит только GET, а HEAD берёт тот же ответ.

import { CACHE_GENERATION, CACHE_ORIGIN, META_CACHE } from "./config.js";
import type { EdgeCache } from "./env.js";

export function cacheKey(
  build: string,
  version: string,
  path: string,
  params: URLSearchParams,
): Request {
  const query = params.toString();
  return new Request(
    `${CACHE_ORIGIN}/${CACHE_GENERATION}/${build}/${version}${path}${query === "" ? "" : `?${query}`}`,
  );
}

/**
 * Небольшой файл хранилища через кэш дата-центра (META_CACHE): сначала кэш, затем read и запись в
 * кэш. Файла нет — undefined, в кэш ничего не пишется. Сбой кэша чтение не останавливает.
 */
export async function sharedText(
  cache: EdgeCache | undefined,
  name: string,
  read: () => Promise<string | undefined>,
): Promise<string | undefined> {
  const key = new Request(`${CACHE_ORIGIN}/${CACHE_GENERATION}/meta/${name}`);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit !== undefined) return hit.text();
  const text = await read();
  if (cache !== undefined && text !== undefined) {
    await cache
      .put(
        key,
        new Response(text, { headers: { "cache-control": META_CACHE } }),
      )
      .catch(() => {});
  }
  return text;
}
