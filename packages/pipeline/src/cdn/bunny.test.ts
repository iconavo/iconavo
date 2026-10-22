import { describe, expect, it } from "vitest";
import type { FetchFn } from "../sources/npm.js";
import { bunnyClient, parseBunnyList } from "./bunny.js";
import { md5Hex } from "./s3.js";
import { sha256Hex } from "./sigv4.js";
import { storageErrorScope } from "./storage.js";

const PASSWORD = "pa55-word-1234";
const ENDPOINT = "https://storage.test";

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
  const c = bunnyClient({
    zone: "zone",
    password: PASSWORD,
    endpoint: ENDPOINT,
    fetch: f.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    maxAttempts: extra.maxAttempts ?? 3,
  });
  return { c, requests: f.requests, sleeps };
}

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

/** Строка списка папки, как её отдаёт Bunny. */
const entry = (
  name: string,
  extra: { dir?: boolean; length?: number; checksum?: string | null } = {},
) => ({
  Guid: "00000000-0000-0000-0000-000000000000",
  StorageZoneName: "zone",
  Path: "/zone/v/x/",
  ObjectName: name,
  Length: extra.length ?? 10,
  LastChanged: "2026-10-22T07:00:00.000",
  IsDirectory: extra.dir === true,
  ServerId: 0,
  UserId: "u",
  ContentType: "",
  DateCreated: "2026-10-22T07:00:00.000",
  StorageZoneId: 1,
  Checksum: extra.checksum === undefined ? "AB".repeat(32) : extra.checksum,
  ReplicatedZones: "",
});

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("bunnyClient.put", () => {
  it("PUT с паролем, SHA-256 прописными и типом; Cache-Control не отправляется", async () => {
    const body = new Uint8Array(Buffer.from('{"a":1}', "utf8"));
    const { c, requests } = client([
      () => json({ HttpCode: 201, Message: "File uploaded." }, 201),
    ]);
    await c.put("v/x/demo/a.json", body, {
      contentType: "application/json; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
      md5: md5Hex(body),
      sha256: sha256Hex(body),
    });
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req?.url).toBe("https://storage.test/zone/v/x/demo/a.json");
    expect(req?.init.method).toBe("PUT");
    expect(req?.init.body).toBe(body);
    expect(headersOf(req?.init ?? {})).toEqual({
      AccessKey: PASSWORD,
      Checksum: sha256Hex(body).toUpperCase(),
      "Content-Type": "application/json; charset=utf-8",
    });
  });
});

