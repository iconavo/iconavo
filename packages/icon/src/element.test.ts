import type { IconavoIconSet } from "@iconavo-ui/core";
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
  type DomOptions,
  deferred,
  FakeRoot,
  FakeTrusted,
  idle,
  installDom,
} from "./dom.testing.js";

type Entry = "index" | "development" | "script";

/** Новые модули пакета и ядра: у каждого теста свой тег и своё хранилище. */
async function load(entry: Entry = "index") {
  const pkg =
    entry === "index"
      ? await import("./index.js")
      : entry === "development"
        ? await import("./development.js")
        : await import("./script.js");
  const core = await import("@iconavo-ui/core/internal");
  return { ...pkg, core };
}

/** Подделка DOM и пакет без хостов: имя, которого нет в addIcons и setLoader, — «ошибка» сразу, без сети. */
async function setup(options: DomOptions = {}, entry: Entry = "index") {
  const dom = installDom(options);
  const pkg = await load(entry);
  pkg.configure({ api: [], cdn: [] });
  return { dom, ...pkg };
}

const DEMO: IconavoIconSet = {
  prefix: "demo",
  width: 24,
  height: 24,
  icons: {
    house: {
      body: '<path d="M3 10l9-7 9 7" stroke="currentColor" stroke-width="2"/>',
    },
    wide: { body: '<path d="M0 0h48v24z"/>', width: 48 },
  },
};

/** Загрузчик набора acme: каждое имя — иконка. */
const icons = async (names: string[]): Promise<IconavoIconSet> => ({
  prefix: "acme",
  icons: Object.fromEntries(names.map((name) => [name, { body: "<g/>" }])),
});

const reserve = (attributes: string) =>
  `<svg aria-hidden="true" ${attributes}>`;

let warn: MockInstance;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.resetModules();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  const shared = globalThis as unknown as Record<symbol, unknown>;
  delete shared[Symbol.for("iconavo.core.1")];
  delete shared[Symbol.for("iconavo.trusted-types")];
});

describe("регистрация", () => {
  it("тег регистрирует первая копия; вторая копия и вход для разработки пропускают регистрацию", async () => {
    const dom = installDom();
    await import("./index.js");
    vi.resetModules();
    await import("./index.js");
    vi.resetModules();
    await import("./development.js");
    expect(dom.define.mock.calls.map(([name]) => name)).toEqual([
      "iconavo-icon",
    ]);
  });

  it("копии делят хранилище: configure второй копии действует на тег первой", async () => {
    const { dom } = await setup();
    vi.resetModules();
    const second = await load();
    second.addIcons(DEMO);
    const tag = dom.connect(dom.create({ icon: "demo:house", noobserver: "" }));
    await idle();
    expect(dom.shadow(tag)).toContain('viewBox="0 0 24 24"');
  });

  it("лист стилей один на все теги; hidden и inline — правилами CSS", async () => {
    const { dom } = await setup();
    const [a, b] = [dom.create(), dom.create()];
    const sheet = a.shadow?.adoptedStyleSheets[0] as { text: string };
    expect(b.shadow?.adoptedStyleSheets[0]).toBe(sheet);
    expect(sheet.text).toContain(":host([hidden]){display:none}");
    expect(sheet.text).toContain(":host([inline]){vertical-align:-.125em}");
  });
});

