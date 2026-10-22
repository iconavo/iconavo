import { describe, expect, it } from "vitest";
import type { FetchFn } from "../sources/npm.js";
import { md5Hex, parseListPage, r2Client } from "./s3.js";
import { sha256Hex } from "./sigv4.js";
import { storageErrorScope } from "./storage.js";

const SECRET = "SECRET/KEY+VALUE";
const NOW = Date.UTC(2026, 9, 22, 7, 0, 0);

type Reply = () => Response;

/** Подменный fetch: ответы по очереди, запросы запоминаются. */
function fakeFetch(replies: Reply[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fn: FetchFn = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    const reply = replies.shift();
    if (!reply) throw new Error("тест: ответов больше нет");
    return reply();
  };
  return { fetch: fn, requests };
}

function client(replies: Reply[], extra: { maxAttempts?: number } = {}) {
  const f = fakeFetch(replies);
  const sleeps: number[] = [];
  const c = r2Client({
    accountId: "acc0",
    accessKeyId: "AKID",
    secretAccessKey: SECRET,
    bucket: "b",
    fetch: f.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
    maxAttempts: extra.maxAttempts ?? 3,
  });
  return { c, requests: f.requests, sleeps };
}

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

const page = (keys: readonly string[], next?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>b</Name><Prefix>v/x/demo</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys>
  <IsTruncated>${next === undefined ? "false" : "true"}</IsTruncated>
  ${next === undefined ? "" : `<NextContinuationToken>${next}</NextContinuationToken>`}
  ${keys
    .map(
      (k, i) =>
        `<Contents><Key>${k}</Key><LastModified>2026-10-22T07:00:00.000Z</LastModified><ETag>&quot;${"ab".repeat(16)}${i}&quot;</ETag><Size>${10 + i}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join("")}
</ListBucketResult>`;

describe("r2Client.put", () => {
  it("подписанный PUT с типом, кэшем и Content-MD5", async () => {
    const body = new Uint8Array(Buffer.from('{"a":1}', "utf8"));
    const md5 = md5Hex(body);
    const { c, requests } = client([
      () => new Response(null, { status: 200, headers: { etag: `"${md5}"` } }),
    ]);
    await c.put("v/x/demo/a.json", body, {
      contentType: "application/json; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
      md5,
      sha256: sha256Hex(body),
    });
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req?.url).toBe(
      "https://acc0.r2.cloudflarestorage.com/b/v/x/demo/a.json",
    );
    expect(req?.init.method).toBe("PUT");
    expect(req?.init.body).toBe(body);
    const h = headersOf(req?.init ?? {});
    expect(h["content-type"]).toBe("application/json; charset=utf-8");
    expect(h["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(h["content-md5"]).toBe(Buffer.from(md5, "hex").toString("base64"));
    expect(h["x-amz-content-sha256"]).toBe(sha256Hex(body));
    expect(h["x-amz-date"]).toBe("20261022T070000Z");
    expect(h.host).toBeUndefined();
    expect(h.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/20261022\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-md5;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });
});

describe("r2Client.list", () => {
  it("собирает страницы по маркеру, кодирует запрос, снимает кавычки с ETag", async () => {
    const { c, requests } = client([
      () => new Response(page(["v/x/demo/a.json", "v/x/demo/a.svg"], "t+1=/")),
      () => new Response(page(["v/x/demo/b.json"])),
    ]);
    const objects = await c.list("v/x/demo");
    expect(objects).toEqual([
      { key: "v/x/demo/a.json", size: 10, etag: `${"ab".repeat(16)}0` },
      { key: "v/x/demo/a.svg", size: 11, etag: `${"ab".repeat(16)}1` },
      { key: "v/x/demo/b.json", size: 10, etag: `${"ab".repeat(16)}0` },
    ]);
    expect(requests.map((r) => r.url)).toEqual([
      "https://acc0.r2.cloudflarestorage.com/b?list-type=2&max-keys=1000&prefix=v%2Fx%2Fdemo",
      "https://acc0.r2.cloudflarestorage.com/b?continuation-token=t%2B1%3D%2F&list-type=2&max-keys=1000&prefix=v%2Fx%2Fdemo",
    ]);
    expect(requests[0]?.init.method).toBe("GET");
    expect(headersOf(requests[0]?.init ?? {})["x-amz-content-sha256"]).toBe(
      sha256Hex(""),
    );
  });

  it("parseListPage — обрезанный список без маркера и чужой корень — ошибка", () => {
    expect(() =>
      parseListPage(
        "<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>",
      ),
    ).toThrow("маркера");
    expect(() => parseListPage("<Error><Code>x</Code></Error>")).toThrow(
      "не ListBucketResult",
    );
    expect(parseListPage("<ListBucketResult></ListBucketResult>")).toEqual({
      objects: [],
    });
  });
});

describe("r2Client.get", () => {
  it("404 — объекта нет; 200 — байты", async () => {
    const { c } = client([
      () => new Response("<Error/>", { status: 404 }),
      () => new Response("{}", { status: 200 }),
    ]);
    expect(await c.get("manifest.json")).toBeUndefined();
    expect(Buffer.from((await c.get("manifest.json")) ?? []).toString()).toBe(
      "{}",
    );
  });
});

describe("повторы и остановки", () => {
  it("503 и 429 с Retry-After повторяются с паузой", async () => {
    const { c, sleeps } = client([
      () => new Response("down", { status: 503 }),
      () =>
        new Response("busy", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      () => new Response(page([])),
    ]);
    expect(await c.list("v/")).toEqual([]);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("сбой сети — повтор, после всех попыток — ошибка набора", async () => {
    const { c, sleeps } = client(
      [
        () => {
          throw new TypeError("fetch failed", {
            cause: { code: "ECONNRESET" },
          });
        },
        () => {
          throw new TypeError("fetch failed", {
            cause: { code: "ECONNRESET" },
          });
        },
      ],
      { maxAttempts: 2 },
    );
    const error = await c.get("manifest.json").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "GET manifest.json: сбой сети (ECONNRESET): fetch failed — не получилось за 2 попыток",
    );
    expect(storageErrorScope(error)).toBe("set");
    expect(sleeps).toEqual([1000]);
  });

  it("403 — остановка прогона с подсказкой про ключи, секрет из ответа вычищен", async () => {
    const { c, requests } = client([
      () =>
        new Response(
          `<Error><Code>AccessDenied</Code><Message>${SECRET} AKID</Message></Error>`,
          { status: 403 },
        ),
    ]);
    const error = await c.list("v/").catch((e: Error) => e);
    expect(storageErrorScope(error)).toBe("run");
    const message = (error as Error).message;
    expect(message).toContain("Object Read & Write");
    expect(message).toContain("HTTP 403");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("AKID");
    expect(requests).toHaveLength(1);
  });

  it("400 — ошибка набора без повторов", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const { c, requests } = client([
      () =>
        new Response("<Error><Code>BadDigest</Code></Error>", { status: 400 }),
    ]);
    const error = await c
      .put("v/x/a.json", body, {
        contentType: "application/json",
        cacheControl: "public",
        md5: md5Hex(body),
        sha256: sha256Hex(body),
      })
      .catch((e: Error) => e);
    expect(storageErrorScope(error)).toBe("set");
    expect((error as Error).message).toContain("BadDigest");
    expect(requests).toHaveLength(1);
  });
});
