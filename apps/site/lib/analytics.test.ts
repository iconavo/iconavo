import { parseBatch, type SiteEvent } from "@iconavo-ui/analytics";
import { describe, expect, it } from "vitest";
import {
  createTracker,
  FLUSH_MS,
  privacyAllows,
  QUERY_SETTLE_MS,
  type SearchView,
  sectionOf,
} from "./analytics";

function setup(o: { enabled?: boolean } = {}) {
  let time = 1_000_000;
  const sent: SiteEvent[][] = [];
  const bodies: string[] = [];
  const dispatched: SiteEvent[] = [];
  const timers: number[] = [];
  const tracker = createTracker({
    now: () => time,
    entry: time,
    send: (body) => {
      bodies.push(body);
      const parsed = parseBatch(JSON.parse(body));
      if (!parsed.ok) throw new Error(`пачка не по списку: ${body}`);
      expect(parsed.rejected).toEqual([]);
      sent.push(parsed.events);
    },
    enabled: () => o.enabled ?? true,
    lang: () => "ru",
    dispatch: (event) => dispatched.push(event),
    every: (ms) => timers.push(ms),
  });
  return {
    tracker,
    sent,
    bodies,
    dispatched,
    timers,
    /** Все отправленные события подряд. */
    events: () => sent.flat(),
    wait: (ms: number) => {
      time += ms;
    },
  };
}

const view = (q: string, over: Partial<SearchView> = {}): SearchView => ({
  q,
  sets: [],
  licenses: [],
  page: 1,
  results: 24,
  semantic: true,
  ...over,
});

describe("события и пачки", () => {
  it("копятся и уходят пачкой с языком сайта; таймер — при первом событии", () => {
    const t = setup();
    t.tracker.pageViewed("home");
    t.tracker.pageViewed("search");
    expect(t.timers).toEqual([FLUSH_MS]);
    expect(t.sent).toEqual([]);
    t.tracker.flush();
    expect(t.events()).toEqual([
      { name: "page", section: "home" },
      { name: "page", section: "search" },
    ]);
    expect(JSON.parse(t.bodies[0] ?? "")).toMatchObject({ v: 1, lang: "ru" });
    t.tracker.flush();
    expect(t.sent).toHaveLength(1);
  });

  it("больше 50 событий — несколькими пачками", () => {
    const t = setup();
    for (let i = 0; i < 120; i++) t.tracker.pageViewed("set");
    t.tracker.flush();
    expect(t.sent.map((b) => b.length)).toEqual([50, 50, 20]);
  });

  it("нельзя отправлять — события не копятся, а метки для проверки сайта есть", () => {
    const t = setup({ enabled: false });
    t.tracker.pageViewed("home");
    t.tracker.track({ name: "copy", what: "svg", icon: "lucide:house" });
    t.tracker.hidden();
    expect(t.sent).toEqual([]);
    expect(t.timers).toEqual([]);
    expect(t.dispatched).toEqual([
      { name: "copy", what: "svg", icon: "lucide:house" },
    ]);
  });

  it("первое копирование или скачивание во вкладке — с секундами от входа на сайт", () => {
    const t = setup();
    t.wait(41_400);
    t.tracker.track({ name: "download", format: "svg", icon: "lucide:house" });
    t.tracker.track({ name: "copy", what: "name", icon: "lucide:house" });
    t.tracker.flush();
    expect(t.events()).toEqual([
      { name: "download", format: "svg", icon: "lucide:house", entry: 41 },
      { name: "copy", what: "name", icon: "lucide:house" },
    ]);
  });
});

describe("запросы", () => {
  it("буквы набора не считаются: запрос — то, что простояло 2 секунды", () => {
    const t = setup();
    t.tracker.searchShown(view("hou"));
    t.wait(300);
    t.tracker.searchShown(view("hous"));
    t.wait(QUERY_SETTLE_MS - 1);
    t.tracker.searchShown(view("house"));
    t.wait(QUERY_SETTLE_MS);
    t.tracker.hidden();
    expect(t.events()).toEqual([
      {
        name: "query",
        q: "house",
        results: 24,
        semantic: true,
        pages: 1,
        first: true,
        copied: false,
        downloaded: false,
      },
    ]);
  });

  it("действие с выдачей засчитывает запрос сразу: место первой открытой иконки", () => {
    const t = setup();
    t.tracker.searchShown(view("Ёлка"));
    t.wait(500);
    t.tracker.resultOpened("lucide:tree-pine", 3);
    t.tracker.resultOpened("lucide:trees", 7);
    t.wait(100);
    t.tracker.searchShown(view("snow"));
    t.tracker.searchLeft();
    t.tracker.flush();
    expect(t.events()).toEqual([
      { name: "open", from: "search", icon: "lucide:tree-pine" },
      { name: "open", from: "search", icon: "lucide:trees" },
      {
        name: "query",
        q: "елка",
        results: 24,
        semantic: true,
        pages: 1,
        first: true,
        position: 3,
        copied: false,
        downloaded: false,
      },
    ]);
  });

  it("фильтры — часть запроса; другая страница — действие, страницы считаются", () => {
    const t = setup();
    t.tracker.searchShown(view("home"));
    t.wait(100);
    t.tracker.searchShown(view("home", { page: 2, results: 10 }));
    t.tracker.searchShown(view("home", { page: 3, results: 2 }));
    t.tracker.searchShown(
      view("home", { style: "filled", sets: ["lucide"], licenses: ["MIT"] }),
    );
    t.wait(QUERY_SETTLE_MS);
    t.tracker.hidden();
    expect(t.events()).toEqual([
      {
        name: "query",
        q: "home",
        results: 24,
        semantic: true,
        pages: 3,
        first: true,
        copied: false,
        downloaded: false,
      },
      {
        name: "query",
        q: "home",
        results: 24,
        semantic: true,
        style: "filled",
        sets: ["lucide"],
        licenses: ["MIT"],
        pages: 1,
        first: false,
        copied: false,
        downloaded: false,
      },
    ]);
  });

  it("выдача по словам дополнилась смыслом — тот же запрос, отметка «по смыслу»", () => {
    const t = setup();
    t.tracker.searchShown(view("cat", { semantic: false, results: 3 }));
    t.wait(600);
    t.tracker.searchShown(view("cat", { semantic: true, results: 24 }));
    t.wait(QUERY_SETTLE_MS);
    t.tracker.searchShown(view(""));
    t.tracker.flush();
    expect(t.events()).toMatchObject([
      { name: "query", q: "cat", semantic: true, results: 24, pages: 1 },
    ]);
  });
});

