import { describe, expect, it } from "vitest";
import { CACHE_GENERATION, FILE_CACHE } from "./config.js";
import { fileKey } from "./data.js";
import {
  fakeBucket,
  fakeCache,
  LAST_MODIFIED,
  manifestText,
  nameFileText,
  VERSION,
  waiter,
} from "./fake.testing.js";
import { createHandler } from "./handler.js";

const HEART = '<path fill="none" stroke="currentColor" d="M1 1"/>';
const HOUSE = '<path fill="currentColor" d="M2 2"/>';
const SWAN = '<path fill="#fff" d="M3 3"/>';
const COLOR_VERSION = "89abcdef";

const FILES: Record<string, string> = {
  "manifest.json": manifestText({ demo: VERSION, color: COLOR_VERSION }),
  [`v/${VERSION}/demo/heart.json`]: nameFileText("demo", {
    heart: { body: HEART },
  }),
  [`v/${VERSION}/demo/house.json`]: nameFileText("demo", {
    house: { body: HOUSE },
  }),
  [`v/${VERSION}/demo/home.json`]: nameFileText(
    "demo",
    { house: { body: HOUSE } },
    { home: { parent: "house" } },
  ),
  [`v/${VERSION}/demo/old.json`]: nameFileText("demo", {
    old: { body: "<g/>", hidden: true },
  }),
  [`v/${COLOR_VERSION}/color/swan.json`]: nameFileText(
    "color",
    { swan: { body: SWAN, height: 33 } },
    undefined,
    32,
  ),
};

function setup(files: Record<string, string> = FILES, build = "test") {
  const bucket = fakeBucket(files);
  let time = 0;
  const cache = fakeCache(() => time);
  const logs: string[] = [];
  const handler = createHandler({
    bucket,
    cache,
    build,
    now: () => time,
    log: (message) => logs.push(message),
  });
  const w = waiter();
  const get = async (path: string, init?: RequestInit) => {
    const res = await handler(
      new Request(`https://api.iconavo.dev${path}`, init),
      w.waitUntil,
    );
    await w.flush();
    return res;
  };
  return {
    bucket,
    cache,
    logs,
    get,
    handlerWith: (b: string) =>
      createHandler({ bucket, cache, build: b, now: () => time }),
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const json = async (res: Response) => JSON.parse(await res.text());

describe("пачка /{набор}.json", () => {
  it("IconifyJSON: иконки, вся цепочка алиасов, not_found, размеры и lastModified", async () => {
    const { get, bucket } = setup();
    const res = await get("/demo.json?icons=heart,home,_missing");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      `{"aliases":{"home":{"parent":"house"}},"height":24,"icons":{"heart":{"body":${JSON.stringify(HEART)}},"house":{"body":${JSON.stringify(HOUSE)}}},"lastModified":${LAST_MODIFIED},"not_found":["_missing"],"prefix":"demo","width":24}`,
    );
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=604800",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "cross-origin",
      "x-iconavo-version": VERSION,
      "x-iconavo-build": "test",
      "x-cache": "MISS",
    });
    // Неверное имя в R2 не ищется.
    expect(bucket.reads.sort()).toEqual([
      "manifest.json",
      `v/${VERSION}/demo/heart.json`,
      `v/${VERSION}/demo/home.json`,
    ]);
  });

  it("порядок имён и повторы не меняют ответ: второй запрос — из кэша", async () => {
    const { get, bucket } = setup();
    const first = await (await get("/demo.json?icons=heart,home")).text();
    const reads = bucket.reads.length;
    const res = await get("/demo.json?icons=home,,heart,home");
    expect(res.headers.get("x-cache")).toBe("HIT");
    expect(await res.text()).toBe(first);
    expect(bucket.reads.length).toBe(reads);
  });

  it("скрытые иконки отдаются: имена не пропадают", async () => {
    const body = await json(await setup().get("/demo.json?icons=old"));
    expect(body.icons.old).toEqual({ body: "<g/>", hidden: true });
    expect(body.not_found).toBeUndefined();
  });

  it("не нашлось ничего — пустые icons и aliases, без размеров; в кэш не идёт", async () => {
    const { get, cache } = setup();
    const res = await get("/demo.json?icons=nope,_bad");
    expect(await res.text()).toBe(
      `{"aliases":{},"icons":{},"lastModified":${LAST_MODIFIED},"not_found":["_bad","nope"],"prefix":"demo"}`,
    );
    // «nope» прочитан из R2 — ответ в кэше; без чтений R2 кэша нет.
    expect(cache.answers()).toBe(1);
    await get("/demo.json?icons=_only-bad");
    expect(cache.answers()).toBe(1);
  });

  it("ошибки запроса — 400 с кодом", async () => {
    const { get } = setup();
    const cases: [string, string][] = [
      ["/demo.json", "icons_required"],
      ["/demo.json?icons=", "icons_required"],
      ["/demo.json?icons=,,", "icons_required"],
      ["/demo.json?icons=a&icons=b", "duplicate_parameter"],
      [
        `/demo.json?icons=${Array.from({ length: 101 }, (_, i) => `i${i}`).join(",")}`,
        "too_many_icons",
      ],
    ];
    for (const [path, code] of cases) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect((await json(res)).error, path).toBe(code);
    }
  });
});

