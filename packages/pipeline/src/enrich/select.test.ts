import type { SearchFile } from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import { applyEnrichment, type Enrichment } from "./apply.js";
import { selectIcons } from "./select.js";

const names = "abcdefghijkl".split("");
const lang = { description: "d", synonyms: ["1", "2", "3", "4", "5"] };
const value: Enrichment = { ru: lang, en: lang, promptVersion: 1 };
const search: SearchFile = {
  prefix: "demo",
  icons: Object.fromEntries([
    ...names.map((n) => [n, { fingerprint: `f-${n}`, tags: [] }]),
    ["a-filled", { fingerprint: "f-af", tags: [] }],
    ["c", { fingerprint: "f-c", tags: [], ...value }],
    ["d", { fingerprint: "f-d", tags: [], ...value }],
  ]),
};
const TABLER = ["", "-filled"];

describe("выбор иконок", () => {
  it("без лимита — все базовые без описаний", () => {
    const s = selectIcons(search, TABLER, "demo");
    expect(s.bases).toEqual(names);
    expect(s.enriched).toEqual(["c", "d"]);
    expect(s.sample).toEqual(names);
    expect(s.selected).toEqual(names.filter((n) => n !== "c" && n !== "d"));
  });

  it("с лимитом — постоянная выборка из N базовых; повторный запуск ничего не отправляет", () => {
    const first = selectIcons(search, TABLER, "demo", 5);
    expect(first.sample).toHaveLength(5);
    expect([...first.sample].sort()).toEqual(first.sample);
    expect(selectIcons(search, TABLER, "demo", 5).sample).toEqual(first.sample);
    // Выборка зависит от набора: у другого id другие иконки.
    expect(selectIcons(search, TABLER, "other", 5).sample).not.toEqual(
      first.sample,
    );
    const enriched = applyEnrichment(
      search,
      new Map(first.selected.map((n) => [n, value])),
    );
    const again = selectIcons(enriched, TABLER, "demo", 5);
    expect(again.sample).toEqual(first.sample);
    expect(again.selected).toEqual([]);
    // Больший лимит берёт следующие иконки той же выборки.
    const wider = selectIcons(enriched, TABLER, "demo", 7);
    expect(wider.sample.slice(0)).toEqual(expect.arrayContaining(first.sample));
    expect(wider.selected.length).toBeLessThanOrEqual(2);
  });

  it("лимит больше числа базовых — все базовые", () => {
    expect(selectIcons(search, TABLER, "demo", 100).sample).toEqual(names);
  });
});
