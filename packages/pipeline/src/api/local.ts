// Подделки привязок Workers для превью функций (edge API, MCP) и общий заслон по Host. Модуль лёгкий —
// без zod и схем: процесс превью MCP грузит только его, и настройки zod конвейера (русские сообщения,
// они общие через globalThis) не попадают в функцию — её ошибки остаются такими же, как в Workers.

import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";

/** Хост запроса — адрес этого сервера: 127.0.0.1 или localhost с тем же портом. */
export const allowedHost = (host: string | undefined, port: number) =>
  host === `127.0.0.1:${port}` || host === `localhost:${port}`;

/** Файл внутри dir; путь за её пределы — нет. */
export async function fileIn(
  dir: string,
  path: string,
): Promise<Uint8Array | null> {
  const file = normalize(join(dir, path));
  const rel = relative(dir, file);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

/** Привязка R2 из папки раздачи: ключ — путь от её корня. */
export function diskBucket(dir: string) {
  return {
    async get(key: string) {
      const data = await fileIn(dir, key);
      if (data === null) return null;
      const text = Buffer.from(data).toString("utf8");
      return {
        text: async () => text,
        // Копия ровно этих байт: Buffer.slice память не копирует, а у пустого файла и у Buffer из общего
        // пула .buffer больше самих данных (ревизия фазы 5, А-34).
        arrayBuffer: async () => new Uint8Array(data).buffer as ArrayBuffer,
      };
    },
  };
}

const MAX_AGE = /max-age=(\d+)/;

/** Cache API в памяти: только GET, записи живут max-age, как у Workers. */
export function memoryCache(now: () => number = Date.now) {
  const stored = new Map<
    string,
    {
      status: number;
      headers: [string, string][];
      body: ArrayBuffer;
      at: number;
      ttl?: number;
    }
  >();
  return {
    async match(request: Request) {
      const entry = stored.get(request.url);
      if (entry === undefined) return undefined;
      if (entry.ttl !== undefined && now() - entry.at >= entry.ttl) {
        stored.delete(request.url);
        return undefined;
      }
      return new Response(entry.body, {
        status: entry.status,
        headers: entry.headers,
      });
    },
    async put(request: Request, response: Response) {
      if (request.method !== "GET") {
        throw new TypeError("Cannot cache response to non-GET request.");
      }
      const maxAge = MAX_AGE.exec(
        response.headers.get("cache-control") ?? "",
      )?.[1];
      stored.set(request.url, {
        status: response.status,
        headers: [...response.headers],
        body: await response.arrayBuffer(),
        at: now(),
        ...(maxAge === undefined ? {} : { ttl: Number(maxAge) * 1000 }),
      });
    },
  };
}
