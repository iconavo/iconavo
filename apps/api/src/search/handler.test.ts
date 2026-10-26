import {
  SEARCH_MODEL,
  SEMANTIC_RATIO,
  STORE_KEYS,
  truncateUnit,
  vectorBytes,
  vectorHash,
} from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import {
  type FakeDoc,
  fakeBucket,
  fakeCache,
  fakeLimiter,
  fakeSearchFetch,
  MEILI_URL,
  manifestText,
  VERSION,
  waiter,
} from "../fake.testing.js";
import { createHandler } from "../handler.js";
import { limitKey } from "./handler.js";

const DOCS: FakeDoc[] = [
  {
    icon: "demo:house",
    set: "demo",
    names: ["demo:home", "demo:house", "home", "house"],
    words: ["house", "home", "дом"],
  },
  {
    icon: "demo:heart",
    set: "demo",
    names: ["demo:heart", "heart"],
    words: ["heart", "love", "сердце"],
  },
  {
    icon: "color:house",
    set: "color",
    names: ["color:house", "house"],
    words: ["house", "дом"],
  },
];
const INDEX = "1234abcd";

const unit = (seed: number) =>
  truncateUnit(
    Array.from({ length: SEARCH_MODEL.dims }, (_, i) => Math.cos(seed + i)),
    SEARCH_MODEL.dims,
  );

interface SetupOptions {
  polza?: (text: string) => Promise<number[]>;
  meiliStatus?: number;
  limiter?: ReturnType<typeof fakeLimiter>;
  deadlineMs?: number;
  /** Фразы каталога, векторы которых лежат в бакете поиска. */
  phrases?: string[];
  noMeili?: boolean;
  noIndex?: boolean;
  /** Часы функции, мс; по умолчанию стоят на нуле. */
  clock?: { t: number };
}

async function setup(o: SetupOptions = {}) {
  const searchFiles: Record<string, string | Uint8Array> = {};
  if (!o.noIndex) {
    searchFiles[STORE_KEYS.index] = JSON.stringify({ version: INDEX });
  }
  for (const [i, phrase] of (o.phrases ?? []).entries()) {
    searchFiles[STORE_KEYS.phrase(await vectorHash(SEARCH_MODEL.id, phrase))] =
      vectorBytes(unit(i));
  }
  const bucket = fakeBucket({
    "manifest.json": manifestText({ demo: VERSION, color: "89abcdef" }),
  });
  const searchBucket = fakeBucket(searchFiles);
  const cache = fakeCache();
  const logs: string[] = [];
  const net = fakeSearchFetch({
    docs: DOCS,
    ...(o.polza ? { polza: o.polza } : {}),
    ...(o.meiliStatus === undefined ? {} : { meiliStatus: o.meiliStatus }),
  });
  const make = () =>
    createHandler({
      bucket,
      cache,
      build: "test",
      now: () => o.clock?.t ?? 0,
      log: (message) => logs.push(message),
      search: {
        bucket: searchBucket,
        ...(o.limiter ? { limiter: o.limiter } : {}),
        ...(o.noMeili ? {} : { meili: { url: MEILI_URL, key: "search-key" } }),
        polzaKey: "polza-key",
        fetch: net.fn,
        deadlineMs: o.deadlineMs ?? 60_000,
      },
    });
  const w = waiter();
  const getter =
    (handler: ReturnType<typeof make>) => (path: string, init?: RequestInit) =>
      handler(new Request(`https://api.iconavo.dev${path}`, init), w.waitUntil);
  return {
    get: getter(make()),
    /** Другая копия функции в том же дата-центре: своя память, общий кэш. */
    copy: () => getter(make()),
    flush: () => w.flush(),
    cache,
    logs,
    net,
    bucket,
    searchBucket,
  };
}

const json = async (res: Response) => JSON.parse(await res.text());

