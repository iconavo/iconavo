import { STORE_KEYS } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import {
  type FakeDoc,
  fakeBucket,
  fakeCache,
  fakeLimiter,
  fakeSearchFetch,
  MEILI_URL,
  manifestText,
  nameFileText,
  VERSION,
  waiter,
} from "./fake.testing.js";
import { createHandler } from "./handler.js";
import { compactJson } from "./json.js";

const CATALOG = "aaaaaaaaaaaa";
const CONTENT = "c0ffee000001";
const INDEX = "1234abcd";
const COLOR_VERSION = "89abcdef";

/** Линия, как у Lucide: толщина меняет рисунок. */
const LINE =
  '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1h4"/></g>';
const FILLED = '<path fill="currentColor" d="M0 0h4v4H0z"/>';

const INFO = {
  name: "Demo",
  total: 4,
  version: "1.2.3",
  author: { name: "Demo Authors", url: "https://example.com/demo" },
  license: {
    title: "ISC License",
    spdx: "ISC",
    url: "https://spdx.org/licenses/ISC.html",
  },
  height: 24,
  palette: false,
};
const LICENSE = {
  text: "ISC License",
  source: "https://example.com/demo",
  revision: "1.2.3",
};
const FEATHER = {
  name: "Feather",
  author: "Cole Bemis",
  url: "https://github.com/feathericons/feather",
  license: "MIT",
  icons: ["house"],
};

const ABOUT = {
  en: { description: "A house", synonyms: ["home", "building"] },
  ru: { description: "Дом", synonyms: ["дом", "здание"] },
  tags: ["home", "building"],
};

const DOCS: FakeDoc[] = [
  {
    icon: "demo:house",
    set: "demo",
    names: [
      "demo:home",
      "demo:house",
      "demo:house-bold",
      "demo:house-fill",
      "home",
      "house",
      "house-bold",
      "house-fill",
    ],
    words: ["house", "home", "дом"],
    variants: ["house-bold", "house-fill"],
    style: ["outline", "filled"],
    styles: { outline: "house", filled: "house-fill" },
    about: ABOUT,
  },
  {
    icon: "demo:heart",
    set: "demo",
    names: ["demo:heart", "heart"],
    words: ["heart", "love"],
    style: ["outline"],
    styles: { outline: "heart" },
    about: { tags: ["love"] },
    // Новая иконка без описания: вектора нет.
    vector: false,
  },
  {
    icon: "color:house",
    set: "color",
    names: ["color:house", "house"],
    words: ["house", "дом"],
    palette: true,
    style: ["color"],
    styles: { color: "house" },
    about: { tags: ["house"] },
  },
];

const file = (set: string, name: string) => `v/${VERSION}/${set}/${name}.json`;

function bucketFiles(): Record<string, string> {
  return {
    "manifest.json": manifestText(
      { demo: VERSION, color: COLOR_VERSION },
      CATALOG,
    ),
    [`catalog/${CATALOG}.json`]: compactJson({
      changelog: "dddddddddddd",
      sets: {
        demo: {
          collection: "bbbbbbbbbbbb",
          info: INFO,
          license: LICENSE,
          content: CONTENT,
          styles: { outline: ["", "-bold"], filled: ["-fill"] },
          credits: [FEATHER],
        },
        color: {
          collection: "cccccccccccc",
          info: { ...INFO, name: "Color", palette: true },
          license: LICENSE,
          content: "c0ffee000002",
          styles: { color: [""] },
        },
      },
    }),
    [file("demo", "house")]: nameFileText("demo", { house: { body: LINE } }),
    [file("demo", "house-bold")]: nameFileText("demo", {
      "house-bold": { body: LINE.replace('"2"', '"3"') },
    }),
    [file("demo", "house-fill")]: nameFileText("demo", {
      "house-fill": { body: FILLED },
    }),
    [file("demo", "home")]: nameFileText(
      "demo",
      { house: { body: LINE } },
      { home: { parent: "house" } },
    ),
    [file("demo", "old")]: nameFileText("demo", {
      old: { body: LINE, hidden: true },
    }),
    [file("demo", "fresh")]: nameFileText("demo", { fresh: { body: FILLED } }),
    [file("demo", "heart")]: nameFileText("demo", { heart: { body: LINE } }),
  };
}

