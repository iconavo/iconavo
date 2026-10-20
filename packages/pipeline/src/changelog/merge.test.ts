import { describe, expect, it } from "vitest";
import type { NormalizedIcon } from "../normalize/normalize.js";
import {
  type AuthorAlias,
  type FreshSet,
  hasChanges,
  type MergeResult,
  mergeHistory,
} from "./merge.js";
import {
  iconsFileOf,
  type SetState,
  sameState,
  stateOf,
  versionOf,
} from "./state.js";

const icon = (body: string): NormalizedIcon => ({
  body,
  width: 24,
  height: 24,
});
const SQUARE = icon(`<path d="M4 4h16v16H4z"/>`);
const CIRCLE = icon(`<circle cx="12" cy="12" r="8"/>`);
const DOT = icon(`<circle cx="12" cy="12" r="2"/>`);
/** Тело с ID: в ID стоит имя иконки (ADR-0014). */
const withIds = (name: string) =>
  icon(
    `<clipPath id="demo--${name}-0"><rect width="12" height="12"/></clipPath><path clip-path="url(#demo--${name}-0)" d="M0 0h24v24H0z"/>`,
  );

const fresh = (
  icons: Record<string, NormalizedIcon>,
  aliases: Record<string, string> = {},
): FreshSet => ({
  icons: new Map(Object.entries(icons)),
  aliases: new Map(Object.entries(aliases)),
});

/** Прошлая версия: иконка — рисунок или [рисунок, "скрыта"]. */
const before = (
  icons: Record<string, NormalizedIcon | [NormalizedIcon, "скрыта"]>,
  aliases: Record<string, string> = {},
): SetState => ({
  icons: new Map(
    Object.entries(icons).map(([name, v]) => [
      name,
      Array.isArray(v)
        ? { icon: v[0], hidden: true }
        : { icon: v, hidden: false },
    ]),
  ),
  aliases: new Map(Object.entries(aliases)),
});

/** Слияние; каждый сценарий заодно проверяет, что повторное слияние ничего не меняет. */
function merge(
  b: SetState | undefined,
  f: FreshSet,
  extra: AuthorAlias[] = [],
): MergeResult {
  const r = mergeHistory("demo", b, f, extra);
  expect(r.problems).toEqual([]);
  const again = mergeHistory("demo", r.state, f, extra);
  expect(sameState(again.state, r.state)).toBe(true);
  expect(hasChanges(again.changes)).toBe(false);
  expect(again.problems).toEqual([]);
  return r;
}

/** Итог по строке на имя: «a: иконка», «b: скрыта», «c → a». */
const summary = (s: SetState) =>
  [
    ...[...s.icons].map(([n, i]) => `${n}: ${i.hidden ? "скрыта" : "иконка"}`),
    ...[...s.aliases].map(([n, p]) => `${n} → ${p}`),
  ].sort();

/** Изменения без пустых списков. */
const listed = (r: MergeResult) =>
  Object.fromEntries(
    Object.entries({
      added: r.changes.added,
      changed: r.changes.changed,
      restored: r.changes.restored,
      hidden: r.changes.hidden,
      renamed: Object.fromEntries(r.changes.renamed),
      aliases: Object.fromEntries(r.changes.aliases),
    }).filter(([, v]) => Object.keys(v).length > 0),
  );

