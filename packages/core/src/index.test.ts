import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  demoBatch,
  fakeFetch,
  freshCore,
  idle,
} from "./fake.testing.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for("iconavo.core.1")
  ];
});

const BASE = "https://api.iconavo.dev/demo.json?icons=";

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
    for (const name of ["loop", "nowhere", "turned"]) {
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
    fail = false;
    core.loadIcon("flaky:a");
    await idle();
    expect(core.getIcon("flaky:a")).toMatchObject({ body: "<g/>" });
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
    const sets = await core.loadIcons([
      "demo:house",
      "acme:logo",
      "demo:missing-x",
      "demo:house",
      "demo:Bad",
      "nonsense",
    ]);
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
    // Ответ — копии: правка не меняет хранилище.
    (sets[0]?.icons.house as { body: string }).body = "<changed/>";
    expect(core.getIcon("demo:house")).toMatchObject({
      body: '<path d="house"/>',
    });
    // Ответ подходит для addIcons — так его передаст IconavoProvider (шаг 6).
    const other = await freshCore();
    other.addIcons(sets);
    expect(other.getIcon("demo:house")).toMatchObject({ width: 24 });
    expect(other.getIcon("demo:missing-x")).toBe("missing");
  });

  it("не отклоняется: не загрузившихся иконок в ответе нет", async () => {
    fakeFetch((url) =>
      url.searchParams.get("icons") === "broken"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : demoBatch(url),
    );
    const core = await freshCore();
    expect(await core.loadIcons(["demo:broken"])).toEqual([]);
    expect(await core.loadIcons(["demo:house"])).toEqual([
      expect.objectContaining({ prefix: "demo" }),
    ]);
    expect(await core.loadIcons([])).toEqual([]);
    expect(await core.loadIcons([null as unknown as string])).toEqual([]);
  });

  it("ждёт имя, которое уже грузится, и не запрашивает его второй раз", async () => {
    const answer = deferred<Response>();
    const requests = fakeFetch(() => answer.promise);
    const core = await freshCore();
    core.loadIcon("demo:house");
    await idle();
    const loading = core.loadIcons(["demo:house"]);
    answer.resolve(demoBatch(new URL(`${BASE}house`)));
    expect((await loading)[0]?.icons.house).toMatchObject({
      body: '<path d="house"/>',
    });
    expect(requests).toHaveLength(1);
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
