// Клиент R2 поверх встроенного fetch (ADR-0022): три операции S3-совместимого API — список объектов
// по префиксу, запись объекта и чтение объекта. Подпись — sigv4.ts; повторы и остановки — общие для
// хранилищ (storage.ts): временные отказы, сбои сети и истёкшее ожидание повторяются с паузой; ключ
// не подошёл — «СТОП» всего хоста; другой отказ — «СТОП» набора. Ключи никуда не печатаются, из
// сообщений об ошибках они вычищены.

import { createHash } from "node:crypto";
import { retryable } from "../embed/client.js";
import type { FetchFn } from "../sources/npm.js";
import { parseXml, type XmlElement } from "../svg/xml.js";
import {
  LIST_PAGE_SIZE,
  R2_REGION,
  r2Endpoint,
  UPLOAD_MAX_ATTEMPTS,
  UPLOAD_TIMEOUT_MS,
} from "./config.js";
import { EMPTY_SHA256, sha256Hex, signRequest } from "./sigv4.js";
import {
  type RemoteObject,
  requestWithRetries,
  type StorageClient,
} from "./storage.js";

/** Ответы, после которых нет смысла продолжать ни один набор. */
export const R2_RUN_STOPS: Record<number, string> = {
  401: "ключ R2 не подошёл — проверьте R2_ACCESS_KEY_ID и R2_SECRET_ACCESS_KEY",
  403: "у ключа R2 нет доступа к бакету — нужен токен «Object Read & Write» на этот бакет; проверьте и R2_ACCOUNT_ID",
};

export const md5Hex = (data: Uint8Array): string =>
  createHash("md5").update(data).digest("hex");

const unquote = (etag: string) => etag.replace(/^"|"$/g, "").toLowerCase();

const textOf = (el: XmlElement): string =>
  el.children.map((c) => (c.type === "text" ? c.text : "")).join("");

const childElements = (el: XmlElement, name: string): XmlElement[] =>
  el.children.filter(
    (c): c is XmlElement => c.type === "element" && c.local === name,
  );

const childText = (el: XmlElement, name: string): string | undefined => {
  const child = childElements(el, name)[0];
  return child === undefined ? undefined : textOf(child);
};

/** Разбор ответа ListObjectsV2: объекты страницы и маркер следующей, если список обрезан. */
export function parseListPage(xml: string): {
  objects: RemoteObject[];
  next?: string;
} {
  const root = parseXml(xml).root;
  if (root.local !== "ListBucketResult") {
    throw new Error(`ответ списка — не ListBucketResult, а ${root.qname}`);
  }
  const objects: RemoteObject[] = [];
  for (const item of childElements(root, "Contents")) {
    const key = childText(item, "Key");
    const size = Number(childText(item, "Size"));
    const etag = childText(item, "ETag");
    if (key === undefined || etag === undefined || !Number.isInteger(size)) {
      throw new Error("в ответе списка нет Key, Size или ETag");
    }
    objects.push({ key, size, etag: unquote(etag) });
  }
  const truncated = childText(root, "IsTruncated") === "true";
  const next = childText(root, "NextContinuationToken");
  if (truncated && (next === undefined || next === "")) {
    throw new Error("список обрезан, а маркера следующей страницы нет");
  }
  return truncated ? { objects, next } : { objects };
}

export interface R2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  /** Текущее время в миллисекундах эпохи — для x-amz-date. */
  now?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Подсказки к ответам 401 и 403 — у другого бакета свои ключи (бакет поиска, ADR-0049). */
  runStops?: Record<number, string>;
}

interface R2Request {
  method: "GET" | "PUT";
  /** Ключ объекта; null — сам бакет (список). */
  key: string | null;
  query?: readonly (readonly [string, string])[];
  headers?: Record<string, string>;
  body?: Uint8Array;
  /** Ответ 404 — не ошибка, а «объекта нет». */
  allow404?: boolean;
}

export function r2Client(options: R2Options): StorageClient {
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const endpoint = new URL(r2Endpoint(options.accountId));
  const rules = {
    runStops: options.runStops ?? R2_RUN_STOPS,
    retryable,
    secrets: [options.secretAccessKey, options.accessKeyId],
    sleep,
    timeoutMs: options.timeoutMs ?? UPLOAD_TIMEOUT_MS,
    maxAttempts: options.maxAttempts ?? UPLOAD_MAX_ATTEMPTS,
  };

  function request<T>(
    req: R2Request,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    const path =
      req.key === null ? `/${options.bucket}` : `/${options.bucket}/${req.key}`;
    const payloadHash =
      req.body === undefined ? EMPTY_SHA256 : sha256Hex(req.body);
    const label = `${req.method} ${req.key ?? `${options.bucket}/`}`;
    return requestWithRetries(
      label,
      (signal) => {
        // Подпись — заново на каждую попытку: в ней время запроса.
        const signed = signRequest({
          method: req.method,
          host: endpoint.host,
          path,
          query: req.query,
          headers: { ...req.headers, "x-amz-content-sha256": payloadHash },
          payloadHash,
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
          region: R2_REGION,
          service: "s3",
          date: new Date(now()),
        });
        return fetchFn(`${endpoint.origin}${signed.target}`, {
          method: req.method,
          headers: signed.headers,
          body: req.body as BodyInit | undefined,
          signal,
        });
      },
      read,
      { ...rules, allow404: req.allow404 },
    );
  }

  return {
    async list(prefix) {
      const out: RemoteObject[] = [];
      let token: string | undefined;
      for (;;) {
        const query: [string, string][] = [
          ["list-type", "2"],
          ["max-keys", String(LIST_PAGE_SIZE)],
          ["prefix", prefix],
        ];
        if (token !== undefined) query.push(["continuation-token", token]);
        const page = await request(
          { method: "GET", key: null, query },
          async (res) => parseListPage(await res.text()),
        );
        out.push(...page.objects);
        if (page.next === undefined) return out;
        token = page.next;
      }
    },
    async put(key, body, o) {
      await request(
        {
          method: "PUT",
          key,
          body,
          headers: {
            "content-type": o.contentType,
            "cache-control": o.cacheControl,
            "content-md5": Buffer.from(o.md5, "hex").toString("base64"),
          },
        },
        async (res) => {
          await res.arrayBuffer();
        },
      );
    },
    async get(key) {
      return request({ method: "GET", key, allow404: true }, async (res) => {
        const body = new Uint8Array(await res.arrayBuffer());
        return res.status === 404 ? undefined : body;
      });
    },
  };
}
