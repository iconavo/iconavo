// Версия поискового индекса (ADR-0049): index.json в закрытом бакете iconavo-search, его пишет робот
// индекса сразу после документов. По ней строятся ключи кэша ответов: новый индекс — новые ключи, и
// сбрасывать ничего не нужно (ADR-0023). В памяти функции — минуту, в кэше дата-центра — 30 секунд,
// чтобы холодная копия функции не ждала бакет; одновременные запросы ждут одну загрузку; бакет не
// ответил — служит прежняя версия; версии ещё нет — «none».

import { STORE_KEYS } from "@iconavo-ui/search";
import { sharedText } from "../cache.js";
import { SEARCH_INDEX_TTL_MS, VERSION_PATTERN } from "../config.js";
import type { Bucket, EdgeCache } from "../env.js";

export const NO_INDEX = "none";

async function readVersion(
  bucket: Bucket | undefined,
  cache: EdgeCache | undefined,
): Promise<string> {
  if (bucket === undefined) return NO_INDEX;
  const text = await sharedText(cache, `search-${STORE_KEYS.index}`, async () =>
    (await bucket.get(STORE_KEYS.index))?.text(),
  );
  if (text === undefined) return NO_INDEX;
  const data = JSON.parse(text) as { version?: unknown };
  return typeof data.version === "string" && VERSION_PATTERN.test(data.version)
    ? data.version
    : NO_INDEX;
}

/** Загрузчик версии индекса с памятью на минуту; с cache — ещё и через кэш дата-центра. */
export function indexVersionLoader(
  bucket: Bucket | undefined,
  now: () => number,
  log: (message: string) => void,
  cache?: EdgeCache,
): () => Promise<string> {
  let cached: { version: string; at: number } | undefined;
  let pending: Promise<string> | undefined;
  return () => {
    if (cached && now() - cached.at < SEARCH_INDEX_TTL_MS) {
      return Promise.resolve(cached.version);
    }
    pending ??= readVersion(bucket, cache)
      .then((version) => {
        cached = { version, at: now() };
        return version;
      })
      .catch((e: Error) => {
        log(`версия индекса не прочитана: ${e.message}`);
        return cached?.version ?? NO_INDEX;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