interface SetupOptions {
  meiliStatus?: number;
  similarStatus?: number;
  limiter?: ReturnType<typeof fakeLimiter>;
  noMeili?: boolean;
}

function setup(o: SetupOptions = {}) {
  const bucket = fakeBucket(bucketFiles());
  const searchBucket = fakeBucket({
    [STORE_KEYS.index]: JSON.stringify({ version: INDEX }),
  });
  const cache = fakeCache();
  const logs: string[] = [];
  const net = fakeSearchFetch({
    docs: DOCS,
    ...(o.meiliStatus === undefined ? {} : { meiliStatus: o.meiliStatus }),
    ...(o.similarStatus === undefined
      ? {}
      : { similarStatus: o.similarStatus }),
  });
  const handler = createHandler({
    bucket,
    cache,
    build: "test",
    log: (message) => logs.push(message),
    search: {
      bucket: searchBucket,
      ...(o.limiter ? { iconLimiter: o.limiter } : {}),
      ...(o.noMeili ? {} : { meili: { url: MEILI_URL, key: "search-key" } }),
      fetch: net.fn,
    },
  });
  const w = waiter();
  const get = (path: string, init?: RequestInit) =>
    handler(new Request(`https://api.iconavo.dev${path}`, init), w.waitUntil);
  return { get, flush: () => w.flush(), cache, logs, net };
}

const json = async (res: Response) => JSON.parse(await res.text());