describe("bunnyClient.list", () => {
  it("папка префикса, затем совпавшие папки целиком; SHA-256 строчными, по порядку ключей", async () => {
    const { c, requests } = client([
      () =>
        json([
          entry("demo", { dir: true }),
          entry("demo.checksums.json", { length: 50 }),
          entry("other", { dir: true }),
          entry("other.checksums.json"),
        ]),
      () =>
        json([
          entry("b.svg", { length: 12, checksum: "CD".repeat(32) }),
          entry("a.json", { length: 11 }),
        ]),
    ]);
    const objects = await c.list("v/x/demo");
    expect(requests.map((r) => r.url)).toEqual([
      "https://storage.test/zone/v/x/",
      "https://storage.test/zone/v/x/demo/",
    ]);
    expect(headersOf(requests[0]?.init ?? {})).toEqual({ AccessKey: PASSWORD });
    expect(objects).toEqual([
      { key: "v/x/demo.checksums.json", size: 50, sha256: "ab".repeat(32) },
      { key: "v/x/demo/a.json", size: 11, sha256: "ab".repeat(32) },
      { key: "v/x/demo/b.svg", size: 12, sha256: "cd".repeat(32) },
    ]);
  });

  it("папки нет — пустой список", async () => {
    const { c } = client([
      () => json([{ HttpCode: 404, Message: "Not found" }], 404),
    ]);
    expect(await c.list("v/x/demo")).toEqual([]);
  });

  it("Checksum нет или не SHA-256 — у файла нет контрольной суммы", () => {
    const { files } = parseBunnyList(
      [
        entry("a.json", { checksum: null }),
        entry("b.json", { checksum: "" }),
        entry("c.json", { checksum: "XYZ" }),
      ],
      "v/x/demo/",
    );
    expect(files).toEqual([
      { key: "v/x/demo/a.json", size: 10 },
      { key: "v/x/demo/b.json", size: 10 },
      { key: "v/x/demo/c.json", size: 10 },
    ]);
  });

  it("ответ не список — ошибка набора без повторов", async () => {
    const { c, requests } = client([() => json({ HttpCode: 200 })]);
    const error = await c.list("v/x/demo").catch((e: Error) => e);
    expect(storageErrorScope(error)).toBe("set");
    expect((error as Error).message).toContain("не список файлов Bunny");
    expect(requests).toHaveLength(1);
  });

  it("обрыв посреди списка — повтор", async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('[{"ObjectName":'));
            controller.error(
              new TypeError("terminated", {
                cause: { code: "UND_ERR_SOCKET" },
              }),
            );
          },
        }),
        { status: 200 },
      );
    const { c, sleeps } = client([broken, () => json([entry("a.json")])]);
    expect(await c.list("v/x/")).toEqual([
      { key: "v/x/a.json", size: 10, sha256: "ab".repeat(32) },
    ]);
    expect(sleeps).toEqual([1000]);
  });
});

describe("bunnyClient.get", () => {
  it("404 — файла нет; 200 — байты", async () => {
    const { c, requests } = client([
      () => json([{ HttpCode: 404, Message: "Not found" }], 404),
      () => new Response("{}", { status: 200 }),
    ]);
    expect(await c.get("manifest.json")).toBeUndefined();
    expect(Buffer.from((await c.get("manifest.json")) ?? []).toString()).toBe(
      "{}",
    );
    expect(requests[0]?.url).toBe("https://storage.test/zone/manifest.json");
  });
});

describe("повторы и остановки", () => {
  it("400 у Bunny временный — повтор; 429 — по Retry-After", async () => {
    const { c, sleeps } = client([
      () => new Response("Unable to process request", { status: 400 }),
      () =>
        new Response("busy", { status: 429, headers: { "retry-after": "2" } }),
      () => json([]),
    ]);
    expect(await c.list("v/")).toEqual([]);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("401 — остановка хоста с подсказкой, пароль из ответа вычищен, без повторов", async () => {
    const { c, requests } = client([
      () =>
        new Response(`{"HttpCode":401,"Message":"Unauthorized ${PASSWORD}"}`, {
          status: 401,
        }),
    ]);
    const error = await c.get("manifest.json").catch((e: Error) => e);
    expect(storageErrorScope(error)).toBe("run");
    const message = (error as Error).message;
    expect(message).toContain("BUNNY_STORAGE_PASSWORD");
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(PASSWORD);
    expect(requests).toHaveLength(1);
  });

  it("постоянный 400 — ошибка набора после всех попыток", async () => {
    const { c, requests } = client(
      [
        () => new Response("Checksum mismatch", { status: 400 }),
        () => new Response("Checksum mismatch", { status: 400 }),
      ],
      { maxAttempts: 2 },
    );
    const body = new Uint8Array([1, 2, 3]);
    const error = await c
      .put("v/x/a.json", body, {
        contentType: "application/json; charset=utf-8",
        cacheControl: "public",
        md5: md5Hex(body),
        sha256: sha256Hex(body),
      })
      .catch((e: Error) => e);
    expect(storageErrorScope(error)).toBe("set");
    expect((error as Error).message).toBe(
      "PUT v/x/a.json: HTTP 400 — Checksum mismatch — не получилось за 2 попыток",
    );
    expect(requests).toHaveLength(2);
  });
});