describe("маршруты и методы", () => {
  it("неизвестный адрес и набор — 404 JSON; путь сверяется строго", async () => {
    const { get } = setup();
    const cases: [string, string][] = [
      ["/", "not_found"],
      ["/demo.json/?icons=heart", "not_found"],
      ["/Demo.json?icons=heart", "not_found"],
      ["/demo%2Fheart.svg", "not_found"],
      ["/demo/heart.png", "not_found"],
      ["/-demo.json?icons=heart", "set_not_found"],
      ["/missing.json?icons=heart", "set_not_found"],
      ["/constructor.json?icons=heart", "set_not_found"],
    ];
    for (const [path, code] of cases) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect((await json(res)).error, path).toBe(code);
    }
  });

  it("OPTIONS — 204 с CORS, другой метод — 405", async () => {
    const { get } = setup();
    const options = await get("/demo.json", { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-methods")).toBe(
      "GET, HEAD, OPTIONS",
    );
    const post = await get("/demo.json?icons=heart", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("HEAD — те же заголовки без тела, и из кэша тоже", async () => {
    const { get } = setup();
    const first = await get("/demo.json?icons=heart", { method: "HEAD" });
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cache")).toBe("MISS");
    expect(await first.text()).toBe("");
    const again = await get("/demo.json?icons=heart", { method: "HEAD" });
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect(again.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await again.text()).toBe("");
  });
});

describe("SVG /{набор}/{имя}.svg", () => {
  it("без параметров — как файл статики, с CSP", async () => {
    const res = await setup().get("/demo/heart.svg");
    expect(await res.text()).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">${HEART}</svg>`,
    );
    expect(res.headers.get("content-type")).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });

  it("цвет, размер, поворот, отражение, box и download", async () => {
    const { get } = setup();
    const colored = await (
      await get("/demo/heart.svg?color=red&height=64")
    ).text();
    expect(colored).toContain('width="64" height="64"');
    expect(colored).toContain('stroke="red"');
    expect(colored).not.toContain("currentColor");
    expect(await (await get("/demo/heart.svg?color=FF0000")).text()).toContain(
      'stroke="#ff0000"',
    );
    expect(
      await (await get("/demo/heart.svg?rotate=90deg&flip=horizontal")).text(),
    ).toContain('<g transform="rotate(90 12 12) translate(24 0) scale(-1 1)">');
    expect(await (await get("/demo/heart.svg?box=1")).text()).toContain(
      '<rect x="0" y="0" width="24" height="24" fill="rgba(255, 255, 255, 0)" />',
    );
    const download = await get("/demo/heart.svg?download=1");
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="heart.svg"',
    );
  });

  it("неквадратная иконка с поворотом", async () => {
    const svg = await (await setup().get("/color/swan.svg?rotate=1")).text();
    expect(svg).toContain('width="1.04em" height="1em" viewBox="0 0 33 32"');
  });

  it("алиас — SVG иконки в конце цепочки", async () => {
    const svg = await (await setup().get("/demo/home.svg")).text();
    expect(svg).toContain(HOUSE);
  });

  it("неверные параметры — 400, неизвестные — не мешают и не входят в ключ", async () => {
    const { get } = setup();
    const cases: [string, string][] = [
      ["/demo/heart.svg?color=red%22%3E", "invalid_color"],
      ["/demo/heart.svg?color=url(x)", "invalid_color"],
      ["/demo/heart.svg?color=red%26width%3D1", "invalid_color"],
      ["/demo/heart.svg?rotate=90", "invalid_rotate"],
      ["/demo/heart.svg?flip=diagonal", "invalid_flip"],
      ["/demo/heart.svg?width=abc", "invalid_size"],
      ["/demo/heart.svg?box=maybe", "invalid_parameter"],
      ["/demo/heart.svg?color=red&color=blue", "duplicate_parameter"],
    ];
    for (const [path, code] of cases) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect((await json(res)).error, path).toBe(code);
    }
    await get("/demo/heart.svg?color=red");
    const res = await get("/demo/heart.svg?utm_source=x&color=red");
    expect(res.headers.get("x-cache")).toBe("HIT");
  });

  it("нет иконки — 404 с версией набора, в кэш не идёт", async () => {
    const { get, cache } = setup();
    for (const path of ["/demo/nope.svg", "/demo/-bad.svg"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect((await json(res)).error).toBe("icon_not_found");
      expect(res.headers.get("x-iconavo-version")).toBe(VERSION);
    }
    expect(cache.answers()).toBe(0);
  });
});

describe("CSS /{набор}.css", () => {
  it("монохромные — маска, цветные — фон; download — файлом", async () => {
    const { get } = setup();
    const mask = await get("/demo.css?icons=heart,house");
    expect(mask.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const text = await mask.text();
    expect(text).toContain(".icon--demo {");
    expect(text).toContain("mask-image: var(--svg);");
    expect(text).toContain(".icon--demo--heart {");
    const bg = await (await get("/color.css?icons=swan")).text();
    expect(bg).toContain(".icon--color.icon--color--swan {");
    expect(bg).toContain("background-image: url(");
    const download = await get("/demo.css?icons=heart&download=1");
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="demo.css"',
    );
  });

  it("параметры CSS входят в ключ, неверные — 400", async () => {
    const { get } = setup();
    await get("/demo.css?icons=heart");
    const compressed = await get("/demo.css?icons=heart&format=compressed");
    expect(compressed.headers.get("x-cache")).toBe("MISS");
    expect(await compressed.text()).not.toContain("\n  ");
    expect((await get("/demo.css?icons=heart&mode=x")).status).toBe(400);
    expect((await get("/demo.css?icons=heart&format=x")).status).toBe(400);
  });
});

describe("кэш: версия набора и сборка — в ключе", () => {
  it("новая версия набора — новый ключ: ответ из новой версии", async () => {
    const next = "fedcba98";
    const files = {
      ...FILES,
      [`v/${next}/demo/heart.json`]: nameFileText("demo", {
        heart: { body: "<g/>" },
      }),
    };
    const { get, bucket, advance } = setup(files);
    await get("/demo/heart.svg");
    bucket.files.set("manifest.json", manifestText({ demo: next }));
    // Манифест в памяти минуту: сразу — прежняя версия из кэша.
    expect((await get("/demo/heart.svg")).headers.get("x-cache")).toBe("HIT");
    advance(60_000);
    const res = await get("/demo/heart.svg");
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(res.headers.get("x-iconavo-version")).toBe(next);
    expect(await res.text()).toContain("<g/>");
  });

  it("новая сборка — новый ключ", async () => {
    const { get, handlerWith } = setup();
    await get("/demo/heart.svg");
    const res = await handlerWith("b2")(
      new Request("https://api.iconavo.dev/demo/heart.svg"),
      () => {},
    );
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(res.headers.get("x-iconavo-build")).toBe("b2");
  });

  it("значения параметров не подделывают чужой ключ", async () => {
    const { get, cache } = setup();
    // Имя «x&format=compressed» склеилось бы с ключом как формат CSS.
    await get("/demo.css?icons=heart,x%26format%3Dcompressed");
    const res = await get("/demo.css?icons=heart,x&format=compressed");
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(await res.text()).not.toContain("\n  ");
    expect(cache.answers()).toBe(2);
  });
});

/** 100 имён набора demo: n000…n099. */
const MANY = Array.from(
  { length: 100 },
  (_, i) => `n${String(i).padStart(3, "0")}`,
);
const withMany = (): Record<string, string> => ({
  ...FILES,
  ...Object.fromEntries(
    MANY.map((n) => [
      `v/${VERSION}/demo/${n}.json`,
      nameFileText("demo", { [n]: { body: `<path d="${n}"/>` } }),
    ]),
  ),
});
const batch = (names: readonly string[]) =>
  `/demo.json?icons=${names.join(",")}`;

describe("кэш файлов имён: новая пачка из знакомых иконок — без R2", () => {
  it("новая пачка из 30 имён: проба 6 имён, все 30 файлов — в кэш; 40 обращений с манифестом", async () => {
    const s = setup(withMany());
    const res = await s.get(batch(MANY.slice(0, 30)));
    expect(res.status).toBe(200);
    expect(s.cache.files()).toBe(30);
    // Манифест — чтение и запись, ответ — чтение и запись, проба — 6, файлы — 30.
    expect(s.cache.calls).toBe(40);
    expect(res.headers.get("server-timing")).toMatch(
      /files;desc="0\/6";dur=\d+, r2;desc="30";dur=\d+/,
    );
  });

  it("знакомые иконки в новой пачке не читают R2, ответ — тот же, что из R2", async () => {
    const s = setup(withMany());
    await s.get(batch(MANY.slice(0, 30)));
    await s.get(batch(MANY.slice(30, 60)));
    const reads = s.bucket.reads.length;
    const mixed = MANY.slice(15, 45);
    const res = await s.get(batch(mixed));
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(s.bucket.reads.length).toBe(reads);
    expect(res.headers.get("server-timing")).toMatch(
      /files;desc="30\/30";dur=\d+, r2;desc="0";dur=0/,
    );
    const fromR2 = await setup(withMany()).get(batch(mixed));
    expect(await res.text()).toBe(await fromR2.text());
  });

  it("не больше 50 обращений за запрос: 100 новых имён с чтением манифеста — в кэш 34 файла", async () => {
    const s = setup(withMany());
    const res = await s.get(batch(MANY));
    expect(res.status).toBe(200);
    // Манифест — 2, ответ — 2, проба — 6, файлы — сколько осталось от бюджета 40.
    expect(s.cache.calls).toBe(44);
    expect(s.cache.files()).toBe(34);
  });

  it("не больше 50 обращений за запрос: 99 знакомых имён с чтением манифеста — 40 из кэша, остальные из R2", async () => {
    const s = setup(withMany());
    for (let i = 0; i < 100; i += 25) await s.get(batch(MANY.slice(i, i + 25)));
    expect(s.cache.files()).toBe(100);
    // Манифест устарел и в памяти, и в кэше — его читают в этом же запросе.
    s.advance(60_000);
    s.cache.calls = 0;
    const res = await s.get(batch(MANY.slice(1)));
    expect(res.status).toBe(200);
    expect(s.cache.calls).toBe(44);
    expect(res.headers.get("server-timing")).toMatch(
      /files;desc="40\/40";dur=\d+, r2;desc="59"/,
    );
  });

  it("ключ файла — без метки сборки, срок 30 дней; новая сборка находит файлы прежней", async () => {
    const s = setup();
    await s.get("/demo.json?icons=heart");
    const key = fileKey(VERSION, "demo", "heart").url;
    expect(key).toBe(
      `https://api.iconavo.dev/__cache/${CACHE_GENERATION}/file/v/${VERSION}/demo/heart.json`,
    );
    expect(s.cache.stored.get(key)?.ttl).toBe(30 * 24 * 3600 * 1000);
    const reads = s.bucket.reads.length;
    const res = await s.handlerWith("b2")(
      new Request("https://api.iconavo.dev/demo/heart.svg?color=red"),
      () => {},
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(s.bucket.reads.length).toBe(reads);
  });

  it("SVG и CSS берут файлы из кэша", async () => {
    const s = setup();
    await s.get("/demo.json?icons=heart,house");
    const reads = s.bucket.reads.length;
    expect((await s.get("/demo/heart.svg")).status).toBe(200);
    expect((await s.get("/demo.css?icons=heart,house")).status).toBe(200);
    expect(s.bucket.reads.length).toBe(reads);
  });

  it("файла нет в R2 — в кэш файлов не идёт", async () => {
    const s = setup();
    await s.get("/demo/nope.svg");
    await s.get("/demo.json?icons=nope,heart");
    expect(s.cache.files()).toBe(1);
  });

  it("испорченная запись в кэше — файл из R2, запись переписана", async () => {
    const s = setup();
    const key = fileKey(VERSION, "demo", "heart");
    await s.cache.put(
      key,
      new Response("{}", { headers: { "cache-control": FILE_CACHE } }),
    );
    const res = await s.get("/demo.json?icons=heart");
    expect(res.status).toBe(200);
    expect(s.bucket.reads).toContain(`v/${VERSION}/demo/heart.json`);
    expect(s.logs.some((l) => l.includes("не по формату"))).toBe(true);
    expect(await (await s.cache.match(key))?.text()).toBe(
      FILES[`v/${VERSION}/demo/heart.json`],
    );
  });

  it("кэш файлов упал — ответ из R2, файлы не пишутся, одна строка в журнале", async () => {
    const s = setup();
    s.cache.failing = /\/file\//;
    const res = await s.get("/demo.json?icons=heart,home");
    expect(res.status).toBe(200);
    expect(s.logs).toEqual(["кэш файлов: cache down"]);
    expect(s.cache.answers()).toBe(1);
    expect(s.cache.files()).toBe(0);
  });

  it("кэш упал совсем — ответ 200 из R2, а не ошибка", async () => {
    const s = setup();
    s.cache.failing = /./;
    const res = await s.get("/demo.json?icons=heart,home");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(s.logs).toEqual(["кэш не прочитан: cache down"]);
    expect(s.cache.stored.size).toBe(0);
  });

  it("Server-Timing — клиенту, мимо кэша и из кэша; в копии в кэше его нет", async () => {
    const s = setup();
    const miss = await s.get("/demo.json?icons=heart");
    expect(miss.headers.get("server-timing")).toMatch(
      /^manifest;dur=\d+, cache;desc="miss";dur=\d+, files;desc="0\/1";dur=\d+, r2;desc="1";dur=\d+, total;dur=\d+$/,
    );
    expect(miss.headers.get("timing-allow-origin")).toBe("*");
    const hit = await s.get("/demo.json?icons=heart");
    expect(hit.headers.get("server-timing")).toMatch(
      /^manifest;dur=\d+, cache;desc="hit";dur=\d+, total;dur=\d+$/,
    );
    expect(hit.headers.get("timing-allow-origin")).toBe("*");
    for (const entry of s.cache.stored.values()) {
      expect(entry.headers.some(([name]) => name === "server-timing")).toBe(
        false,
      );
    }
  });
});

describe("сбои R2", () => {
  it("R2 не ответил — 503 без кэша; после восстановления — снова ответ", async () => {
    const { get, bucket, cache, logs } = setup();
    bucket.failing.add(`v/${VERSION}/demo/heart.json`);
    const res = await get("/demo/heart.svg");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await json(res)).error).toBe("storage_unavailable");
    expect(cache.answers()).toBe(0);
    expect(logs.some((l) => l.startsWith("R2:"))).toBe(true);
    bucket.failing.clear();
    expect((await get("/demo/heart.svg")).status).toBe(200);
  });

  it("манифест не прочитался — служит прежняя копия; без неё — 503", async () => {
    const { get, bucket, advance, logs } = setup();
    expect((await get("/demo/heart.svg")).status).toBe(200);
    bucket.failing.add("manifest.json");
    advance(60_000);
    expect((await get("/demo/heart.svg?color=red")).status).toBe(200);
    expect(logs.some((l) => l.includes("прежняя копия"))).toBe(true);
    const fresh = setup();
    fresh.bucket.failing.add("manifest.json");
    expect((await fresh.get("/demo/heart.svg")).status).toBe(503);
  });

  it("файл имени не по формату — 503", async () => {
    const files = { ...FILES, [`v/${VERSION}/demo/heart.json`]: "{}" };
    expect((await setup(files).get("/demo/heart.svg")).status).toBe(503);
  });
});
