import { describe, expect, it } from "vitest";
import { parseCatalogIndex, prefixFilter } from "./catalog.js";
import {
  fakeBucket,
  fakeCache,
  LAST_MODIFIED,
  manifestText,
  VERSION,
  waiter,
} from "./fake.testing.js";
import { createHandler } from "./handler.js";
import { compactJson } from "./json.js";

const CATALOG = "aaaaaaaaaaaa";
const DEMO_BODY = "bbbbbbbbbbbb";
const COLOR_BODY = "cccccccccccc";
const RELEASES = "dddddddddddd";
const COLOR_VERSION = "89abcdef";

const INFO = {
  name: "Demo",
  total: 2,
  version: "1.2.3",
  author: { name: "Demo" },
  license: { title: "MIT", spdx: "MIT" },
  height: 24,
  palette: false,
};
const LICENSE = {
  text: "MIT License",
  source: "https://example.com/demo",
  revision: "1.2.3",
};
const BODY = compactJson({
  aliases: { home: "house" },
  prefix: "demo",
  title: "Demo",
  total: 2,
  uncategorized: ["heart", "house"],
});
const RELEASES_BODY = compactJson({
  releases: [
    {
      date: "2026-10-28T00:00:00Z",
      prefix: "demo-color",
      revision: "2.0.0",
      total: 1,
      version: COLOR_VERSION,
    },
    {
      date: "2026-10-20T00:00:00Z",
      prefix: "demo",
      revision: "1.2.3",
      total: 2,
      version: VERSION,
    },
  ],
});

function files(catalog = CATALOG): Record<string, string> {
  return {
    "manifest.json": manifestText(
      { demo: VERSION, "demo-color": COLOR_VERSION },
      catalog,
    ),
    [`catalog/${CATALOG}.json`]: compactJson({
      changelog: RELEASES,
      sets: {
        demo: { collection: DEMO_BODY, info: INFO, license: LICENSE },
        "demo-color": {
          collection: COLOR_BODY,
          info: { ...INFO, name: "Color", palette: true },
          license: LICENSE,
        },
      },
    }),
    [`catalog/demo/${DEMO_BODY}.json`]: BODY,
    [`catalog/demo-color/${COLOR_BODY}.json`]: compactJson({
      prefix: "demo-color",
      title: "Color",
      total: 1,
      uncategorized: ["swan"],
    }),
    [`catalog/changelog/${RELEASES}.json`]: RELEASES_BODY,
  };
}

function setup() {
  const bucket = fakeBucket(files());
  const cache = fakeCache();
  const handler = createHandler({ bucket, cache, build: "test" });
  const w = waiter();
  const get = async (path: string) => {
    const res = await handler(
      new Request(`https://api.iconavo.dev${path}`),
      w.waitUntil,
    );
    await w.flush();
    return res;
  };
  return { bucket, cache, get };
}

const json = async (res: Response) => JSON.parse(await res.text());

