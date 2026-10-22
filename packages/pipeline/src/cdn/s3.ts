// Клиент R2 поверх встроенного fetch (ADR-0022): три операции S3-совместимого API — список объектов
// по префиксу, запись объекта и чтение объекта. Подпись — sigv4.ts. Повторы и остановки — те же
// правила, что у Polza (embed/client.ts): временные отказы, сбои сети и истёкшее ожидание повторяются
// с паузой; ключ не подошёл — «СТОП» всего прогона; другой отказ — «СТОП» набора. Ключи никуда не
// печатаются, из сообщений об ошибках они вычищены.

import { createHash } from "node:crypto";
import { retryable, retryDelay } from "../embed/client.js";
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

export interface RemoteObject {
  key: string;
  size: number;
  /** ETag без кавычек, строчными; у обычной загрузки — MD5 содержимого в hex. */
  etag: string;
}

export interface PutOptions {
  contentType: string;
  cacheControl: string;
  /** MD5 содержимого в hex: уходит в Content-MD5, и сервер сверяет его с тем, что получил. */
  md5: string;
}

/** Та часть R2, которая нужна выгрузке; в тестах её подменяют (s3.testing.ts). */
export interface R2Client {
  /** Все объекты, ключи которых начинаются с prefix; страницы собираются вместе. */
  list(prefix: string): Promise<RemoteObject[]>;
  put(
    key: string,
    body: Uint8Array,
    options: PutOptions,
  ): Promise<{ etag: string }>;
  /** Содержимое объекта; нет объекта — undefined. */
  get(key: string): Promise<Uint8Array | undefined>;
}

/** Что останавливает ошибка: весь прогон (ключи, доступ) или только текущий набор. */
export type R2StopScope = "run" | "set";

export const r2Error = (message: string, scope: R2StopScope) =>
  Object.assign(new Error(message), { scope });

/** Ошибка без пометки — ошибка набора: остальные наборы продолжают. */
export const r2ErrorScope = (e: unknown): R2StopScope =>
  (e as { scope?: R2StopScope }).scope === "run" ? "run" : "set";

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

export function r2Client(options: R2Options): R2Client {
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? UPLOAD_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? UPLOAD_MAX_ATTEMPTS;
  const endpoint = new URL(r2Endpoint(options.accountId));
  const secrets = [options.secretAccessKey, options.accessKeyId].filter(
    (s) => s !== "",
  );
  // Начало ответа для сообщения об ошибке: в одну строку и без ключей, даже если сервер их повторил.
  const snippet = (text: string) => {
    let out = text;
    for (const secret of secrets) out = out.replaceAll(secret, "…");
    return out.replace(/\s+/g, " ").trim().slice(0, 300);
  };

  async function send(req: R2Request): Promise<Response> {
    const path =
      req.key === null ? `/${options.bucket}` : `/${options.bucket}/${req.key}`;
    const payloadHash =
      req.body === undefined ? EMPTY_SHA256 : sha256Hex(req.body);
    const label = `${req.method} ${req.key ?? `${options.bucket}/`}`;
    let last = "";
    for (let attempt = 1; ; attempt++) {
      let wait: number | undefined;
      try {
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
        const res = await fetchFn(`${endpoint.origin}${signed.target}`, {
          method: req.method,
          headers: signed.headers,
          body: req.body as BodyInit | undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok || (res.status === 404 && req.allow404 === true)) return res;
        const text = await res.text();
        const reason = `HTTP ${res.status}${text.trim() === "" ? "" : ` — ${snippet(text)}`}`;
        const fatal = R2_RUN_STOPS[res.status];
        if (fatal !== undefined) {
          throw r2Error(`${label}: ${fatal} (${reason})`, "run");
        }
        if (!retryable(res.status)) {
          throw r2Error(`${label}: запрос отклонён (${reason})`, "set");
        }
        last = reason;
        wait = retryDelay(res.headers.get("retry-after"), attempt);
      } catch (e) {
        const name = (e as Error).name;
        if (name === "TimeoutError" || name === "AbortError") {
          last = `нет ответа за ${Math.round(timeoutMs / 1000)} с`;
        } else if (
          e instanceof TypeError &&
          (e.message === "fetch failed" || "cause" in e)
        ) {
          // Так fetch в Node сообщает о сбое соединения; причина — в cause.
          const cause = (e as { cause?: { code?: string } }).cause?.code;
          last = `сбой сети${cause ? ` (${cause})` : ""}: ${e.message}`;
        } else {
          throw (e as { scope?: R2StopScope }).scope
            ? e
            : r2Error(`${label}: ${(e as Error).message}`, "set");
        }
      }
      if (attempt >= maxAttempts) {
        throw r2Error(
          `${label}: ${last} — не получилось за ${maxAttempts} попыток`,
          "set",
        );
      }
      await sleep(wait ?? retryDelay(null, attempt));
    }
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
        const res = await send({ method: "GET", key: null, query });
        const page = parseListPage(await res.text());
        out.push(...page.objects);
        if (page.next === undefined) return out;
        token = page.next;
      }
    },
    async put(key, body, o) {
      const res = await send({
        method: "PUT",
        key,
        body,
        headers: {
          "content-type": o.contentType,
          "cache-control": o.cacheControl,
          "content-md5": Buffer.from(o.md5, "hex").toString("base64"),
        },
      });
      return { etag: unquote(res.headers.get("etag") ?? "") };
    },
    async get(key) {
      const res = await send({ method: "GET", key, allow404: true });
      if (res.status === 404) return undefined;
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