describe("/search: полная выдача", () => {
  it("вектор фразы из бакета: точное имя первым, кэш браузеру — 5 минут, повтор — из кэша", async () => {
    const s = await setup({ phrases: ["house"] });
    const res = await s.get("/search?query=house");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(res.headers.get("x-iconavo-index")).toBe(INDEX);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("server-timing")).toMatch(/vector;desc="store"/);
    const body = await json(res);
    expect(body).toMatchObject({
      icons: ["demo:house", "color:house", "demo:heart"],
      total: 3,
      limit: 64,
      start: 0,
      semantic: "full",
    });
    expect(body.results[0]).toEqual({
      icon: "demo:house",
      variants: [],
      tones: [],
      exact: true,
    });
    expect(s.net.polza).toHaveLength(0);
    await s.flush();

    // «House» нормализуется в тот же ключ кэша.
    const again = await s.get("/search?query=House");
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect(again.headers.get("cache-control")).toBe("public, max-age=300");
    expect((await json(again)).semantic).toBe("full");
    expect(s.net.meili).toHaveLength(2);
  });

  it("тела multi-search: точное имя отдельно, основная выдача без него, гибрид с вектором", async () => {
    const s = await setup({ phrases: ["house"] });
    await s.get("/search?query=house&prefix=demo&palette=0&license=MIT");
    const hybrid = s.net.meili.find((b) =>
      b.queries.some((q) => q.vector !== undefined),
    );
    const [exact, main] = hybrid?.queries ?? [];
    expect(exact?.filter).toEqual([
      'set IN ["demo"]',
      "palette = false",
      'license IN ["MIT"]',
      'names = "house"',
    ]);
    expect(main?.filter).toContain('NOT names = "house"');
    expect(main?.hybrid).toEqual({
      embedder: "gemini",
      semanticRatio: SEMANTIC_RATIO,
    });
    expect(main?.vector).toHaveLength(SEARCH_MODEL.dims);
  });

  it("вектор от Polza — 1024 числа, в фоне; запомнен в дата-центре для следующих страниц", async () => {
    const s = await setup();
    const res = await s.get("/search?query=сердце");
    // Фразы в бакете нет: слова сразу, вектор — в фоне.
    expect((await json(res)).semantic).toBe("pending");
    await s.flush();
    expect(s.net.polza).toEqual([
      { model: SEARCH_MODEL.id, input: ["сердце"], dimensions: 1024 },
    ]);
    const meiliBefore = s.net.meili.length;
    const page = await s.get("/search?query=сердце&start=1&limit=1");
    expect(page.headers.get("server-timing")).toMatch(/vector;desc="cache"/);
    expect((await json(page)).semantic).toBe("full");
    expect(s.net.polza).toHaveLength(1);
    // С вектором из кэша — сразу гибрид, без поиска по словам впереди.
    expect(s.net.meili.length - meiliBefore).toBe(1);
  });

  it("холодная копия функции: манифест и версия индекса — из кэша дата-центра", async () => {
    const s = await setup({ phrases: ["house", "heart"] });
    await s.get("/search?query=house");
    const other = s.copy();
    const reads = s.bucket.reads.length;
    const searchReads = s.searchBucket.reads.length;
    const res = await other("/search?query=heart");
    expect(res.headers.get("x-iconavo-index")).toBe(INDEX);
    expect((await json(res)).semantic).toBe("full");
    // Из хранилищ новая копия читает только фразу запроса.
    expect(s.bucket.reads.slice(reads)).toEqual([]);
    expect(s.searchBucket.reads.slice(searchReads)).toEqual([
      STORE_KEYS.phrase(await vectorHash(SEARCH_MODEL.id, "heart")),
    ]);
  });
});

