import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import {
  type Behavior,
  type Core,
  DEMO_VERSION,
  deferred,
  demoBatch,
  demoHosts,
  demoStatic,
  fakeFetch,
  fakeNet,
  fakeTime,
  freshCore,
  hosts,
  idle,
  later,
  realTime,
  wait,
  warnings,
} from "./fake.testing.js";
import { batches, MAX_NAMES, MAX_URL } from "./load.js";

let warn: MockInstance;
beforeEach(() => {
  fakeTime();
  warn = warnings();
});
afterEach(realTime);

const API = "https://api.iconavo.dev";
const CDN = "https://cdn.iconavo.dev";
const CDN2 = "https://cdn2.iconavo.dev";
const BCDN = "https://iconavo.b-cdn.net";
const BASE = `${API}/demo.json?icons=`;

/** Адрес файла имени на хосте статики. */
const file = (host: string, name: string) =>
  `${host}/v/${DEMO_VERSION}/demo/${name}.json`;

/** Все четыре наших хоста с одним поведением. */
const all = (behavior: Behavior) =>
  hosts({
    "api.iconavo.dev": behavior,
    "cdn.iconavo.dev": behavior,
    "cdn2.iconavo.dev": behavior,
    "iconavo.b-cdn.net": behavior,
  });

/** Рисунок поддельной статики: в нём хост, с которого пришла иконка. */
const fromHost = (name: string, host: string) =>
  `<path d="${name}" data-host="${new URL(host).host}"/>`;

/** Имена из адреса запроса. */
const namesOf = (url: string) =>
  (new URL(url).searchParams.get("icons") ?? "").split(",");

/** Показать иконки, как тег: подписка и запрос. Возвращает отписки. */
const show = (core: Core, names: string[], listener = () => {}) =>
  names.map((name) => {
    const stop = core.subscribeIcon(name, listener);
    core.loadIcon(name);
    return stop;
  });

describe("пачки", () => {
  it("адрес не длиннее 500 символов и не больше 100 имён, кусок заполнен до предела", () => {
    const long = Array.from({ length: 100 }, (_, i) => `icon-name-${1000 + i}`);
    const chunks = batches(BASE, long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(long);
    for (const [i, chunk] of chunks.entries()) {
      expect((BASE + chunk.join(",")).length).toBeLessThanOrEqual(MAX_URL);
      const next = chunks[i + 1]?.[0];
      if (next !== undefined) {
        expect(`${BASE}${chunk.join(",")},${next}`.length).toBeGreaterThan(
          MAX_URL,
        );
      }
    }
    const short = Array.from({ length: 250 }, (_, i) => `${i}`);
    for (const chunk of batches(BASE, short)) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_NAMES);
    }
    expect(batches(BASE, ["x".repeat(600)])).toEqual([["x".repeat(600)]]);
    expect(batches(BASE, [])).toEqual([]);
  });

  it("100 иконок одного набора за тик — несколько запросов, а не сто", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    const names = Array.from({ length: 100 }, (_, i) => `icon-${100 + i}`);
    show(
      core,
      names.map((n) => `demo:${n}`),
    );
    await idle();
    const sorted = [...names].sort();
    expect(requests).toEqual(
      batches(BASE, sorted).map((chunk) => BASE + chunk.join(",")),
    );
    expect(requests.length).toBeLessThan(10);
    expect(requests.flatMap(namesOf)).toEqual(sorted);
    for (const name of names) {
      expect(core.getIcon(`demo:${name}`)).toMatchObject({
        body: `<path d="${name}"/>`,
        width: 24,
        height: 24,
      });
    }
  });

  it("разные наборы за тик — по запросу на набор", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    show(core, ["beta:b", "alpha:z", "beta:a", "alpha:y"]);
    await idle();
    expect(requests.sort()).toEqual([
      `${API}/alpha.json?icons=y,z`,
      `${API}/beta.json?icons=a,b`,
    ]);
  });

  it("микрозадача той же задачи — в той же пачке, следующая задача — новый запрос", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    show(core, ["demo:b"]);
    await Promise.resolve().then(() => show(core, ["demo:a"]));
    await idle();
    show(core, ["demo:c"]);
    await idle();
    expect(requests).toEqual([`${BASE}a,b`, `${BASE}c`]);
  });
});