describe("поисковая сессия и успех", () => {
  it("копирование после поиска — успех: сколько запросов и секунд с первого", () => {
    const t = setup();
    t.tracker.searchShown(view("hause"));
    t.wait(5_000);
    t.tracker.searchShown(view("house"));
    t.wait(10_000);
    t.tracker.resultOpened("lucide:house", 1);
    t.tracker.track({ name: "copy", what: "svg", icon: "lucide:house" });
    t.tracker.hidden();
    expect(t.events()).toEqual([
      {
        name: "query",
        q: "hause",
        results: 24,
        semantic: true,
        pages: 1,
        first: true,
        copied: false,
        downloaded: false,
      },
      { name: "open", from: "search", icon: "lucide:house" },
      { name: "success", queries: 2, seconds: 15 },
      { name: "copy", what: "svg", icon: "lucide:house", entry: 15 },
      {
        name: "query",
        q: "house",
        results: 24,
        semantic: true,
        pages: 1,
        first: false,
        position: 1,
        copied: true,
        downloaded: false,
      },
    ]);
  });

  it("успех — один на сессию; следующий запрос начинает новую", () => {
    const t = setup();
    t.tracker.searchShown(view("a1"));
    t.tracker.track({ name: "download", format: "png", icon: "lucide:house" });
    t.tracker.track({ name: "copy", what: "svg", icon: "lucide:house" });
    t.tracker.searchShown(view("b2"));
    t.tracker.track({ name: "copy", what: "svg", icon: "lucide:heart" });
    t.tracker.hidden();
    const events = t.events();
    expect(events.filter((e) => e.name === "success")).toEqual([
      { name: "success", queries: 1, seconds: 0 },
      { name: "success", queries: 1, seconds: 0 },
    ]);
    expect(
      events.flatMap((e) =>
        e.name === "query" ? [[e.q, e.first, e.copied, e.downloaded]] : [],
      ),
    ).toEqual([
      ["a1", true, true, true],
      ["b2", true, true, false],
    ]);
  });

  it("копирование без поиска — не успех; после поиска на другой странице — успех", () => {
    const t = setup();
    t.tracker.track({ name: "copy", what: "svg", icon: "lucide:house" });
    t.tracker.searchShown(view("arrow"));
    t.wait(QUERY_SETTLE_MS);
    t.tracker.searchLeft();
    t.wait(30_000);
    t.tracker.track({ name: "copy", what: "react", icon: "ph:arrow-up" });
    t.tracker.flush();
    expect(t.events().map((e) => e.name)).toEqual([
      "copy",
      "query",
      "success",
      "copy",
    ]);
    expect(t.events()[2]).toEqual({ name: "success", queries: 1, seconds: 32 });
  });
});

describe("открытие иконки и стили", () => {
  it("страница иконки: первая во вкладке — прямая ссылка, после перехода — «other», отмеченная — своя", () => {
    const t = setup();
    t.tracker.pageViewed("icon");
    t.tracker.iconPageOpened("lucide:house");
    t.tracker.pageViewed("icon");
    t.tracker.iconPageOpened("lucide:heart");
    t.tracker.markSource("similar");
    t.tracker.pageViewed("icon");
    t.tracker.iconPageOpened("lucide:star");
    t.tracker.iconOpened("ph:house", "set");
    t.tracker.styleChanged("filled", "filter");
    t.tracker.flush();
    expect(t.events().filter((e) => e.name !== "page")).toEqual([
      { name: "open", from: "link", icon: "lucide:house" },
      { name: "open", from: "other", icon: "lucide:heart" },
      { name: "open", from: "similar", icon: "lucide:star" },
      { name: "open", from: "set", icon: "ph:house" },
      { name: "style", style: "filled", where: "filter" },
    ]);
  });
});

describe("раздел страницы и сигналы приватности", () => {
  it.each([
    ["/", "home"],
    ["/ru", "home"],
    ["/search", "search"],
    ["/ru/search", "search"],
    ["/sets", "sets"],
    ["/lucide", "set"],
    ["/ru/material-symbols", "set"],
    ["/lucide/house", "icon"],
    ["/ru/ph/house-bold", "icon"],
    ["/docs", "docs"],
    ["/docs/reference", "docs"],
    ["/changelog", "changelog"],
    ["/licenses", "licenses"],
    ["/lucide/house/extra", "other"],
    ["/Lucide", "other"],
  ] as const)("%s → %s", (path, section) => {
    expect(sectionOf(path)).toBe(section);
  });

  it.each([
    [{}, true],
    [{ doNotTrack: "0" }, true],
    [{ doNotTrack: null, globalPrivacyControl: false }, true],
    [{ doNotTrack: "1" }, false],
    [{ globalPrivacyControl: true }, false],
  ])("%j — отправлять: %s", (nav, allowed) => {
    expect(privacyAllows(nav)).toBe(allowed);
  });
});
