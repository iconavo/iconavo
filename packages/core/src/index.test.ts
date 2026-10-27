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
  deferred,
  demoBatch,
  demoHosts,
  fakeFetch,
  fakeNet,
  fakeTime,
  freshCore,
  hosts,
  idle,
  realTime,
  settled,
  wait,
  warnings,
} from "./fake.testing.js";
import type { IconavoIconSet } from "./icon.js";

let warn: MockInstance;
beforeEach(() => {
  fakeTime();
  warn = warnings();
});
afterEach(() => {
  realTime();
  delete (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for("iconavo.core.1")
  ];
});

const API = "https://api.iconavo.dev";
const BASE = `${API}/demo.json?icons=`;

/** Все четыре наших хоста с одним поведением. */
const all = (behavior: Behavior) =>
  hosts({
    "api.iconavo.dev": behavior,
    "cdn.iconavo.dev": behavior,
    "cdn2.iconavo.dev": behavior,
    "iconavo.b-cdn.net": behavior,
  });

describe("публичное API", () => {
  it("главный вход — ровно четыре функции README", async () => {
    vi.resetModules();
    const index = await import("./index.js");
    expect(Object.keys(index).sort()).toEqual([
      "addIcons",
      "configure",
      "loadIcons",
      "setLoader",
    ]);
  });
});

describe("addIcons", () => {
  it("иконки и алиасы загружены без сети, not_found — «нет»", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    core.addIcons([
      {
        prefix: "acme",
        width: 24,
        height: 24,
        icons: {
          logo: { body: "<g/>" },
          wide: { body: "<path/>", width: 48 },
        },
        aliases: { brand: { parent: "logo" } },
        not_found: ["gone"],
      },
      { prefix: "demo", icons: { house: { body: "<i/>" } } },
    ]);
    expect(core.getIcon("acme:logo")).toEqual({
      body: "<g/>",
      left: 0,
      top: 0,
      width: 24,
      height: 24,
    });
    expect(core.getIcon("acme:wide")).toMatchObject({ width: 48, height: 24 });
    expect(core.getIcon("acme:brand")).toMatchObject({ body: "<g/>" });
    expect(core.getIcon("acme:gone")).toBe("missing");
    expect(core.getIcon("demo:house")).toMatchObject({ width: 16, height: 16 });
    for (const name of ["acme:logo", "acme:brand", "acme:gone", "demo:house"]) {
      core.loadIcon(name);
    }
    await idle();
    expect(requests).toEqual([]);
  });

  it("заменяет одноимённые иконки и подаёт сигнал тем, что на странице", async () => {
    fakeFetch();
    const core = await freshCore();
    core.loadIcon("demo:house");
    await idle();
    const redraw = vi.fn();
    core.subscribeIcon("demo:house", redraw);
    core.addIcons({ prefix: "demo", icons: { house: { body: "<g/>" } } });
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(core.getIcon("demo:house")).toMatchObject({ body: "<g/>" });
  });

  it("битый алиас — «нет» сразу, остальные иконки целы; «нет» не заменяет загруженную", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    core.addIcons({
      prefix: "acme",
      icons: { logo: { body: "<g/>" } },
      aliases: {
        loop: { parent: "loop" },
        nowhere: { parent: "lost" },
        turned: { parent: "logo", rotate: 1 },
      },
    });
    expect(core.getIcon("acme:logo")).toMatchObject({ body: "<g/>" });
    // Поворот в данных — не ошибка: он уже в рисунке (ADR-0031).
    expect(core.getIcon("acme:turned")).toMatchObject({
      body: '<g transform="rotate(90 8 8)"><g/></g>',
    });
    for (const name of ["loop", "nowhere"]) {
      expect(core.getIcon(`acme:${name}`)).toBe("missing");
      core.loadIcon(`acme:${name}`);
    }
    core.addIcons({ prefix: "acme", icons: {}, not_found: ["logo"] });
    expect(core.getIcon("acme:logo")).toMatchObject({ body: "<g/>" });
    await idle();
    expect(requests).toEqual([]);
  });

  it("неверный префикс — исключение, и из массива не добавляется ничего", async () => {
    const core = await freshCore();
    expect(() =>
      core.addIcons({ prefix: "@private", icons: { a: { body: "<g/>" } } }),
    ).toThrow('Invalid icon set prefix "@private"');
    expect(() =>
      core.addIcons([
        { prefix: "acme", icons: { logo: { body: "<g/>" } } },
        { icons: {} } as never,
      ]),
    ).toThrow('Invalid icon set prefix "undefined"');
    expect(core.getIcon("acme:logo")).toBe("loading");
  });
});

