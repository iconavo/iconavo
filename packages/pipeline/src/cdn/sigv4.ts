// Подпись запросов по AWS Signature V4 — так авторизуется S3-совместимый API R2 (ADR-0022). Своими
// силами, без зависимостей (решение владельца 22 октября 2026): ключ хранилища — самый
// чувствительный секрет проекта, через чужой код он не проходит. Только чистые функции: время и
// ключи приходят параметрами. Проверено на официальных примерах Amazon (sigv4.test.ts).

import { createHash, createHmac } from "node:crypto";

/** SHA-256 пустого тела — у запросов без тела. */
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: string | Uint8Array, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Кодирование по RFC 3986, как требует подпись: нетронутыми остаются только буквы, цифры и «-_.~».
 * encodeURIComponent оставляет ещё «!'()*» — их дожимаем; пробел — %20.
 */
export function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Канонический путь: каждый сегмент кодируется отдельно, «/» остаются; S3 путь не нормализует. */
export const canonicalPath = (path: string): string =>
  path.split("/").map(uriEncode).join("/");

/** Канонический запрос: пары в порядке кодированных имён, потом значений; пустое значение — «имя=». */
export function canonicalQuery(
  params: readonly (readonly [string, string])[],
): string {
  return params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => order(a[0], b[0]) || order(a[1], b[1]))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Время запроса в формате подписи: 20150830T123600Z. */
export const amzDate = (date: Date): string =>
  date.toISOString().replace(/[-:]|\.\d{3}/g, "");

export interface SignInput {
  method: string;
  /** Хост запроса, например {аккаунт}.r2.cloudflarestorage.com. */
  host: string;
  /** Путь без кодирования, например /iconavo-cdn/v/dbde54d2/lucide/home.json. */
  path: string;
  query?: readonly (readonly [string, string])[];
  /** Заголовки в подписи, кроме host и x-amz-date — их подпись добавляет сама. Имена строчными. */
  headers?: Readonly<Record<string, string>>;
  /** SHA-256 тела в hex; у запроса без тела — EMPTY_SHA256. */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  date: Date;
}

export interface SignedRequest {
  /** Путь и запрос адреса в каноническом виде — их и отправляем. */
  target: string;
  /** Заголовки запроса: входные плюс x-amz-date и authorization; host выставит сам fetch. */
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

/** Заголовки в подписи: имена строчными, значения без краёв и с одиночными пробелами, по алфавиту. */
function canonicalHeaders(
  headers: Readonly<Record<string, string>>,
): [text: string, signed: string] {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => order(a[0], b[0]));
  return [
    entries.map(([k, v]) => `${k}:${v}\n`).join(""),
    entries.map(([k]) => k).join(";"),
  ];
}

/** Подписывает запрос: канонический вид → строка для подписи → цепочка HMAC → Authorization. */
export function signRequest(input: SignInput): SignedRequest {
  const date = amzDate(input.date);
  const day = date.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const [headerText, signedHeaders] = canonicalHeaders({
    ...input.headers,
    host: input.host,
    "x-amz-date": date,
  });
  const query = canonicalQuery(input.query ?? []);
  const canonicalRequest = [
    input.method,
    canonicalPath(input.path),
    query,
    headerText,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");
  return {
    target: `${canonicalPath(input.path)}${query === "" ? "" : `?${query}`}`,
    headers: {
      ...input.headers,
      "x-amz-date": date,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
}
