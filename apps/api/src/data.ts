// Файлы имён со статики (ADR-0022): v/{версия}/{набор}/{имя}.json — IconifyJSON одного имени, с
// иконкой в конце цепочки и всей цепочкой алиасов. Не больше шести запросов к R2 сразу (лимит
// соединений Workers); тело читается в той же задаче, что его запросила: соединение, которое ждёт,
// пока другие закончат, Workers может оборвать. Нет файла — null; сбой R2 — ошибка хранилища.

import type { IconavoIconSet } from "@iconavo-ui/core";
import { READ_CONCURRENCY } from "./config.js";
import type { Bucket } from "./env.js";
import { StorageError } from "./http.js";

export const nameKey = (version: string, set: string, name: string) =>
  `v/${version}/${set}/${name}.json`;

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

/** Файлы имён набора: имя → данные или null, если такого имени в версии нет. */
export async function readNames(
  bucket: Bucket,
  version: string,
  set: string,
  names: readonly string[],
): Promise<Map<string, IconavoIconSet | null>> {
  const files = new Map<string, IconavoIconSet | null>();
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++] as string;
      let text: string | undefined;
      try {
        text = await (await bucket.get(nameKey(version, set, name)))?.text();
      } catch (e) {
        throw new StorageError(
          `файл имени не прочитан: ${(e as Error).message}`,
        );
      }
      files.set(name, text === undefined ? null : parseNameFile(text, set));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, names.length) }, worker),
  );
  return files;
}