describe("setLoader", () => {
  it("один вызов за тик на набор, имена без повторов и по порядку", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    const loader = vi.fn(async (names: string[]) => ({
      prefix: "acme",
      icons: Object.fromEntries(
        names
          .filter((n) => n !== "gone")
          .map((n) => [n, { body: `<path d="${n}"/>` }]),
      ),
    }));
    core.setLoader("acme", loader);
    for (const name of ["zeta", "alpha", "zeta", "gone"]) {
      core.loadIcon(`acme:${name}`);
    }
    await idle();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(["alpha", "gone", "zeta"]);
    expect(core.getIcon("acme:alpha")).toMatchObject({
      body: '<path d="alpha"/>',
    });
    expect(core.getIcon("acme:gone")).toBe("missing");
    expect(requests).toEqual([]);
  });

  it("null — «нет»; отказ и исключение — «ошибка» с новой попыткой при следующем показе", async () => {
    const core = await freshCore();
    core.setLoader("none", async () => null);
    let fail = true;
    core.setLoader("flaky", async (names) => {
      if (fail) throw new Error("offline");
      return {
        prefix: "flaky",
        icons: { [names[0] as string]: { body: "<g/>" } },
      };
    });
    core.setLoader("sync", () => {
      throw new Error("bug");
    });
    for (const name of ["none:a", "flaky:a", "sync:a"]) core.loadIcon(name);
    await idle();
    expect(core.getIcon("none:a")).toBe("missing");
    expect(core.getIcon("flaky:a")).toBe("error");
    expect(core.getIcon("sync:a")).toBe("error");
    expect(warn).toHaveBeenCalledWith(
      'Iconavo: icon "sync:a" failed to load',
      expect.objectContaining({ message: "bug" }),
    );
    fail = false;
    core.loadIcon("flaky:a");
    await idle();
    expect(core.getIcon("flaky:a")).toMatchObject({ body: "<g/>" });
  });

  it("отказ — повторы через 1, 2 и 4 с, пока иконку показывают; null — «нет» без повторов", async () => {
    const core = await freshCore();
    const start = Date.now();
    const at: number[] = [];
    core.setLoader("acme", async () => {
      at.push(Date.now() - start);
      throw new Error("offline");
    });
    core.setLoader("none", async () => null);
    for (const name of ["acme:logo", "none:logo"]) {
      core.subscribeIcon(name, () => {});
      core.loadIcon(name);
    }
    await wait(10_000);
    expect(at).toEqual([0, 1000, 3000, 7000]);
    expect(core.getIcon("acme:logo")).toBe("error");
    expect(core.getIcon("none:logo")).toBe("missing");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("молчит 5 с — повтор; поздний ответ первого вызова принимается", async () => {
    const core = await freshCore();
    const first = deferred<IconavoIconSet | null>();
    const loader = vi
      .fn<(names: string[]) => Promise<IconavoIconSet | null>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(new Promise(() => {}));
    core.setLoader("acme", loader);
    core.subscribeIcon("acme:logo", () => {});
    core.loadIcon("acme:logo");
    await wait(5999);
    expect(loader).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(loader).toHaveBeenCalledTimes(2);
    first.resolve({ prefix: "acme", icons: { logo: { body: "<g/>" } } });
    await idle();
    expect(core.getIcon("acme:logo")).toMatchObject({ body: "<g/>" });
  });

  it("null вместо функции снимает загрузчик; неверный префикс — исключение", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    core.setLoader("demo", async () => null);
    core.setLoader("demo", null);
    core.loadIcon("demo:house");
    await idle();
    expect(requests).toEqual([`${BASE}house`]);
    expect(() => core.setLoader("Bad", null)).toThrow();
  });
});