describe("каталог наборов", () => {
  it("/collections — IconifyInfo наборов манифеста, без полного текста лицензии", async () => {
    const { get } = setup();
    const res = await get("/collections");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      demo: INFO,
      "demo-color": { ...INFO, name: "Color", palette: true },
    });
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "x-iconavo-version": CATALOG,
      "x-iconavo-build": "test",
    });
  });

  it("prefix и prefixes — как у Iconify: имя или начало имени с «-»", async () => {
    const { get } = setup();
    expect(
      Object.keys(await json(await get("/collections?prefix=demo"))),
    ).toEqual(["demo"]);
    expect(
      Object.keys(await json(await get("/collections?prefixes=demo-,nope"))),
    ).toEqual(["demo-color"]);
    expect(
      await json(await get("/collections?prefixes=nope&pretty=1")),
    ).toEqual({});
  });

  it("/collection — тело из каталога как есть; info — первым полем, с полным текстом лицензии", async () => {
    const { get, bucket } = setup();
    const plain = await get("/collection?prefix=demo");
    expect(plain.status).toBe(200);
    expect(await plain.text()).toBe(BODY);
    expect(plain.headers.get("x-iconavo-version")).toBe(VERSION);
    expect(plain.headers.get("x-cache")).toBe("MISS");
    const withInfo = await json(await get("/collection?prefix=demo&info=true"));
    expect(withInfo.info).toEqual({
      ...INFO,
      license: { ...INFO.license, ...LICENSE },
    });
    expect(withInfo.uncategorized).toEqual(["heart", "house"]);
    // Повтор — из кэша дата-центра, без R2; браузеру — те же 5 минут.
    const reads = bucket.reads.length;
    const again = await get("/collection?prefix=demo&chars=1");
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect(again.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await again.text()).toBe(BODY);
    expect(bucket.reads.length).toBe(reads);
  });

  it("/collection: без prefix — 400, неизвестный набор — 404, неверный info — 400", async () => {
    const { get } = setup();
    const cases: [string, number, string][] = [
      ["/collection", 400, "prefix_required"],
      ["/collection?prefix=nope", 404, "set_not_found"],
      ["/collection?prefix=Bad_Name", 404, "set_not_found"],
      ["/collection?prefix=demo&info=maybe", 400, "invalid_parameter"],
      ["/collection?prefix=demo&prefix=demo", 400, "duplicate_parameter"],
    ];
    for (const [path, status, error] of cases) {
      const res = await get(path);
      expect([path, res.status]).toEqual([path, status]);
      expect((await json(res)).error).toBe(error);
    }
  });

  it("/last-modified — из манифеста; неизвестный набор — пустой ответ, как у Iconify", async () => {
    const { get, bucket } = setup();
    expect(await json(await get("/last-modified"))).toEqual({
      lastModified: { demo: LAST_MODIFIED, "demo-color": LAST_MODIFIED },
    });
    expect(await json(await get("/last-modified?prefixes=demo,x"))).toEqual({
      lastModified: { demo: LAST_MODIFIED },
    });
    expect(await json(await get("/last-modified?prefix=nope"))).toEqual({
      lastModified: {},
    });
    expect(bucket.reads).toEqual(["manifest.json"]);
  });

  it("/changelog — выпуски всех наборов; prefix — только его", async () => {
    const { get } = setup();
    const all = await get("/changelog");
    expect(await all.text()).toBe(RELEASES_BODY);
    const demo = await json(await get("/changelog?prefix=demo"));
    expect(demo.releases.map((r: { prefix: string }) => r.prefix)).toEqual([
      "demo",
    ]);
  });

  it("обращений к кэшу дата-центра — в пределах бюджета бесплатного тарифа", async () => {
    const { get, cache } = setup();
    await get("/collection?prefix=demo&info=1");
    expect(cache.calls).toBeLessThanOrEqual(6);
  });

  it("манифест без catalog — каталог ещё не выложен: 503, а /last-modified работает", async () => {
    const { get } = setup();
    const bucket = fakeBucket({
      ...files(),
      "manifest.json": manifestText({ demo: VERSION }),
    });
    const handler = createHandler({ bucket, cache: fakeCache(), build: "t" });
    const w = waiter();
    const res = await handler(
      new Request("https://api.iconavo.dev/collections"),
      w.waitUntil,
    );
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe("storage_unavailable");
    const modified = await handler(
      new Request("https://api.iconavo.dev/last-modified"),
      w.waitUntil,
    );
    expect(modified.status).toBe(200);
    expect(modified.headers.get("x-iconavo-version")).toBeNull();
    // Каталог на месте — те же адреса отвечают.
    expect((await get("/collections")).status).toBe(200);
  });

  it("файла каталога нет в R2 — 503, без кэша", async () => {
    const { get, bucket } = setup();
    bucket.files.delete(`catalog/demo/${DEMO_BODY}.json`);
    const res = await get("/collection?prefix=demo");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("parseCatalogIndex и prefixFilter", () => {
  it("оглавление не по формату — ошибка хранилища", () => {
    expect(() => parseCatalogIndex("{")).toThrow("не JSON");
    expect(() => parseCatalogIndex('{"sets":{}}')).toThrow("не по формату");
    expect(() =>
      parseCatalogIndex(
        compactJson({
          changelog: RELEASES,
          sets: { demo: { collection: "x", info: INFO, license: LICENSE } },
        }),
      ),
    ).toThrow("неверная запись «demo»");
  });

  it("фильтр: точное имя, начало имени и оба параметра вместе", () => {
    const f = prefixFilter(new URLSearchParams("prefix=lucide&prefixes=mdi-"));
    expect(f?.match("lucide")).toBe(true);
    expect(f?.match("mdi-light")).toBe(true);
    expect(f?.match("mdi")).toBe(false);
    expect(f?.params.toString()).toBe("prefixes=lucide%2Cmdi-");
    expect(prefixFilter(new URLSearchParams())).toBeUndefined();
  });
});
