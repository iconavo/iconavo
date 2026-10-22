// Подменный клиент R2 для тестов: хранилище в памяти, порядок вызовов, подложенные объекты и сбои.
// ETag — MD5 содержимого, как у R2 при обычной загрузке; тест может подменить правило.

import { md5Hex, type R2Client, type RemoteObject } from "./s3.js";

export interface FakeObject {
  body: Uint8Array;
  etag: string;
  contentType?: string;
  cacheControl?: string;
}

export type FakeOp = "list" | "put" | "get";

export interface FakeR2Options {
  /** ETag по телу объекта; по умолчанию — MD5. */
  etagOf?: (body: Uint8Array) => string;
  /** Ошибка для операции: op, ключ или префикс, номер вызова этой операции (с 1). */
  fail?: (op: FakeOp, key: string, call: number) => Error | undefined;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function fakeR2Client(options: FakeR2Options = {}) {
  const store = new Map<string, FakeObject>();
  const calls: { op: FakeOp; key: string }[] = [];
  const count = { list: 0, put: 0, get: 0 };
  const etagOf = options.etagOf ?? md5Hex;
  const begin = async (op: FakeOp, key: string) => {
    calls.push({ op, key });
    count[op]++;
    await new Promise((resolve) => setImmediate(resolve));
    const error = options.fail?.(op, key, count[op]);
    if (error) throw error;
  };
  const client: R2Client = {
    async list(prefix) {
      await begin("list", prefix);
      return [...store]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => order(a, b))
        .map(
          ([key, o]): RemoteObject => ({
            key,
            size: o.body.byteLength,
            etag: o.etag,
          }),
        );
    },
    async put(key, body, o) {
      await begin("put", key);
      if (md5Hex(body) !== o.md5) {
        throw new Error(`тест: Content-MD5 не сходится с телом ${key}`);
      }
      const copy = new Uint8Array(body);
      const etag = etagOf(copy);
      store.set(key, {
        body: copy,
        etag,
        contentType: o.contentType,
        cacheControl: o.cacheControl,
      });
      return { etag };
    },
    async get(key) {
      await begin("get", key);
      return store.get(key)?.body;
    },
  };
  /** Ключи записей по порядку вызовов. */
  const puts = () => calls.filter((c) => c.op === "put").map((c) => c.key);
  /** Положить объект «как будто уже выгружен». */
  const seed = (key: string, body: Uint8Array | string) => {
    const bytes = new Uint8Array(
      typeof body === "string" ? Buffer.from(body, "utf8") : body,
    );
    store.set(key, { body: bytes, etag: etagOf(bytes) });
  };
  return { client, store, calls, puts, seed };
}