describe("loadIcons", () => {
  it("по объекту на набор: загруженные иконки и not_found, в том числе неверные имена", async () => {
    const requests = fakeFetch();
    const core = await freshCore();
    core.addIcons({ prefix: "acme", icons: { logo: { body: "<g/>" } } });
    const sets = await settled(
      core.loadIcons([
        "demo:house",
        "acme:logo",
        "demo:missing-x",
        "demo:house",
        "demo:Bad",
        "nonsense",
      ]),
    );
    expect(sets).toEqual([
      {
        prefix: "demo",
        icons: {
          house: {
            body: '<path d="house"/>',
            left: 0,
            top: 0,
            width: 24,
            height: 24,
          },
        },
        not_found: ["missing-x", "Bad"],
      },
      {
        prefix: "acme",
        icons: {
          logo: { body: "<g/>", left: 0, top: 0, width: 16, height: 16 },
        },
      },
    ]);
    expect(requests).toEqual([`${BASE}house,missing-x`]);
    expect(warn.mock.calls.map(([message]) => message).sort()).toEqual([
      'Iconavo: icon "demo:missing-x" not found',
      'Iconavo: invalid icon name "demo:Bad"',
      'Iconavo: invalid icon name "nonsense"',
    ]);
    // Ответ — копии: правка не меняет хранилище.
    (sets[0]?.icons.house as { body: string }).body = "<changed/>";
    expect(core.getIcon("demo:house")).toMatchObject({
      body: '<path d="house"/>',
    });
    // Ответ подходит для addIcons — так его передаст IconavoProvider (шаг 7).
    const other = await freshCore();
    other.addIcons(sets);
    expect(other.getIcon("demo:house")).toMatchObject({ width: 24 });
    expect(other.getIcon("demo:missing-x")).toBe("missing");
  });

  it("поворот и отражение из данных — в ответе уже в рисунке, и addIcons рисует так же", async () => {
    fakeFetch();
    const core = await freshCore();
    core.addIcons({
      prefix: "acme",
      width: 32,
      height: 16,
      icons: { arrow: { body: "<path/>" } },
      aliases: { "arrow-down": { parent: "arrow", rotate: 1, hFlip: true } },
    });
    const sets = await settled(core.loadIcons(["acme:arrow-down"]));
    const other = await freshCore();
    other.addIcons(sets);
    expect(other.getIcon("acme:arrow-down")).toEqual(
      core.getIcon("acme:arrow-down"),
    );
    expect(other.getIcon("acme:arrow-down")).toMatchObject({
      width: 16,
      height: 32,
    });
  });

  it("не отклоняется: не загрузившихся иконок в ответе нет", async () => {
    fakeFetch((url) =>
      url.searchParams.get("icons") === "broken" ||
      url.pathname.endsWith("/broken.json")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : demoHosts(url),
    );
    const core = await freshCore();
    expect(await settled(core.loadIcons(["demo:broken"]))).toEqual([]);
    expect(await settled(core.loadIcons(["demo:house"]))).toEqual([
      expect.objectContaining({ prefix: "demo" }),
    ]);
    expect(await settled(core.loadIcons([]))).toEqual([]);
    expect(await settled(core.loadIcons([null as unknown as string]))).toEqual(
      [],
    );
  });

  it("ждёт имя, которое уже грузится, и не запрашивает его второй раз", async () => {
    const answer = deferred<Response>();
    const requests = fakeFetch(() => answer.promise);
    const core = await freshCore();
    core.loadIcon("demo:house");
    await idle();
    const loading = core.loadIcons(["demo:house"]);
    answer.resolve(demoBatch(new URL(`${BASE}house`)));
    expect((await settled(loading))[0]?.icons.house).toMatchObject({
      body: '<path d="house"/>',
    });
    expect(requests).toHaveLength(1);
  });

  it("один проход: хосты отказали — ответ сразу, после него ни таймеров, ни запросов", async () => {
    const calls = fakeNet(all("down"));
    const core = await freshCore();
    expect(await settled(core.loadIcons(["demo:house"]))).toEqual([]);
    expect(calls).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
    await wait(10_000);
    expect(calls).toHaveLength(4);
    expect(core.getIcon("demo:house")).toBe("error");
  });

  it("хосты молчат — ответ ровно через 5 с, без повторов", async () => {
    const calls = fakeNet(all("silent"));
    const core = await freshCore();
    let result: IconavoIconSet[] | undefined;
    void core.loadIcons(["demo:house"]).then((sets) => {
      result = sets;
    });
    await wait(4999);
    expect(result).toBeUndefined();
    await wait(1);
    expect(result).toEqual([]);
    await wait(10_000);
    expect(calls).toHaveLength(4);
    expect(core.getIcon("demo:house")).toBe("error");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("имя повторяют ради иконки на странице — ответ не позже 5 с, своего запроса нет", async () => {
    const calls = fakeNet(all("down"));
    const core = await freshCore();
    core.subscribeIcon("demo:house", () => {});
    core.loadIcon("demo:house");
    let result: IconavoIconSet[] | undefined;
    void core.loadIcons(["demo:house"]).then((sets) => {
      result = sets;
    });
    await wait(4999);
    expect(result).toBeUndefined();
    await wait(1);
    // В полёте имя не «нет»: в not_found его нет.
    expect(result).toEqual([]);
    expect(calls.filter((c) => c.url.startsWith(API)).map((c) => c.at)).toEqual(
      [0, 1000, 3000],
    );
  });
});

describe("configure", () => {
  it("пропущенные настройки сохраняются, неверный placeholder не меняет настройку", async () => {
    const core = await freshCore();
    core.configure({ cdn: ["https://static.example.com/"] });
    core.configure({ placeholder: "spinner", dev: true });
    core.configure({ placeholder: "dots" as never });
    expect(core.store.settings).toEqual({
      api: ["https://api.iconavo.dev"],
      cdn: ["https://static.example.com"],
      placeholder: "spinner",
      dev: true,
    });
  });

  it("хосты по умолчанию — четыре адреса ADR-0030; configure их не портит", async () => {
    const core = await freshCore();
    expect(core.DEFAULT_API).toEqual(["https://api.iconavo.dev"]);
    expect(core.DEFAULT_CDN).toEqual([
      "https://cdn.iconavo.dev",
      "https://cdn2.iconavo.dev",
      "https://iconavo.b-cdn.net",
    ]);
    expect(core.store.settings.cdn).toEqual(core.DEFAULT_CDN);
    expect(core.store.settings.cdn).not.toBe(core.DEFAULT_CDN);
    core.configure({ api: [], cdn: [] });
    expect(core.DEFAULT_CDN).toHaveLength(3);
  });
});

describe("общее хранилище", () => {
  it("в браузере копии ядра делят иконки, настройки и загрузку одного имени", async () => {
    vi.stubGlobal("document", {});
    const answer = deferred<Response>();
    const requests = fakeFetch(() => answer.promise);
    const first = await freshCore();
    const second = await freshCore();
    expect(first.store).toBe(second.store);
    first.addIcons({ prefix: "acme", icons: { logo: { body: "<g/>" } } });
    expect(second.getIcon("acme:logo")).toMatchObject({ body: "<g/>" });
    first.configure({ api: ["https://icons.example.com"] });
    const redraw = vi.fn();
    second.subscribeIcon("demo:house", redraw);
    first.loadIcon("demo:house");
    second.loadIcon("demo:house");
    await idle();
    expect(requests).toEqual([
      "https://icons.example.com/demo.json?icons=house",
    ]);
    answer.resolve(demoBatch(new URL(requests[0] as string)));
    await idle();
    expect(second.getIcon("demo:house")).toMatchObject({
      body: '<path d="house"/>',
    });
    expect(redraw).toHaveBeenCalled();
  });

  it("повторяет копия, которая грузила, пока иконку показывает другая", async () => {
    vi.stubGlobal("document", {});
    const calls = fakeNet(all("down"));
    const first = await freshCore();
    const second = await freshCore();
    second.subscribeIcon("demo:house", () => {});
    first.loadIcon("demo:house");
    second.loadIcon("demo:house");
    await wait(1000);
    expect(calls.filter((c) => c.url.startsWith(API)).map((c) => c.at)).toEqual(
      [0, 1000],
    );
  });

  it("предупреждение одно на страницу и при двух копиях ядра", async () => {
    vi.stubGlobal("document", {});
    const first = await freshCore();
    const second = await freshCore();
    first.loadIcon("Lucide:House");
    second.loadIcon("Lucide:House");
    expect(warn.mock.calls).toEqual([
      ['Iconavo: invalid icon name "Lucide:House"'],
    ]);
  });

  it("на сервере у каждой копии своё, и в globalThis ничего не пишется", async () => {
    const first = await freshCore();
    const second = await freshCore();
    expect(first.store).not.toBe(second.store);
    first.addIcons({ prefix: "acme", icons: { logo: { body: "<g/>" } } });
    expect(second.getIcon("acme:logo")).toBe("loading");
    expect(Object.getOwnPropertySymbols(globalThis).map(String)).not.toContain(
      "Symbol(iconavo.core.1)",
    );
  });
});