describe("резерв и ленивая загрузка", () => {
  it("резерв ставится сразу при подключении: 1em, квадрат по одной стороне, заданные размеры", async () => {
    const { dom } = await setup();
    const cases: [Record<string, string>, string][] = [
      [{}, 'width="1em" height="1em" class=""'],
      [{ width: "32" }, 'width="32" height="32" class=""'],
      [{ height: "2em" }, 'width="2em" height="2em" class=""'],
      [{ width: "32", height: "16" }, 'width="32" height="16" class=""'],
      [{ width: "auto" }, 'width="1em" height="1em" class=""'],
      [
        { width: "auto", height: "24px" },
        'width="24px" height="24px" class=""',
      ],
      [{ width: "50%" }, 'width="1em" height="1em" class=""'],
    ];
    for (const [attributes, expected] of cases) {
      const tag = dom.connect(
        dom.create({ icon: "demo:house", ...attributes }),
      );
      expect(dom.shadow(tag)).toBe(reserve(expected));
    }
    expect(warn.mock.calls).toEqual([
      ['Iconavo: invalid width "50%", use a number, a CSS length or auto'],
    ]);
  });

  it("до видимой части страницы ничего не грузит; у неё — грузит и рисует, наблюдение снято", async () => {
    const { dom, setLoader } = await setup();
    const loader = vi.fn(icons);
    setLoader("acme", loader);
    const tag = dom.connect(dom.create({ icon: "acme:logo" }));
    await idle();
    expect(loader).not.toHaveBeenCalled();
    expect(dom.observed()).toEqual([tag]);
    expect(dom.margins()).toEqual(["50%"]);
    dom.intersect(tag);
    await idle();
    expect(loader.mock.calls).toEqual([[["logo"]]]);
    expect(dom.observed()).toEqual([]);
    expect(dom.shadow(tag)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true"><g/></svg>',
    );
  });

  it("noobserver, а также среда без IntersectionObserver и листов стилей — грузит сразу", async () => {
    const { dom, setLoader } = await setup();
    const loader = vi.fn(icons);
    setLoader("acme", loader);
    dom.connect(dom.create({ icon: "acme:a", noobserver: "" }));
    const late = dom.connect(dom.create({ icon: "acme:b" }));
    late.setAttribute("noobserver", "");
    await idle();
    expect(loader.mock.calls).toEqual([[["a", "b"]]]);
    expect(dom.observed()).toEqual([]);

    vi.unstubAllGlobals();
    delete (globalThis as unknown as Record<symbol, unknown>)[
      Symbol.for("iconavo.core.1")
    ];
    vi.resetModules();
    const bare = installDom({ noObserver: true });
    vi.stubGlobal(
      "CSSStyleSheet",
      class {
        constructor() {
          throw new TypeError("Illegal constructor");
        }
      },
    );
    const pkg = await load();
    const later = vi.fn(icons);
    pkg.setLoader("acme", later);
    const tag = bare.connect(bare.create({ icon: "acme:c" }));
    await idle();
    expect(later.mock.calls).toEqual([[["c"]]]);
    expect(tag.shadow?.adoptedStyleSheets).toEqual([]);
  });

  it("поздний сигнал наблюдателя о снятом со страницы теге ничего не делает", async () => {
    const { dom, setLoader } = await setup();
    const loader = vi.fn(icons);
    setLoader("acme", loader);
    const tag = dom.connect(dom.create({ icon: "acme:logo" }));
    dom.disconnect(tag);
    dom.intersect(tag);
    await idle();
    expect(loader).not.toHaveBeenCalled();
    dom.connect(tag);
    dom.intersect(tag, false);
    await idle();
    expect(loader).not.toHaveBeenCalled();
    dom.intersect(tag);
    await idle();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("без атрибута icon — ни запроса, ни предупреждения; имя поставили позже — грузит", async () => {
    const { dom, setLoader } = await setup();
    const loader = vi.fn(icons);
    setLoader("acme", loader);
    const tag = dom.connect(dom.create({ noobserver: "" }));
    await idle();
    expect(dom.shadow(tag)).toBe(reserve('width="1em" height="1em" class=""'));
    tag.setAttribute("icon", "acme:logo");
    await idle();
    expect(loader.mock.calls).toEqual([[["logo"]]]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("заглушки", () => {
  it("класс резерва при загрузке: скелетон по умолчанию, spinner, none и общая настройка configure", async () => {
    const { dom, setLoader, configure } = await setup();
    setLoader("slow", () => deferred<null>().promise);
    const tags = [{}, { placeholder: "spinner" }, { placeholder: "none" }].map(
      (attributes, i) =>
        dom.connect(dom.create({ icon: `slow:i${i}`, ...attributes })),
    );
    expect(tags.map(dom.shadow)).toEqual(
      tags.map(() => reserve('width="1em" height="1em" class=""')),
    );
    for (const tag of tags) dom.intersect(tag);
    await idle();
    expect(tags.map(dom.shadow)).toEqual(
      ["skeleton", "spinner", "none"].map((c) =>
        reserve(`width="1em" height="1em" class="${c}"`),
      ),
    );
    configure({ placeholder: "spinner" });
    const later = dom.connect(
      dom.create({ icon: "slow:later", noobserver: "" }),
    );
    await idle();
    expect(dom.shadow(later)).toBe(
      reserve('width="1em" height="1em" class="spinner"'),
    );
  });

  it("резерв не пересоздаётся, пока иконка грузится: отсчёт до заглушки не начинается заново", async () => {
    const { dom, setLoader } = await setup();
    setLoader("slow", () => deferred<null>().promise);
    const tag = dom.connect(dom.create({ icon: "slow:a", noobserver: "" }));
    await idle();
    const node = tag.shadow?.firstElementChild;
    tag.setAttribute("icon", "slow:a");
    await idle();
    expect(tag.shadow?.firstElementChild).toBe(node);
  });
});

describe("рисунок", () => {
  it("рисунок renderIcon без подписи и цвета; цвет — стилем <svg>; неверное значение — без него и одно предупреждение", async () => {
    const { dom, addIcons, core } = await setup();
    addIcons(DEMO);
    const attributes = {
      icon: "demo:house",
      color: "var(--brand)",
      rotate: "45deg",
      "stroke-width": "1.5",
      noobserver: "",
    };
    const tag = dom.connect(dom.create(attributes));
    dom.connect(dom.create(attributes));
    await idle();
    const data = core.getIcon("demo:house");
    if (typeof data !== "object") throw new Error("иконка не загружена");
    const svg = core.svgToString(core.renderIcon(data, { strokeWidth: 1.5 }));
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('stroke-width="1.5"');
    expect(dom.shadow(tag)).toBe(`${svg} style.color=var(--brand)`);
    expect(warn.mock.calls).toEqual([
      ['Iconavo: invalid rotate "45deg", use 90deg, 180deg, 270deg or 1, 2, 3'],
    ]);
  });

  it("перерисовки копятся до микрозадачи: три атрибута — одна запись разметки", async () => {
    const { dom, addIcons } = await setup();
    addIcons(DEMO);
    const tag = dom.connect(dom.create({ icon: "demo:wide", noobserver: "" }));
    await idle();
    expect(tag.shadow?.writes).toHaveLength(1);
    tag.setAttribute("width", "32");
    tag.setAttribute("rotate", "90deg");
    tag.setAttribute("flip", "horizontal");
    await idle();
    expect(tag.shadow?.writes).toHaveLength(2);
    expect(dom.shadow(tag)).toContain('width="32" height="64"');
  });

  it("смена имени снимает старую подписку и грузит новое имя", async () => {
    const { dom, addIcons, core } = await setup();
    addIcons(DEMO);
    const tag = dom.connect(dom.create({ icon: "demo:house", noobserver: "" }));
    await idle();
    expect([...core.store.listeners.keys()]).toEqual(["demo:house"]);
    tag.setAttribute("icon", "demo:wide");
    await idle();
    expect([...core.store.listeners.keys()]).toEqual(["demo:wide"]);
    expect(dom.shadow(tag)).toContain('viewBox="0 0 48 24"');
  });
});

describe("подпись", () => {
  it("у самого тега сразу, без видимости; из пробелов и снятая — декоративная", async () => {
    const { dom } = await setup();
    const tag = dom.create({ icon: "demo:house", label: "Delete" });
    expect(tag.internals).toEqual({ role: "img", ariaLabel: "Delete" });
    tag.setAttribute("label", "   ");
    expect(tag.internals).toEqual({ role: null, ariaLabel: null });
    tag.setAttribute("label", "Удалить");
    expect(tag.internals).toEqual({ role: "img", ariaLabel: "Удалить" });
    tag.removeAttribute("label");
    expect(tag.internals).toEqual({ role: null, ariaLabel: null });
  });
});

describe("иконки нет и ошибки", () => {
  const missing = reserve('width="1em" height="1em" class="missing"');
  const empty = reserve('width="1em" height="1em" class=""');

  it("обычная сборка: пустое место; configure({ dev: true }) — пунктирная рамка", async () => {
    const { dom, addIcons, configure } = await setup();
    addIcons({ prefix: "demo", icons: {}, not_found: ["gone"] });
    const tags = ["demo:gone", "acme:nohost", "Demo:House"].map((icon) =>
      dom.connect(dom.create({ icon, noobserver: "" })),
    );
    await idle();
    expect(tags.map(dom.shadow)).toEqual([empty, empty, empty]);
    configure({ dev: true });
    for (const tag of tags) {
      tag.setAttribute("icon", tag.getAttribute("icon") as string);
    }
    await idle();
    expect(tags.map(dom.shadow)).toEqual([missing, missing, missing]);
    expect(warn.mock.calls.map(([text]) => text)).toEqual([
      'Iconavo: invalid icon name "Demo:House"',
      'Iconavo: icon "acme:nohost" failed to load',
    ]);
  });

  it("сборка для разработки — рамка по умолчанию, configure({ dev: false }) главнее", async () => {
    const { dom, configure } = await setup({}, "development");
    const tag = dom.connect(dom.create({ icon: "acme:x", noobserver: "" }));
    await idle();
    expect(dom.shadow(tag)).toBe(missing);
    configure({ dev: false });
    tag.setAttribute("icon", "acme:x");
    await idle();
    expect(dom.shadow(tag)).toBe(empty);
  });

  it("скрипт без сборщика — рамка на localhost, 127.0.0.1, [::1] и file:, на сайте — нет", async () => {
    const pages: [Partial<Location>, string][] = [
      [{ protocol: "http:", hostname: "localhost" }, missing],
      [{ protocol: "http:", hostname: "127.0.0.1" }, missing],
      [{ protocol: "http:", hostname: "[::1]" }, missing],
      [{ protocol: "file:", hostname: "" }, missing],
      [{ protocol: "https:", hostname: "example.com" }, empty],
    ];
    for (const [location, expected] of pages) {
      vi.unstubAllGlobals();
      const shared = globalThis as unknown as Record<symbol, unknown>;
      delete shared[Symbol.for("iconavo.core.1")];
      delete shared[Symbol.for("iconavo.trusted-types")];
      vi.resetModules();
      const dom = installDom();
      vi.stubGlobal("location", location);
      const pkg = await load("script");
      pkg.configure({ api: [], cdn: [] });
      const tag = dom.connect(dom.create({ icon: "acme:x", noobserver: "" }));
      await idle();
      expect(dom.shadow(tag)).toBe(expected);
    }
  });

  it("убранный со страницы тег отписан: повторы ядра для него останавливаются", async () => {
    const { dom, setLoader, core } = await setup();
    const loader = vi.fn(() => Promise.reject(new Error("down")));
    setLoader("acme", loader);
    const tag = dom.connect(dom.create({ icon: "acme:logo", noobserver: "" }));
    await idle();
    expect(loader).toHaveBeenCalledTimes(1);
    dom.disconnect(tag);
    expect(core.store.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await idle();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("после «ошибки» запросы не идут по кругу; вернули тег на страницу — ещё одна попытка", async () => {
    const { dom, setLoader, core } = await setup();
    const loader = vi.fn(() => Promise.reject(new Error("down")));
    setLoader("acme", loader);
    const tag = dom.connect(dom.create({ icon: "acme:logo", noobserver: "" }));
    await vi.advanceTimersByTimeAsync(20_000);
    await idle();
    expect(loader).toHaveBeenCalledTimes(4);
    expect(core.getIcon("acme:logo")).toBe("error");
    await vi.advanceTimersByTimeAsync(60_000);
    await idle();
    expect(loader).toHaveBeenCalledTimes(4);
    dom.disconnect(tag);
    dom.connect(tag);
    await idle();
    expect(loader).toHaveBeenCalledTimes(5);
  });
});

describe("Trusted Types", () => {
  it("одна политика iconavo на страницу, и для другой копии пакета; разметка идёт через неё", async () => {
    const { dom, addIcons } = await setup({
      trustedTypes: "ok",
      enforced: true,
    });
    addIcons(DEMO);
    const tags = ["demo:house", "demo:wide"].map((icon) =>
      dom.connect(dom.create({ icon, noobserver: "" })),
    );
    await idle();
    vi.resetModules();
    const { write } = await import("./trusted.js");
    expect(write(new FakeRoot() as unknown as ShadowRoot, "<g/>")).toBe(true);
    expect(dom.createPolicy.mock.calls.map(([name]) => name)).toEqual([
      "iconavo",
    ]);
    for (const tag of tags) {
      expect(tag.shadow?.writes[0]).toBeInstanceOf(FakeTrusted);
    }
  });

  it("политику не разрешили: иконки — как отсутствующие, одно предупреждение и без исключений", async () => {
    const { dom, addIcons } = await setup({
      trustedTypes: "throws",
      enforced: true,
    });
    addIcons(DEMO);
    const tags = ["demo:house", "demo:wide"].map((icon) =>
      dom.connect(dom.create({ icon, noobserver: "" })),
    );
    await idle();
    expect(tags.map(dom.shadow)).toEqual(
      tags.map(() => reserve('width="1em" height="1em" class=""')),
    );
    expect(warn.mock.calls).toEqual([
      ['Iconavo: Trusted Types blocked icons, allow "trusted-types iconavo"'],
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });
});