describe("слияние с прошлой версией", () => {
  it("без прошлой версии — только свежая сборка, списков нет", () => {
    const r = merge(undefined, fresh({ a: SQUARE, b: CIRCLE }, { "a-x": "a" }));
    expect(summary(r.state)).toEqual(["a-x → a", "a: иконка", "b: иконка"]);
    expect(hasChanges(r.changes)).toBe(false);
  });

  it("без изменений — изменений нет", () => {
    const r = merge(before({ a: SQUARE }), fresh({ a: SQUARE }));
    expect(listed(r)).toEqual({});
  });

  it("добавлена и изменена", () => {
    const r = merge(
      before({ a: SQUARE, b: CIRCLE }),
      fresh({ a: SQUARE, b: DOT, c: CIRCLE }),
    );
    expect(listed(r)).toEqual({ added: ["c"], changed: ["b"] });
  });

  it("удалена у автора — скрыта со старым рисунком, её алиасы ведут на неё", () => {
    const r = merge(
      before({ a: SQUARE, b: CIRCLE }, { "b-old": "b" }),
      fresh({ a: SQUARE }),
    );
    expect(summary(r.state)).toEqual(["a: иконка", "b-old → b", "b: скрыта"]);
    expect(r.state.icons.get("b")?.icon).toEqual(CIRCLE);
    expect(listed(r)).toEqual({ hidden: ["b"] });
  });

  it("переименована: тот же рисунок под новым именем, ID с именем иконки не мешают", () => {
    const r = merge(
      before({ a: SQUARE, clip: withIds("clip") }),
      fresh({ a: SQUARE, "clip-new": withIds("clip-new") }),
    );
    expect(summary(r.state)).toEqual([
      "a: иконка",
      "clip → clip-new",
      "clip-new: иконка",
    ]);
    // Новое имя показано среди переименований, а не среди добавленных.
    expect(listed(r)).toEqual({ renamed: { clip: "clip-new" } });
  });

  it("несколько иконок с тем же рисунком: сначала новые имена, затем по кодам символов", () => {
    const r = merge(
      before({ old: CIRCLE, keep: CIRCLE }),
      fresh({ keep: CIRCLE, "new-b": CIRCLE, "new-a": CIRCLE }),
    );
    expect(r.state.aliases.get("old")).toBe("new-a");
    expect(listed(r)).toEqual({ added: ["new-b"], renamed: { old: "new-a" } });
    // Дубль, который автор убрал, становится алиасом оставшейся иконки с тем же рисунком.
    const dup = merge(before({ a: SQUARE, dup: SQUARE }), fresh({ a: SQUARE }));
    expect(listed(dup)).toEqual({ renamed: { dup: "a" } });
  });

  it("скрытая вернулась; скрытая нашлась под новым именем", () => {
    const r = merge(
      before({ a: SQUARE, back: [CIRCLE, "скрыта"], gone: [DOT, "скрыта"] }),
      fresh({ a: SQUARE, back: CIRCLE, found: DOT }),
    );
    expect(summary(r.state)).toEqual([
      "a: иконка",
      "back: иконка",
      "found: иконка",
      "gone → found",
    ]);
    expect(listed(r)).toEqual({
      restored: ["back"],
      renamed: { gone: "found" },
    });
  });

  it("скрытая остаётся скрытой и в списки больше не попадает", () => {
    const r = merge(
      before({ a: SQUARE, gone: [DOT, "скрыта"] }),
      fresh({ a: SQUARE }),
    );
    expect(summary(r.state)).toEqual(["a: иконка", "gone: скрыта"]);
    expect(listed(r)).toEqual({});
  });

  it("алиас переименованной иконки ведёт на новое имя: цепочек нет", () => {
    const r = merge(
      before({ old: SQUARE }, { "old-sharp": "old" }),
      fresh({ new: SQUARE }),
    );
    expect(summary(r.state)).toEqual([
      "new: иконка",
      "old → new",
      "old-sharp → new",
    ]);
  });

  describe("варианты Material Symbols", () => {
    it("алиас варианта стал иконкой: с тем же рисунком — ничего, с другим — изменена", () => {
      const b = before({ x: SQUARE }, { "x-sharp": "x" });
      expect(listed(merge(b, fresh({ x: SQUARE, "x-sharp": SQUARE })))).toEqual(
        {},
      );
      expect(listed(merge(b, fresh({ x: SQUARE, "x-sharp": CIRCLE })))).toEqual(
        { changed: ["x-sharp"] },
      );
    });

    it("иконка стала алиасом варианта с другим рисунком — изменена", () => {
      const r = merge(
        before({ x: SQUARE, "x-sharp": CIRCLE }),
        fresh({ x: SQUARE }, { "x-sharp": "x" }),
      );
      expect(listed(r)).toEqual({ changed: ["x-sharp"] });
    });

    it("основной вариант удалён, младший с тем же рисунком остался — основной стал его алиасом", () => {
      const r = merge(
        before({ x: SQUARE }, { "x-sharp": "x" }),
        fresh({ "x-sharp": SQUARE }),
      );
      expect(summary(r.state)).toEqual(["x → x-sharp", "x-sharp: иконка"]);
      expect(listed(r)).toEqual({ renamed: { x: "x-sharp" } });
    });

    it("алиас варианта пропал из источника — переносится без записи в журнал", () => {
      const r = merge(
        before({ x: SQUARE }, { "x-sharp": "x" }),
        fresh({ x: SQUARE }),
      );
      expect(summary(r.state)).toEqual(["x-sharp → x", "x: иконка"]);
      expect(listed(r)).toEqual({});
    });
  });

  describe("прежние имена от автора", () => {
    it("становятся алиасами; у известной иконки — в списке новых алиасов", () => {
      const extra = [{ name: "a-old", parent: "a" }];
      const r = merge(before({ a: SQUARE }), fresh({ a: SQUARE }), extra);
      expect(summary(r.state)).toEqual(["a-old → a", "a: иконка"]);
      expect(listed(r)).toEqual({ aliases: { "a-old": "a" } });
      // Без прошлой версии — алиас есть, списков нет.
      const first = merge(undefined, fresh({ a: SQUARE }), extra);
      expect(first.state.aliases.get("a-old")).toBe("a");
      expect(hasChanges(first.changes)).toBe(false);
    });

    it("алиас новой иконки отдельно не перечисляется", () => {
      const r = merge(before({ a: SQUARE }), fresh({ a: SQUARE, b: CIRCLE }), [
        { name: "b-old", parent: "b" },
      ]);
      expect(listed(r)).toEqual({ added: ["b"] });
    });

    it("родитель — алиас варианта: алиас ведёт на иконку", () => {
      const r = merge(undefined, fresh({ a: SQUARE }, { "a-sharp": "a" }), [
        { name: "old-sharp", parent: "a-sharp" },
      ]);
      expect(r.state.aliases.get("old-sharp")).toBe("a");
    });

    it("занятое, неверное и без иконки — пропуск с причиной; то же переименование — не пропуск", () => {
      const r = merge(
        before({ a: SQUARE, old: CIRCLE }, { x: "a" }),
        fresh({ a: SQUARE, b: DOT, new: CIRCLE }),
        [
          { name: "b", parent: "a" },
          { name: "x", parent: "b" },
          { name: "Bad_Name", parent: "a" },
          { name: "lost", parent: "nope" },
          { name: "old", parent: "new" },
        ],
      );
      expect(r.skipped).toEqual([
        {
          name: "Bad_Name",
          parent: "a",
          reason: "имя не по правилу ADR-0001",
        },
        { name: "b", parent: "a", reason: "имя занято иконкой" },
        { name: "lost", parent: "nope", reason: "нет иконки nope" },
        { name: "x", parent: "b", reason: "имя уже ведёт на a" },
      ]);
      expect(r.state.aliases.get("old")).toBe("new");
    });

    it("прошлая версия старше: старое имя с другим рисунком остаётся скрытым, как у Iconify", () => {
      const r = merge(before({ x: SQUARE }), fresh({ y: CIRCLE }), [
        { name: "x", parent: "y" },
      ]);
      expect(summary(r.state)).toEqual(["x: скрыта", "y: иконка"]);
      expect(listed(r)).toEqual({ added: ["y"], hidden: ["x"] });
      expect(r.skipped.map((s) => s.reason)).toEqual(["имя занято иконкой"]);
    });
  });
});

