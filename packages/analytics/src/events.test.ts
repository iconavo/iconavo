import { describe, expect, it } from "vitest";
import {
  BATCH_VERSION,
  batchBody,
  checkEvent,
  EVENT_NAMES,
  MAX_EVENTS,
  parseBatch,
} from "./events.js";

const QUERY = {
  name: "query",
  q: "house",
  results: 42,
  semantic: true,
  pages: 1,
  first: true,
  copied: false,
  downloaded: false,
};

describe("события по списку", () => {
  it("каждое событие из списка проходит с полями своего вида", () => {
    const events = [
      { name: "page", section: "search" },
      {
        ...QUERY,
        style: "outline",
        sets: ["lucide", "material-symbols"],
        licenses: ["MIT", "Apache-2.0"],
        position: 3,
      },
      { name: "success", queries: 2, seconds: 37 },
      {
        name: "copy",
        what: "svg",
        icon: "lucide:house",
        format: "unocssDash",
        size: 24,
        entry: 41,
      },
      { name: "download", format: "zip", count: 12 },
      { name: "open", from: "search", icon: "ph:house-bold" },
      { name: "style", style: "filled", where: "filter" },
    ];
    expect(events.map((e) => e.name).sort()).toEqual([...EVENT_NAMES].sort());
    for (const raw of events) {
      expect(checkEvent(raw)).toEqual({ ok: true, event: raw });
    }
  });

  it("текст запроса — как у поиска: строчные, ё → е, дефисы — пробелы", () => {
    expect(checkEvent({ ...QUERY, q: "  Ёлка-Shopping_Cart " })).toEqual({
      ok: true,
      event: { ...QUERY, q: "елка shopping cart" },
    });
  });

  it.each([
    [{ ...QUERY, q: "" }, "event:query:q"],
    [{ ...QUERY, q: "   " }, "event:query:q"],
    [{ ...QUERY, q: "a".repeat(101) }, "event:query:q"],
    [{ ...QUERY, results: -1 }, "event:query:results"],
    [{ ...QUERY, results: 1.5 }, "event:query:results"],
    [{ ...QUERY, semantic: "yes" }, "event:query:semantic"],
    [{ ...QUERY, style: "bold" }, "event:query:style"],
    [{ ...QUERY, sets: [] }, "event:query:sets"],
    [{ ...QUERY, sets: ["Lucide"] }, "event:query:sets"],
    [{ ...QUERY, position: 0 }, "event:query:position"],
    [{ ...QUERY, position: null }, "event:query:position"],
    [{ ...QUERY, ip: "1.2.3.4" }, "event:query:extra"],
    [{ ...QUERY, country: "DE" }, "event:query:extra"],
    [{ name: "query", q: "house" }, "event:query:results"],
    [{ name: "copy", what: "pdf" }, "event:copy:what"],
    [{ name: "copy", what: "svg", icon: "house" }, "event:copy:icon"],
    [{ name: "copy", what: "svg", icon: "lucide:House" }, "event:copy:icon"],
    [{ name: "download", format: "svg", size: 5000 }, "event:download:size"],
    [{ name: "open", from: "search" }, "event:open:icon"],
    [{ name: "page", section: "/lucide/house" }, "event:page:section"],
    [{ name: "click" }, "event:name"],
    [{ section: "home" }, "event:name"],
    ["page", "event:shape"],
    [null, "event:shape"],
    [[{ name: "page", section: "home" }], "event:shape"],
  ])("%j — отказ %s", (raw, reason) => {
    expect(checkEvent(raw)).toEqual({ ok: false, reason });
  });
});

describe("пачка", () => {
  const page = { name: "page", section: "home" } as const;

  it("тело сайта читается обратно", () => {
    const parsed = parseBatch(JSON.parse(batchBody("ru", [page])));
    expect(parsed).toEqual({
      ok: true,
      lang: "ru",
      events: [page],
      rejected: [],
    });
  });

  it("неверные события отбрасываются по одному, верные остаются", () => {
    expect(
      parseBatch({
        v: BATCH_VERSION,
        lang: "en",
        events: [page, { name: "page", section: "x" }, { name: "x" }],
      }),
    ).toEqual({
      ok: true,
      lang: "en",
      events: [page],
      rejected: ["event:page:section", "event:name"],
    });
  });

  it.each([
    ["не объект", [page]],
    ["другая версия", { v: 2, lang: "en", events: [page] }],
    ["без языка", { v: 1, events: [page] }],
    ["чужой язык", { v: 1, lang: "de", events: [page] }],
    ["пустая", { v: 1, lang: "en", events: [] }],
    [
      "длиннее списка",
      { v: 1, lang: "en", events: Array(MAX_EVENTS + 1).fill(page) },
    ],
    ["лишнее поле", { v: 1, lang: "en", events: [page], session: "abc" }],
  ])("%s — отказ целиком", (_, raw) => {
    expect(parseBatch(raw)).toEqual({ ok: false });
  });
});