describe("/search: сначала текст", () => {
  it("смысл не успел — выдача по словам pending без кэша; фон докладывает полную в кэш", async () => {
    let release: (v: number[]) => void = () => {};
    const gate = new Promise<number[]>((resolve) => {
      release = resolve;
    });
    const s = await setup({ polza: () => gate, deadlineMs: 0 });
    const res = await s.get("/search?query=love");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.semantic).toBe("pending");
    expect(body.icons).toEqual(["demo:heart"]);
    release([0, 1, 0]);
    await s.flush();
    const again = await s.get("/search?query=love");
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect((await json(again)).semantic).toBe("full");
  });

  it("фразы нет — слова сразу, не дожидаясь срока; полная выдача — в фоне", async () => {
    let release: (v: number[]) => void = () => {};
    const gate = new Promise<number[]>((resolve) => {
      release = resolve;
    });
    // Срок — минута: если бы функция ждала модель, ответа не было бы до конца теста.
    const s = await setup({ polza: () => gate, deadlineMs: 60_000 });
    const res = await s.get("/search?query=love");
    expect((await json(res)).semantic).toBe("pending");
    expect(res.headers.get("server-timing")).toMatch(/vector;desc="pending"/);
    release([0, 1, 0]);
    await s.flush();
    const again = await s.get("/search?query=love");
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect((await json(again)).semantic).toBe("full");
  });

  it("Polza упала сразу — только слова (text), без кэша; запроса в журнале нет", async () => {
    const s = await setup({
      polza: async () => {
        throw new Error("boom");
      },
    });
    const res = await s.get("/search?query=сердце");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.semantic).toBe("text");
    expect(body.icons).toEqual(["demo:heart"]);
    expect(s.logs.join(" ")).toMatch(/Polza/);
    expect(s.logs.join(" ")).not.toContain("сердце");
  });

  it("Polza не ответила в фоне — 30 секунд только слова (text) и без Polza, затем снова модель", async () => {
    const clock = { t: 0 };
    // Как в жизни: модель отвечает дольше, чем уходит выдача по словам.
    let fail: () => void = () => {};
    const s = await setup({
      clock,
      polza: () =>
        new Promise<number[]>((_, reject) => {
          fail = () => reject(new Error("boom"));
        }),
    });
    const first = await s.get("/search?query=сердце");
    expect((await json(first)).semantic).toBe("pending");
    fail();
    await s.flush();
    expect(s.net.polza).toHaveLength(1);

    clock.t = 29_999;
    const res = await s.get("/search?query=love");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await json(res)).semantic).toBe("text");
    await s.flush();
    expect(s.net.polza).toHaveLength(1);

    clock.t = 30_000;
    const again = await s.get("/search?query=дом");
    expect((await json(again)).semantic).toBe("pending");
    fail();
    await s.flush();
    expect(s.net.polza).toHaveLength(2);
  });
});

describe("/search: ошибки и лимит", () => {
  it.each([
    ["/search", "query_required"],
    ["/search?query=", "query_required"],
    ["/search?query=demo%3A", "query_required"],
    ["/search?query=a&query=b", "duplicate_parameter"],
    [`/search?query=${"x".repeat(101)}`, "invalid_parameter"],
    ["/search?query=house&limit=0", "invalid_limit"],
    ["/search?query=house&limit=97", "invalid_limit"],
    ["/search?query=house&limit=x", "invalid_parameter"],
    ["/search?query=house&start=990&limit=20", "invalid_start"],
    ["/search?query=house&prefix=nope", "invalid_prefix"],
    ["/search?query=house&prefixes=demo,Bad", "invalid_prefix"],
    ["/search?query=house&license=MIT%22", "invalid_license"],
    ["/search?query=house&palette=maybe", "invalid_parameter"],
  ])("%s — 400 %s", async (path, code) => {
    const s = await setup();
    const res = await s.get(path);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(code);
  });

  it("нет ключей Meilisearch или он упал — 503 без кэша", async () => {
    const none = await setup({ noMeili: true });
    const res = await none.get("/search?query=house");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await json(res)).error).toBe("search_unavailable");
    const down = await setup({ meiliStatus: 500 });
    const failed = await down.get("/search?query=дом");
    expect(failed.status).toBe(503);
    expect(down.logs.join(" ")).toMatch(/HTTP 500/);
    expect(down.logs.join(" ")).not.toContain("дом");
  });

  it("лимит частоты — только мимо кэша; превышение — 429 без кэша", async () => {
    const limiter = fakeLimiter(1);
    const s = await setup({ limiter, phrases: ["house", "heart"] });
    expect((await s.get("/search?query=house")).status).toBe(200);
    await s.flush();
    expect((await s.get("/search?query=house")).headers.get("x-cache")).toBe(
      "HIT",
    );
    const res = await s.get("/search?query=heart");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...limiter.counts.values()].reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("версии индекса нет — none; HEAD — без тела", async () => {
    const s = await setup({ noIndex: true, phrases: ["house"] });
    const res = await s.get("/search?query=house", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-iconavo-index")).toBe("none");
    expect(await res.text()).toBe("");
  });
});

describe("limitKey", () => {
  it.each([
    ["203.0.113.5", "203.0.113.5"],
    ["2001:db8:abcd:12:1:2:3:4", "2001:db8:abcd:12::/64"],
    ["2001:DB8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::ffff:198.51.100.7", "198.51.100.7"],
    [null, "unknown"],
  ])("%s → %s", (ip, key) => {
    expect(limitKey(ip)).toBe(key);
  });
});
