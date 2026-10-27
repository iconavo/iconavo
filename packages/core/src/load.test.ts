import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Core,
  deferred,
  demoBatch,
  fakeFetch,
  freshCore,
  idle,
} from "./fake.testing.js";
import { batches, MAX_NAMES, MAX_URL } from "./load.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const HOST = "https://api.iconavo.dev";
const BASE = `${HOST}/demo.json?icons=`;

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
      `${HOST}/alpha.json?icons=y,z`,
      `${HOST}/beta.json?icons=a,b`,
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

  it("неизвестный набор: 404 и ответ 200 с телом 404, как у Iconify API, — «нет»", async () => {
    fakeFetch((url) =>
      url.pathname === "/iconify.json" ? Response.json(404) : demoBatch(url),
    );
    const core = await freshCore();
    show(core, ["nope:house", "iconify:house"]);
    await idle();
    expect(core.getIcon("nope:house")).toBe("missing");
    expect(core.getIcon("iconify:house")).toBe("missing");
  });

  it("сбой — «ошибка», а новый показ запрашивает снова", async () => {
    const failures: (() => Response | Promise<Response>)[] = [
      () => new Response("oops", { status: 503 }),
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => new Response("<html>", { status: 200 }),
      () => Response.json(null),
      () => Response.json({ prefix: "other", icons: {} }),
    ];
    for (const failure of failures) {
      let failing = true;
      const requests = fakeFetch((url) =>
        failing ? failure() : demoBatch(url),
      );
      const core = await freshCore();
      show(core, ["demo:house"]);
      await idle();
      expect(core.getIcon("demo:house")).toBe("error");
      failing = false;
      show(core, ["demo:house"]);
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

  it("свой хост: адрес без лишнего «/» в конце; пустой список — «ошибка» без запроса", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    core.configure({ api: ["https://icons.example.com/api/"] });
    show(core, ["demo:house"]);
    await idle();
    expect(requests).toEqual([
      "https://icons.example.com/api/demo.json?icons=house",
    ]);
    core.configure({ api: [] });
    show(core, ["demo:heart"]);
    await idle();
    expect(requests).toHaveLength(1);
    expect(core.getIcon("demo:heart")).toBe("error");
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
