// Манифест раздачи (ADR-0022) из R2: набор → версия и время выпуска. В памяти функции — минуту;
// одновременные запросы ждут одну загрузку; если R2 не ответил, служит прежняя копия. Наборы — в
// Map: имя «constructor» проходит правило имён, но не должно найти что-то в прототипе объекта.

import { isValidNamePart } from "@iconavo-ui/core";
import { MANIFEST_KEY, MANIFEST_TTL_MS, VERSION_PATTERN } from "./config.js";
import type { Bucket } from "./env.js";
import { StorageError } from "./http.js";

export interface SetEntry {
  version: string;
  lastModified: number;
}

export type Manifest = ReadonlyMap<string, SetEntry>;

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
  const sets = new Map<string, SetEntry>();
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

async function readManifest(bucket: Bucket): Promise<Manifest> {
  let text: string | undefined;
  try {
    text = await (await bucket.get(MANIFEST_KEY))?.text();
  } catch (e) {
    throw new StorageError(`манифест не прочитан: ${(e as Error).message}`);
  }
  if (text === undefined) throw new StorageError("манифеста нет в R2");
  return parseManifest(text);
}

/** Загрузчик манифеста с памятью на минуту. */
export function manifestLoader(
  bucket: Bucket,
  now: () => number,
  log: (message: string) => void,
): () => Promise<Manifest> {
  let cached: { manifest: Manifest; at: number } | undefined;
  let pending: Promise<Manifest> | undefined;
  return () => {
    if (cached && now() - cached.at < MANIFEST_TTL_MS) {
      return Promise.resolve(cached.manifest);
    }
    pending ??= readManifest(bucket)
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
