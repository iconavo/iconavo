// Подменное хранилище для тестов: объекты в памяти, порядок вызовов, подложенные объекты и сбои.
// По умолчанию как R2 — ETag = MD5 содержимого; как Bunny — SHA-256 в списке и без ETag. Общий журнал
// нескольких хранилищ показывает порядок вызовов между хостами.

import { md5Hex } from "./s3.js";
import { sha256Hex } from "./sigv4.js";
import type { RemoteObject, StorageClient } from "./storage.js";

export interface FakeObject {
  body: Uint8Array;
  etag?: string;
  sha256?: string;
  contentType?: string;
  cacheControl?: string;
}

export type FakeOp = "list" | "put" | "get";

export interface FakeStorageOptions {
  /** ETag по телу объекта; по умолчанию — MD5, как у R2; null — ETag нет, как у Bunny. */
  etagOf?: ((body: Uint8Array) => string) | null;
  /** SHA-256 по телу объекта в списке, как у Bunny; по умолчанию нет. */
  sha256Of?: (body: Uint8Array) => string;
  /** Ошибка для операции: op, ключ или префикс, номер вызова этой операции (с 1). */
  fail?: (op: FakeOp, key: string, call: number) => Error | undefined;
  /** Имя хранилища в общем журнале. */
  name?: string;
  /** Общий журнал вызовов нескольких хранилищ: «имя op ключ». */
  journal?: string[];
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Как Bunny: SHA-256 в списке, ETag нет. */
export const BUNNY_LIKE: FakeStorageOptions = {
  etagOf: null,
  sha256Of: sha256Hex,
};

export function fakeStorage(options: FakeStorageOptions = {}) {
  const store = new Map<string, FakeObject>();
  const calls: { op: FakeOp; key: string }[] = [];
  const count = { list: 0, put: 0, get: 0 };
  const etagOf = options.etagOf === undefined ? md5Hex : options.etagOf;
  const digests = (body: Uint8Array): Pick<FakeObject, "etag" | "sha256"> => ({
    ...(etagOf === null ? {} : { etag: etagOf(body) }),
    ...(options.sha256Of === undefined
      ? {}
      : { sha256: options.sha256Of(body) }),
  });
  const begin = async (op: FakeOp, key: string) => {
    calls.push({ op, key });
    options.journal?.push(`${options.name ?? "хранилище"} ${op} ${key}`);
    count[op]++;
    await new Promise((resolve) => setImmediate(resolve));
    const error = options.fail?.(op, key, count[op]);
    if (error) throw error;
  };
  const client: StorageClient = {
    async list(prefix) {
      await begin("list", prefix);
      return [...store]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => order(a, b))
        .map(([key, o]): RemoteObject => {
          const out: RemoteObject = { key, size: o.body.byteLength };
          if (o.etag !== undefined) out.etag = o.etag;
          if (o.sha256 !== undefined) out.sha256 = o.sha256;
          return out;
        });
    },
    async put(key, body, o) {
      await begin("put", key);
      if (md5Hex(body) !== o.md5 || sha256Hex(body) !== o.sha256) {
        throw new Error(`тест: контрольная сумма не сходится с телом ${key}`);
      }
      const copy = new Uint8Array(body);
      store.set(key, {
        body: copy,
        ...digests(copy),
        contentType: o.contentType,
        cacheControl: o.cacheControl,
      });
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
    store.set(key, { body: bytes, ...digests(bytes) });
  };
  return { client, store, calls, puts, seed };
}
