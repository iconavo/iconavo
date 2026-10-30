// Манифест раздачи (ADR-0022) из R2: набор → версия и время выпуска; catalog — отпечаток оглавления
// каталога наборов (шаг 2 фазы 4). В памяти функции — минуту, в кэше дата-центра — 30 секунд, чтобы
// холодная копия функции не ждала R2; одновременные запросы ждут одну загрузку; если R2 не ответил,
// служит прежняя копия. Наборы — в Map: имя «constructor» проходит правило имён, но не должно найти
// что-то в прототипе объекта.

import { isValidNamePart } from "@iconavo-ui/core/internal";
import { sharedText } from "./cache.js";
import {
  CATALOG_PATTERN,
  MANIFEST_KEY,
  MANIFEST_TTL_MS,
  VERSION_PATTERN,
} from "./config.js";
import type { Bucket, EdgeCache } from "./env.js";
import { StorageError } from "./http.js";

export interface SetEntry {
  version: string;
  lastModified: number;
}

/** Наборы манифеста; catalog — отпечаток оглавления каталога, у манифеста до шага 2 фазы 4 его нет. */
export type Manifest = ReadonlyMap<string, SetEntry> & {
  readonly catalog?: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Манифест по тексту; не тот формат — ошибка хранилища. */
export function parseManifest(text: string): Manifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new StorageError("манифест не JSON");
  }
  if (!isObject(data) || !isObject(data.sets)) {
    throw new StorageError("в манифесте нет sets");
  }
  if (
    data.catalog !== undefined &&
    (typeof data.catalog !== "string" || !CATALOG_PATTERN.test(data.catalog))
  ) {
    throw new StorageError("в манифесте неверное поле catalog");
  }
  const sets: Map<string, SetEntry> & { catalog?: string } = new Map();
  if (typeof data.catalog === "string") sets.catalog = data.catalog;
  for (const [id, entry] of Object.entries(data.sets)) {
    if (
      !isValidNamePart(id) ||
      !isObject(entry) ||
      typeof entry.version !== "string" ||
      !VERSION_PATTERN.test(entry.version) ||
      typeof entry.lastModified !== "number" ||
      !Number.isInteger(entry.lastModified) ||
      entry.lastModified < 0
    ) {
      throw new StorageError(`в манифесте неверная запись «${id}»`);
    }
    sets.set(id, { version: entry.version, lastModified: entry.lastModified });
  }
  return sets;
}

async function readManifest(
  bucket: Bucket,
  cache: EdgeCache | undefined,
): Promise<Manifest> {
  const text = await sharedText(cache, MANIFEST_KEY, async () => {
    try {
      return (await bucket.get(MANIFEST_KEY))?.text();
    } catch (e) {
      throw new StorageError(`манифест не прочитан: ${(e as Error).message}`);
    }
  });
  if (text === undefined) throw new StorageError("манифеста нет в R2");
  return parseManifest(text);
}

/** Загрузчик манифеста с памятью на минуту; с cache — ещё и через кэш дата-центра. */
export function manifestLoader(
  bucket: Bucket,
  now: () => number,
  log: (message: string) => void,
  cache?: EdgeCache,
): () => Promise<Manifest> {
  let cached: { manifest: Manifest; at: number } | undefined;
  let pending: Promise<Manifest> | undefined;
  return () => {
    if (cached && now() - cached.at < MANIFEST_TTL_MS) {
      return Promise.resolve(cached.manifest);
    }
    pending ??= readManifest(bucket, cache)
      .then((manifest) => {
        cached = { manifest, at: now() };
        return manifest;
      })
      .catch((e: Error) => {
        if (cached === undefined) throw e;
        log(`${e.message} — служит прежняя копия`);
        return cached.manifest;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