describe("состояние и версия набора", () => {
  const ICONS = {
    prefix: "demo",
    width: 24,
    height: 24,
    icons: {
      a: { body: "<g/>" },
      b: { body: "<path/>", height: 25 },
      old: { body: "<rect/>", hidden: true },
    },
    aliases: { "a-x": { parent: "a" }, "a-y": { parent: "a-x" } },
  };

  it("из icons.json: скрытые с пометкой, цепочки алиасов развёрнуты", () => {
    const s = stateOf(ICONS);
    expect(summary(s)).toEqual([
      "a-x → a",
      "a-y → a",
      "a: иконка",
      "b: иконка",
      "old: скрыта",
    ]);
    expect(s.icons.get("b")?.icon).toEqual({
      body: "<path/>",
      width: 24,
      height: 25,
    });
    expect(() =>
      stateOf({ ...ICONS, aliases: { z: { parent: "nope" } } }),
    ).toThrow(/алиас «z» не ведёт ни к одной иконке/);
  });

  it("icons.json из состояния: размер набора общий, hidden только у скрытых, lastModified по запросу", () => {
    const s = stateOf(ICONS);
    expect(iconsFileOf("demo", 24, s, 1760000000)).toEqual({
      prefix: "demo",
      width: 24,
      height: 24,
      lastModified: 1760000000,
      icons: {
        a: { body: "<g/>" },
        b: { body: "<path/>", height: 25 },
        old: { body: "<rect/>", hidden: true },
      },
      aliases: { "a-x": { parent: "a" }, "a-y": { parent: "a" } },
    });
    expect(
      iconsFileOf("demo", 24, stateOf({ ...ICONS, aliases: {} })),
    ).not.toHaveProperty("aliases");
  });

  it("версия: 8 символов; меняется от скрытия и алиаса, не зависит от lastModified и порядка", () => {
    const version = (s: SetState, time?: number) =>
      versionOf(iconsFileOf("demo", 24, s, time));
    const base = before({ a: SQUARE, b: CIRCLE });
    const v = version(base);
    expect(v).toMatch(/^[0-9a-f]{8}$/);
    expect(version(base, 1)).toBe(v);
    expect(version(before({ b: CIRCLE, a: SQUARE }))).toBe(v);
    expect(version(before({ a: SQUARE, b: [CIRCLE, "скрыта"] }))).not.toBe(v);
    expect(version(before({ a: SQUARE, b: CIRCLE }, { c: "a" }))).not.toBe(v);
  });
});