describe("/icon: сведения об иконке", () => {
  it("набор, карточка, варианты по таблице стилей, описания, авторство и похожие", async () => {
    const s = setup();
    const res = await s.get("/icon?icon=demo:house");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      icon: "demo:house",
      set: {
        prefix: "demo",
        name: "Demo",
        author: { name: "Demo Authors", url: "https://example.com/demo" },
        license: {
          title: "ISC License",
          spdx: "ISC",
          url: "https://spdx.org/licenses/ISC.html",
        },
        palette: false,
        // Части набора от других авторов — без списков иконок: для указания авторства на весь набор.
        credits: [
          {
            name: "Feather",
            author: "Cole Bemis",
            license: "MIT",
            url: "https://github.com/feathericons/feather",
          },
        ],
      },
      card: "demo:house",
      style: "outline",
      variants: [
        { style: "outline", icons: ["demo:house", "demo:house-bold"] },
        { style: "filled", icons: ["demo:house-fill"] },
      ],
      tones: [],
      strokes: true,
      description: { en: "A house", ru: "Дом" },
      synonyms: { en: ["home", "building"], ru: ["дом", "здание"] },
      tags: ["home", "building"],
      credits: [
        {
          name: "Feather",
          author: "Cole Bemis",
          license: "MIT",
          url: "https://github.com/feathericons/feather",
        },
      ],
      // Ближайший — цветной дом: у него нет контура, он показан как есть.
      similar: ["color:house", "demo:heart"],
    });
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(res.headers.get("x-iconavo-version")).toBe(VERSION);
    expect(res.headers.get("x-iconavo-index")).toBe(INDEX);
    expect(res.headers.get("x-iconavo-content")).toBe(CONTENT);
    expect(res.headers.get("access-control-expose-headers")).toContain(
      "X-Iconavo-Content",
    );
    expect(s.net.meili).toHaveLength(1);
    expect(s.net.meili[0]?.queries[0]).toMatchObject({
      filter: ['names = "demo:house"'],
      attributesToRetrieve: ["icon", "variants", "tones", "styles", "about"],
    });
    expect(s.net.similar[0]).toMatchObject({
      id: "demo_house",
      embedder: "gemini",
      limit: 12,
    });
  });

  it("повтор — из кэша дата-центра, без Meilisearch", async () => {
    const s = setup();
    const first = await (await s.get("/icon?icon=demo:house")).text();
    await s.flush();
    const again = await s.get("/icon?icon=demo:house");
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect(again.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await again.text()).toBe(first);
    expect(s.net.meili).toHaveLength(1);
    expect(s.net.similar).toHaveLength(1);
  });

  it("вариант заливки: свой стиль, толщины нет, похожие — в заливке, если она у них есть", async () => {
    const s = setup();
    const data = await json(await s.get("/icon?icon=demo:house-fill"));
    expect(data).toMatchObject({
      icon: "demo:house-fill",
      card: "demo:house",
      style: "filled",
      strokes: false,
      similar: ["color:house", "demo:heart"],
    });
    // Feather — только у самой house, а у набора — у любой иконки: указание авторства на весь набор.
    expect(data.credits).toBeUndefined();
    expect(data.set.credits).toEqual([
      {
        name: "Feather",
        author: "Cole Bemis",
        license: "MIT",
        url: "https://github.com/feathericons/feather",
      },
    ]);
  });

  it("старое имя — сведения основной иконки с пометкой alias", async () => {
    const data = await json(await setup().get("/icon?icon=demo:home"));
    expect(data).toMatchObject({
      icon: "demo:house",
      alias: "demo:home",
      card: "demo:house",
      style: "outline",
    });
  });

  it("скрытая иконка — пометка hidden, без карточки и похожих", async () => {
    const s = setup();
    const data = await json(await s.get("/icon?icon=demo:old"));
    expect(data).toMatchObject({
      icon: "demo:old",
      hidden: true,
      card: null,
      style: null,
      variants: [],
      description: null,
      synonyms: null,
      tags: [],
      similar: [],
    });
    expect(s.net.similar).toHaveLength(0);
  });

  it("иконки ещё нет в индексе — сведения из раздачи, без описаний", async () => {
    const data = await json(await setup().get("/icon?icon=demo:fresh"));
    expect(data).toMatchObject({
      icon: "demo:fresh",
      card: null,
      description: null,
      strokes: false,
      similar: [],
    });
  });

  it("у документа нет вектора — похожих нет, в журнале заметка", async () => {
    const s = setup();
    const data = await json(await s.get("/icon?icon=demo:heart"));
    expect(data).toMatchObject({ card: "demo:heart", similar: [] });
    expect(data.description).toBeNull();
    expect(s.logs).toContain("похожих нет: demo:heart");
  });

  it("ошибки: нет параметра, имя без набора, неизвестный набор и иконка", async () => {
    const s = setup();
    const cases: [string, number, string][] = [
      ["/icon", 400, "icon_required"],
      ["/icon?icon=house", 400, "invalid_icon"],
      ["/icon?icon=demo:House", 400, "invalid_icon"],
      ["/icon?icon=demo:house&icon=demo:home", 400, "duplicate_parameter"],
      ["/icon?icon=nope:house", 404, "set_not_found"],
      ["/icon?icon=demo:nope", 404, "icon_not_found"],
    ];
    for (const [path, status, error] of cases) {
      const res = await s.get(path);
      expect(res.status, path).toBe(status);
      expect((await json(res)).error, path).toBe(error);
    }
    expect(s.net.meili).toHaveLength(0);
  });

  it("Meilisearch недоступен — 503; похожие отказали с 403 — тоже 503", async () => {
    const down = await setup({ meiliStatus: 500 }).get("/icon?icon=demo:house");
    expect(down.status).toBe(503);
    expect((await json(down)).error).toBe("search_unavailable");
    const key = await setup({ similarStatus: 403 }).get(
      "/icon?icon=demo:house",
    );
    expect(key.status).toBe(503);
    const none = await setup({ noMeili: true }).get("/icon?icon=demo:house");
    expect(none.status).toBe(503);
  });

  it("лимит частоты — только мимо кэша", async () => {
    const limiter = fakeLimiter(1);
    const s = setup({ limiter });
    expect((await s.get("/icon?icon=demo:house")).status).toBe(200);
    await s.flush();
    // Из кэша — без счёта.
    expect((await s.get("/icon?icon=demo:house")).status).toBe(200);
    const limited = await s.get("/icon?icon=demo:house-fill");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("HEAD — заголовки без тела", async () => {
    const res = await setup().get("/icon?icon=demo:house", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("/collection: отпечаток содержимого", () => {
  it("заголовок X-Iconavo-Content из оглавления", async () => {
    const s = setup();
    const bodyKey = "catalog/demo/bbbbbbbbbbbb.json";
    // Тело /collection для этого набора.
    const handler = createHandler({
      bucket: fakeBucket({
        ...bucketFiles(),
        [bodyKey]: compactJson({ prefix: "demo", title: "Demo", total: 4 }),
      }),
      cache: fakeCache(),
      build: "test",
    });
    const res = await handler(
      new Request("https://api.iconavo.dev/collection?prefix=demo"),
      () => {},
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-iconavo-content")).toBe(CONTENT);
    expect(s.logs).toEqual([]);
  });
});
