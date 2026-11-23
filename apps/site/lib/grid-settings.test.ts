import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID,
  GRID_KEY,
  GRID_SCRIPT,
  iconSizeOf,
  isIconSize,
  keptPage,
  PER_PAGE_DESKTOP,
  PER_PAGE_PHONE,
  parseGridSettings,
  perPageOf,
  serializeGridSettings,
  VIEW_ICON_SIZE,
} from "./grid-settings";

// Настройки сетки (ADR-0054): разбор хранилища, умолчания, номер страницы при смене числа и скрипт в
// <head>, который ставит вид и размер до первой отрисовки.

describe("настройки сетки", () => {
  it("из хранилища — только верные поля, остальное по умолчанию", () => {
    expect(parseGridSettings(null)).toEqual(DEFAULT_GRID);
    expect(parseGridSettings("не json")).toEqual(DEFAULT_GRID);
    expect(parseGridSettings("[1]")).toEqual(DEFAULT_GRID);
    expect(
      parseGridSettings('{"view":"list","size":48,"perPage":144}'),
    ).toEqual({ view: "list", size: 48, perPage: 144 });
    expect(
      parseGridSettings('{"view":"huge","size":50,"perPage":100}'),
    ).toEqual({ view: "grid" });
    expect(parseGridSettings('{"size":12}')).toEqual({ view: "grid" });
    expect(parseGridSettings('{"size":100}')).toEqual({ view: "grid" });
  });

  it("в хранилище — только отличия от умолчаний; всё по умолчанию — пусто", () => {
    expect(serializeGridSettings(DEFAULT_GRID)).toBe("");
    expect(serializeGridSettings({ view: "large" })).toBe('{"view":"large"}');
    const s = { view: "list", size: 32, perPage: 192 } as const;
    expect(parseGridSettings(serializeGridSettings(s))).toEqual(s);
  });

  it("размер иконки — 16–96 px шагом 4; по умолчанию у вида — 24, у крупной сетки — 48", () => {
    expect([16, 20, 24, 48, 96].every(isIconSize)).toBe(true);
    expect([12, 18, 97, 100, 24.5, "24"].some(isIconSize)).toBe(false);
    expect(VIEW_ICON_SIZE).toEqual({ grid: 24, large: 48, list: 24 });
    expect(iconSizeOf({ view: "large" })).toBe(48);
    expect(iconSizeOf({ view: "large", size: 32 })).toBe(32);
    expect(iconSizeOf({ view: "list" })).toBe(24);
  });

  it("иконок на странице по умолчанию — 48 на телефоне и 96 на компьютере (заметки макета)", () => {
    expect([PER_PAGE_PHONE, PER_PAGE_DESKTOP]).toEqual([48, 96]);
    expect(perPageOf(DEFAULT_GRID, true)).toBe(48);
    expect(perPageOf(DEFAULT_GRID, false)).toBe(96);
    expect(perPageOf({ view: "grid", perPage: 144 }, true)).toBe(144);
  });

  it("после смены числа на странице её первая иконка остаётся на экране", () => {
    // Страница 3 по 98: первая иконка — 197-я; по 49 она на странице 5, по 196 — на 2-й.
    expect(keptPage(3, 98, 49)).toBe(5);
    expect(keptPage(3, 98, 196)).toBe(2);
    expect(keptPage(1, 98, 196)).toBe(1);
    expect(keptPage(2, 48, 96)).toBe(1);
  });
});

describe("скрипт в <head>", () => {
  /** Выполнить скрипт с хранилищем и <html>-подделкой. */
  function run(stored: string | null) {
    const set = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: { setProperty: (k: string, v: string) => set.set(k, v) },
    };
    new Function("localStorage", "document", GRID_SCRIPT)(
      { getItem: (k: string) => (k === GRID_KEY ? stored : null) },
      { documentElement: root },
    );
    return { view: root.dataset.gridView, size: set.get("--tile-icon") };
  }

  it("ставит вид и размер, как parseGridSettings; чужое значение не меняет страницу", () => {
    expect(run(null)).toEqual({ view: undefined, size: undefined });
    expect(run('{"view":"list","size":48}')).toEqual({
      view: "list",
      size: "48px",
    });
    expect(run('{"view":"grid"}')).toEqual({
      view: undefined,
      size: undefined,
    });
    expect(run('{"view":"huge","size":50}')).toEqual({
      view: undefined,
      size: undefined,
    });
    expect(run("не json")).toEqual({ view: undefined, size: undefined });
    for (const raw of ['{"size":12}', '{"size":100}', '{"size":"48"}']) {
      expect(run(raw).size).toBeUndefined();
      expect(parseGridSettings(raw).size).toBeUndefined();
    }
  });
});