describe("без повторов", () => {
  it("одно имя дважды за тик — один запрос, сигнал обоим", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    const first = vi.fn();
    const second = vi.fn();
    show(core, ["demo:house"], first);
    show(core, ["demo:house"], second);
    expect(core.getIcon("demo:house")).toBe("loading");
    await idle();
    expect(requests).toEqual([`${BASE}house`]);
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it("второй показ во время запроса ждёт тот же ответ", async () => {
    const answer = deferred<Response>();
    const requests = fakeFetch(() => answer.promise);
    const core = await freshCore();
    show(core, ["demo:house"]);
    await idle();
    const late = vi.fn();
    show(core, ["demo:house"], late);
    await idle();
    expect(requests).toHaveLength(1);
    answer.resolve(demoBatch(new URL(`${BASE}house`)));
    await idle();
    expect(late).toHaveBeenCalled();
    expect(core.getIcon("demo:house")).toMatchObject({
      body: '<path d="house"/>',
    });
  });

  it("повторный показ загруженных и «нет» — ни одного запроса", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    const stops = show(core, ["demo:house", "demo:heart", "demo:missing-x"]);
    await idle();
    for (const stop of stops) stop();
    show(core, ["demo:heart", "demo:house", "demo:missing-x"]);
    await idle();
    expect(requests).toEqual([`${BASE}heart,house,missing-x`]);
  });

  it("иконка из addIcons, добавленная до отправки очереди, в запрос не попадает", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    show(core, ["demo:house", "demo:heart"]);
    core.addIcons({ prefix: "demo", icons: { house: { body: "<g/>" } } });
    await idle();
    expect(requests).toEqual([`${BASE}heart`]);
    expect(core.getIcon("demo:house")).toMatchObject({ body: "<g/>" });
  });

  it("неверное имя — «нет» сразу, без запроса", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    show(core, ["house", "Demo:house", "demo:house--x", "demo:a:b"]);
    await idle();
    expect(requests).toEqual([]);
    expect(core.getIcon("house")).toBe("missing");
    expect(core.getIcon("Demo:house")).toBe("missing");
  });

  it("подписка сама ничего не запрашивает; имя, которое не просили, — «загружается»", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    core.subscribeIcon("demo:house", () => {});
    expect(core.getIcon("demo:house")).toBe("loading");
    await idle();
    expect(requests).toEqual([]);
  });
});

