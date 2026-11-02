import { describe, expect, it } from "vitest";
import { CHECKS, catalogExpectOf, tagsVerdict } from "./check.js";

describe("ожидания сценария «Каталог»", () => {
  it("имена набора — без повторов, по кодам символов; категории — так же; цветные наборы", () => {
    const e = catalogExpectOf(
      {
        lucide: { palette: false },
        "fluent-emoji-flat": { palette: true },
        ph: {},
      },
      {
        categories: { arrows: ["arrow-up", "a-2", "arrow-up"], b: ["Z", "a"] },
        uncategorized: ["house", "a"],
      },
      "8d1ee623",
    );
    expect(e).toEqual({
      version: "8d1ee623",
      names: ["Z", "a", "a-2", "arrow-up", "house"],
      categories: { arrows: ["a-2", "arrow-up"], b: ["Z", "a"] },
      sets: 3,
      colorSets: 1,
    });
  });

  it("строки «Каталог» и «Поиск» — перед контрольным запуском", () => {
    const ids = CHECKS.map(([id]) => id);
    expect(ids.slice(-3)).toEqual(["catalog", "results", "canary"]);
  });
});

describe("метки кэша страниц (шаг 4 фазы 4, ADR-0039)", () => {
  const good = {
    "/": ["_N_T_/layout", "_N_T_/", "catalog"],
    "/sets": ["catalog"],
    "/ru/licenses": ["catalog"],
    "/lucide": ["_N_T_/lucide", "set-lucide"],
    "/ru/lucide": ["set-lucide"],
    "/lucide/house": ["_N_T_/lucide/house", "set-lucide"],
    "/ru/ph/house-bold": ["set-ph"],
  };

  it("общие — ровно catalog, набора и его иконок — ровно set-{набор}", () => {
    expect(tagsVerdict(good).ok).toBe(true);
  });

  it("лишняя метка, чужой набор или нет файла кэша — нет", () => {
    const icon = tagsVerdict({
      ...good,
      "/lucide/house": ["set-lucide", "catalog"],
    });
    expect(icon.ok).toBe(false);
    expect(icon.note).toContain("/lucide/house");
    expect(tagsVerdict({ ...good, "/": ["catalog", "set-lucide"] }).ok).toBe(
      false,
    );
    expect(tagsVerdict({ ...good, "/ru/lucide": ["set-ph"] }).ok).toBe(false);
    const { "/sets": _, ...noFile } = good;
    expect(tagsVerdict(noFile).note).toContain("/sets: нет файла кэша");
  });
});