describe("ответы хоста", () => {
  it("not_found и имена, которых нет в ответе, — «нет», и больше не запрашиваются", async () => {
    const requests = fakeFetch((url) =>
      url.searchParams.get("icons") === "lost"
        ? Response.json({ prefix: "demo", icons: {}, aliases: {} })
        : demoBatch(url),
    );
    const core = await freshCore();
    show(core, ["demo:missing-one", "demo:house"]);
    await idle();
    show(core, ["demo:lost"]);
    await idle();
    expect(core.getIcon("demo:missing-one")).toBe("missing");
    expect(core.getIcon("demo:lost")).toBe("missing");
    show(core, ["demo:missing-one", "demo:lost"]);
    await idle();
    expect(requests).toEqual([`${BASE}house,missing-one`, `${BASE}lost`]);
  });

  it("алиас из ответа разрешается по цепочке, родитель тоже загружен", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    show(core, ["demo:alias-star"]);
    await idle();
    expect(core.getIcon("demo:alias-star")).toMatchObject({
      body: '<path d="star"/>',
    });
    expect(core.getIcon("demo:star")).toMatchObject({
      body: '<path d="star"/>',
    });
    show(core, ["demo:star"]);
    await idle();
    expect(requests).toEqual([`${BASE}alias-star`]);
  });

  it("неизвестный набор: 404 и ответ 200 с телом 404, как у Iconify API, — «нет», статику не спрашивают", async () => {
    const requests = fakeFetch((url) =>
      url.pathname === "/iconify.json" ? Response.json(404) : demoHosts(url),
    );
    const core = await freshCore();
    show(core, ["nope:house", "iconify:house"]);
    await idle();
    expect(core.getIcon("nope:house")).toBe("missing");
    expect(core.getIcon("iconify:house")).toBe("missing");
    expect(requests).toEqual([
      `${API}/nope.json?icons=house`,
      `${API}/iconify.json?icons=house`,
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("сбой у всех хостов — «ошибка», а новый показ запрашивает снова", async () => {
    const failures: Behavior[] = [
      503,
      403,
      "down",
      () => new Response("<html>", { status: 200 }),
      () => Response.json(null),
      () => Response.json({ prefix: "other", icons: {} }),
    ];
    for (const failure of failures) {
      let failing = true;
      const broken = hosts({ "api.iconavo.dev": failure });
      const requests = fakeFetch((url) =>
        failing ? broken(url) : demoHosts(url),
      );
      const core = await freshCore();
      core.configure({ cdn: [] });
      core.loadIcon("demo:house");
      await idle();
      expect(core.getIcon("demo:house")).toBe("error");
      failing = false;
      core.loadIcon("demo:house");
      await idle();
      expect(requests).toEqual([`${BASE}house`, `${BASE}house`]);
      expect(core.getIcon("demo:house")).toMatchObject({
        body: '<path d="house"/>',
      });
      vi.unstubAllGlobals();
    }
  });

  it("ответ сети не перетирает иконку из addIcons", async () => {
    const answer = deferred<Response>();
    fakeFetch(() => answer.promise);
    const core = await freshCore();
    show(core, ["demo:house"]);
    await idle();
    core.addIcons({ prefix: "demo", icons: { house: { body: "<g/>" } } });
    answer.resolve(demoBatch(new URL(`${BASE}house`)));
    await idle();
    expect(core.getIcon("demo:house")).toMatchObject({ body: "<g/>" });
  });

  it("свой хост: адрес без лишнего «/» в конце; хостов нет совсем — «ошибка» без запроса", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    core.configure({ api: ["https://icons.example.com/api/"] });
    show(core, ["demo:house"]);
    await idle();
    expect(requests).toEqual([
      "https://icons.example.com/api/demo.json?icons=house",
    ]);
    core.configure({ api: [], cdn: [] });
    show(core, ["demo:heart"]);
    await idle();
    expect(requests).toHaveLength(1);
    expect(core.getIcon("demo:heart")).toBe("error");
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      'Iconavo: icon "demo:heart" failed to load',
      expect.objectContaining({ message: "No hosts" }),
    );
  });
});

describe("запасные хосты", () => {
  it("edge API отказал — те же имена сразу со статики: манифест, затем файл на иконку", async () => {
    const calls = fakeNet(hosts({ "api.iconavo.dev": "down" }));
    const core = await freshCore();
    show(core, ["demo:house", "demo:alias-star", "demo:missing-x"]);
    await idle();
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}alias-star,house,missing-x`,
      `${CDN}/manifest.json`,
      file(CDN, "alias-star"),
      file(CDN, "house"),
      file(CDN, "missing-x"),
    ]);
    expect(calls.every((c) => c.at === 0)).toBe(true);
    expect(core.getIcon("demo:house")).toMatchObject({
      body: fromHost("house", CDN),
      width: 24,
      height: 24,
    });
    expect(core.getIcon("demo:alias-star")).toMatchObject({
      body: fromHost("star", CDN),
    });
    expect(core.getIcon("demo:star")).toMatchObject({
      body: fromHost("star", CDN),
    });
    expect(core.getIcon("demo:missing-x")).toBe("missing");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("edge API: 5xx, другой 4xx, не JSON, чужой набор — тоже сразу статика", async () => {
    const failures: Behavior[] = [
      503,
      429,
      () => new Response("<html>", { status: 200 }),
      () => Response.json(null),
      () => Response.json({ prefix: "other", icons: {} }),
    ];
    for (const failure of failures) {
      const calls = fakeNet(hosts({ "api.iconavo.dev": failure }));
      const core = await freshCore();
      show(core, ["demo:house"]);
      await idle();
      expect(calls.map((c) => [c.url, c.at])).toEqual([
        [`${BASE}house`, 0],
        [`${CDN}/manifest.json`, 0],
        [file(CDN, "house"), 0],
      ]);
      expect(core.getIcon("demo:house")).toMatchObject({
        body: fromHost("house", CDN),
      });
      vi.unstubAllGlobals();
    }
  });

  it("edge API молчит — в 750 мс тот же запрос уходит на статику; первый ответ побеждает, запрос к API отменён", async () => {
    const calls = fakeNet(hosts({ "api.iconavo.dev": "silent" }));
    const core = await freshCore();
    show(core, ["demo:house"]);
    await wait(749);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}house`]);
    await wait(1);
    expect(calls.map((c) => [c.url, c.at])).toEqual([
      [`${BASE}house`, 0],
      [`${CDN}/manifest.json`, 750],
      [file(CDN, "house"), 750],
    ]);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(core.getIcon("demo:house")).toMatchObject({
      body: fromHost("house", CDN),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("edge API ответил после начала статики — побеждает он, запросы статики отменены", async () => {
    const calls = fakeNet(
      hosts({
        "api.iconavo.dev": later(1000),
        "cdn.iconavo.dev": (url) =>
          url.pathname === "/manifest.json"
            ? demoStatic(url)
            : new Promise<Response>(() => {}),
      }),
    );
    const core = await freshCore();
    show(core, ["demo:house"]);
    await wait(1000);
    expect(calls.map((c) => [c.url, c.at])).toEqual([
      [`${BASE}house`, 0],
      [`${CDN}/manifest.json`, 750],
      [file(CDN, "house"), 750],
    ]);
    expect(core.getIcon("demo:house")).toMatchObject({
      body: '<path d="house"/>',
    });
    expect(calls[2]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("статика ответила на часть иконок — остальные сразу идут на следующий хост", async () => {
    const calls = fakeNet(
      hosts({
        "api.iconavo.dev": "down",
        "cdn.iconavo.dev": (url) =>
          url.pathname.endsWith("/house.json")
            ? new Response("oops", { status: 503 })
            : demoStatic(url),
      }),
    );
    const core = await freshCore();
    show(core, ["demo:heart", "demo:house"]);
    await idle();
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}heart,house`,
      `${CDN}/manifest.json`,
      file(CDN, "heart"),
      file(CDN, "house"),
      `${CDN2}/manifest.json`,
      file(CDN2, "house"),
    ]);
    expect(core.getIcon("demo:heart")).toMatchObject({
      body: fromHost("heart", CDN),
    });
    expect(core.getIcon("demo:house")).toMatchObject({
      body: fromHost("house", CDN2),
    });
  });

  it("хосты молчат — следующий каждые 750 мс; через 5 с запрос отменён, повтор — через 1 с", async () => {
    const calls = fakeNet(all("silent"));
    const core = await freshCore();
    show(core, ["demo:house"]);
    await wait(4999);
    expect(calls.map((c) => [c.url, c.at])).toEqual([
      [`${BASE}house`, 0],
      [`${CDN}/manifest.json`, 750],
      [`${CDN2}/manifest.json`, 1500],
      [`${BCDN}/manifest.json`, 2250],
    ]);
    expect(calls[0]?.signal?.aborted).toBe(false);
    await wait(1);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(core.getIcon("demo:house")).toBe("loading");
    await wait(999);
    expect(calls).toHaveLength(4);
    await wait(1);
    expect(calls.at(-1)).toMatchObject({ url: `${BASE}house`, at: 6000 });
  });

  it("куски — по самому длинному хосту api: на запасном адрес тоже не длиннее 500", async () => {
    const short = "https://a.example";
    const long = "https://icons.example.com/a-much-longer-path/to/the/api";
    const calls = fakeNet(
      hosts({ "a.example": "down", "icons.example.com": demoBatch }),
    );
    const core = await freshCore();
    core.configure({ api: [short, long], cdn: [] });
    const names = Array.from(
      { length: 100 },
      (_, i) => `icon-name-${1000 + i}`,
    );
    show(
      core,
      names.map((n) => `demo:${n}`),
    );
    await idle();
    const of = (host: string) =>
      calls.filter((c) => c.url.startsWith(`${host}/`)).map((c) => c.url);
    expect(of(short)).toHaveLength(
      batches(`${long}/demo.json?icons=`, names).length,
    );
    expect(of(long)).toHaveLength(of(short).length);
    for (const url of of(long)) expect(url.length).toBeLessThanOrEqual(MAX_URL);
    expect(core.getIcon("demo:icon-name-1099")).toMatchObject({
      body: '<path d="icon-name-1099"/>',
    });
  });

  it("addIcons во время попытки — следующий хост не спрашивают, пустых запросов нет", async () => {
    const calls = fakeNet(hosts({ "api.iconavo.dev": "silent" }));
    const core = await freshCore();
    show(core, ["demo:heart", "demo:house"]);
    await wait(500);
    core.addIcons({
      prefix: "demo",
      icons: { heart: { body: "<g/>" }, house: { body: "<g/>" } },
    });
    await wait(250);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}heart,house`]);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("статика", () => {
  it("манифест — один запрос на хост для всех кусков; не прочитался — снова в следующей попытке", async () => {
    let fails = 1;
    const calls = fakeNet(
      hosts({
        "api.iconavo.dev": "down",
        "cdn.iconavo.dev": (url) =>
          url.pathname === "/manifest.json" && fails-- > 0
            ? later(10, () => new Response("oops", { status: 503 }))(url)
            : demoStatic(url),
      }),
    );
    const core = await freshCore();
    const names = Array.from(
      { length: 100 },
      (_, i) => `icon-name-${1000 + i}`,
    );
    show(
      core,
      names.map((n) => `demo:${n}`),
    );
    await wait(10);
    const count = (url: string) => calls.filter((c) => c.url === url).length;
    expect(calls.filter((c) => c.url.startsWith(API))).toHaveLength(
      batches(BASE, names).length,
    );
    expect(count(`${CDN}/manifest.json`)).toBe(1);
    expect(count(`${CDN2}/manifest.json`)).toBe(1);
    expect(calls.filter((c) => c.url.startsWith(`${CDN2}/v/`))).toHaveLength(
      100,
    );
    show(core, ["demo:heart"]);
    await idle();
    expect(count(`${CDN}/manifest.json`)).toBe(2);
    expect(core.getIcon("demo:heart")).toMatchObject({
      body: fromHost("heart", CDN),
    });
    show(core, ["demo:house"]);
    await idle();
    expect(count(`${CDN}/manifest.json`)).toBe(2);
  });

  it("попытка кончилась, пока ждали манифест, — файлы не запрашиваются, манифест пригодится потом", async () => {
    let apiDown = false;
    const calls = fakeNet(
      hosts({
        "api.iconavo.dev": (url) =>
          apiDown
            ? Promise.reject(new TypeError("Failed to fetch"))
            : later(1000)(url),
        "cdn.iconavo.dev": (url) =>
          url.pathname === "/manifest.json"
            ? later(1200)(url)
            : demoStatic(url),
      }),
    );
    const core = await freshCore();
    show(core, ["demo:house"]);
    await wait(2000);
    expect(calls.map((c) => [c.url, c.at])).toEqual([
      [`${BASE}house`, 0],
      [`${CDN}/manifest.json`, 750],
    ]);
    expect(core.getIcon("demo:house")).toMatchObject({
      body: '<path d="house"/>',
    });
    expect(calls[1]?.signal?.aborted).toBe(false);
    apiDown = true;
    show(core, ["demo:heart"]);
    await wait(1200);
    expect(calls.slice(2).map((c) => c.url)).toEqual([
      `${BASE}heart`,
      file(CDN, "heart"),
    ]);
    expect(core.getIcon("demo:heart")).toMatchObject({
      body: fromHost("heart", CDN),
    });
  });

  it("набора нет в манифесте — «нет» без запросов файлов; 404 файла — «нет» навсегда", async () => {
    const calls = fakeNet(hosts({ "api.iconavo.dev": "down" }));
    const core = await freshCore();
    const stops = show(core, ["other:house", "demo:missing-x"]);
    await idle();
    expect(core.getIcon("other:house")).toBe("missing");
    expect(core.getIcon("demo:missing-x")).toBe("missing");
    expect(calls.some((c) => c.url.includes("/other/"))).toBe(false);
    expect(calls.filter((c) => c.url.startsWith(CDN2))).toEqual([]);
    for (const stop of stops) stop();
    const before = calls.length;
    show(core, ["other:house", "demo:missing-x"]);
    await idle();
    expect(calls).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("битый манифест и чужой набор в файле — сбой хоста, иконка — со следующего", async () => {
    const manifests = [
      () => Response.json({ version: 1 }),
      () => Response.json({ sets: null }),
      () => Response.json({ sets: { demo: { version: "../x" } } }),
      () => new Response("<html>", { status: 200 }),
      () => new Response("Not found", { status: 404 }),
    ];
    for (const broken of manifests) {
      fakeNet(
        hosts({
          "api.iconavo.dev": "down",
          "cdn.iconavo.dev": broken,
          "cdn2.iconavo.dev": (url) =>
            url.pathname === "/manifest.json"
              ? demoStatic(url)
              : Response.json({ prefix: "other", icons: {} }),
        }),
      );
      const core = await freshCore();
      show(core, ["demo:house"]);
      await idle();
      expect(core.getIcon("demo:house")).toMatchObject({
        body: fromHost("house", BCDN),
      });
      vi.unstubAllGlobals();
    }
  });

  it("свой хост статики: адреса без лишнего «/»", async () => {
    const calls = fakeNet(demoStatic);
    const core = await freshCore();
    core.configure({ api: [], cdn: ["https://static.example.com/icons/"] });
    show(core, ["demo:house"]);
    await idle();
    expect(calls.map((c) => c.url)).toEqual([
      "https://static.example.com/icons/manifest.json",
      `https://static.example.com/icons/v/${DEMO_VERSION}/demo/house.json`,
    ]);
    expect(core.getIcon("demo:house")).toMatchObject({
      body: fromHost("house", "https://static.example.com"),
    });
  });
});

describe("повторы", () => {
  it("хосты отказывают — попытки в 0, 1, 3 и 7 с, всё это время «загружается»; потом «ошибка» и одно предупреждение", async () => {
    const calls = fakeNet(all("down"));
    const core = await freshCore();
    show(core, ["demo:house"]);
    await wait(6999);
    expect(core.getIcon("demo:house")).toBe("loading");
    expect(warn).not.toHaveBeenCalled();
    await wait(1);
    expect(calls.filter((c) => c.url.startsWith(API)).map((c) => c.at)).toEqual(
      [0, 1000, 3000, 7000],
    );
    // Каждая попытка — пачка и манифесты трёх хостов статики.
    expect(calls).toHaveLength(16);
    expect(core.getIcon("demo:house")).toBe("error");
    expect(warn.mock.calls).toEqual([
      ['Iconavo: icon "demo:house" failed to load', expect.any(TypeError)],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("после «ошибки» новый показ запрашивает снова", async () => {
    let down = true;
    const calls = fakeNet((url) =>
      down ? Promise.reject(new TypeError("Failed to fetch")) : demoHosts(url),
    );
    const core = await freshCore();
    const stops = show(core, ["demo:house"]);
    await wait(7000);
    expect(core.getIcon("demo:house")).toBe("error");
    for (const stop of stops) stop();
    down = false;
    const before = calls.length;
    show(core, ["demo:house"]);
    await idle();
    expect(calls.slice(before).map((c) => c.url)).toEqual([`${BASE}house`]);
    expect(core.getIcon("demo:house")).toMatchObject({
      body: '<path d="house"/>',
    });
  });

  it("иконку никто не показывает — «ошибка» сразу, без таймеров", async () => {
    const calls = fakeNet(all("down"));
    const core = await freshCore();
    core.loadIcon("demo:house");
    await idle();
    expect(core.getIcon("demo:house")).toBe("error");
    expect(calls).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("слушатель ушёл во время паузы — повтора нет", async () => {
    const calls = fakeNet(all("down"));
    const core = await freshCore();
    const [stop] = show(core, ["demo:house"]);
    await wait(500);
    stop?.();
    await wait(500);
    expect(calls).toHaveLength(4);
    expect(core.getIcon("demo:house")).toBe("error");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("addIcons во время паузы — имя выпадает из повтора", async () => {
    const calls = fakeNet(all("down"));
    const core = await freshCore();
    show(core, ["demo:heart", "demo:house"]);
    await wait(500);
    core.addIcons({ prefix: "demo", icons: { house: { body: "<g/>" } } });
    await wait(500);
    expect(
      calls.filter((c) => c.url.startsWith(API)).map((c) => c.url),
    ).toEqual([`${BASE}heart,house`, `${BASE}heart`]);
  });

  it("«нет» и 404 edge API не повторяются", async () => {
    const calls = fakeNet();
    const core = await freshCore();
    show(core, ["demo:missing-x", "nope:house"]);
    await wait(10_000);
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}missing-x`,
      `${API}/nope.json?icons=house`,
    ]);
    expect(core.getIcon("demo:missing-x")).toBe("missing");
    expect(core.getIcon("nope:house")).toBe("missing");
  });
});

describe("предупреждения", () => {
  it("«нет» и неверное имя — одно предупреждение на имя, повторный показ — без новых", async () => {
    fakeNet();
    const core = await freshCore();
    const names = ["demo:missing-x", "nope:house", "Lucide:House"];
    const stops = show(core, names);
    await idle();
    for (const stop of stops) stop();
    show(core, names);
    await idle();
    expect(warn.mock.calls.map(([message]) => message).sort()).toEqual([
      'Iconavo: icon "demo:missing-x" not found',
      'Iconavo: icon "nope:house" not found',
      'Iconavo: invalid icon name "Lucide:House"',
    ]);
  });

  it("сбой — одно предупреждение на имя за жизнь страницы, причина — последняя ошибка или «нет ответа за 5 с»", async () => {
    fakeNet(all("silent"));
    const core = await freshCore();
    core.loadIcon("demo:house");
    await wait(5000);
    expect(core.getIcon("demo:house")).toBe("error");
    core.loadIcon("demo:house");
    await wait(5000);
    expect(warn.mock.calls).toEqual([
      [
        'Iconavo: icon "demo:house" failed to load',
        expect.objectContaining({ message: "No answer in 5 s" }),
      ],
    ]);
  });
});

describe("подписка", () => {
  it("сигнал на каждую смену состояния; отписка во время сигнала не мешает остальным", async () => {
    fakeFetch();
    const core = await freshCore();
    const calls: string[] = [];
    const stop = core.subscribeIcon("demo:house", () => {
      calls.push(`first ${JSON.stringify(core.getIcon("demo:house"))}`);
      stop();
    });
    core.subscribeIcon("demo:house", () => calls.push("second"));
    core.loadIcon("demo:house");
    await idle();
    expect(calls).toEqual(['first "loading"', "second", "second"]);
    core.addIcons({ prefix: "demo", icons: { house: { body: "<g/>" } } });
    expect(calls).toHaveLength(4);
  });

  it("после отписки последнего слушателя имя не держит память", async () => {
    const core = await freshCore();
    const stop = core.subscribeIcon("demo:house", () => {});
    stop();
    stop();
    expect(core.store.listeners.has("demo:house")).toBe(false);
  });
});
