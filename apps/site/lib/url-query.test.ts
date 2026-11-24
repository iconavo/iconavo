import { describe, expect, it } from "vitest";
import { keepsPanelMarker } from "./url-query";

const q = (text: string) => new URLSearchParams(text);

describe("пометка панели при замене записи истории (ревизия фазы 5, С-5)", () => {
  it("сменилась только иконка панели — пометка остаётся: закрытие уходит назад", () => {
    expect(keepsPanelMarker(q("icon=lucide:a"), q("icon=lucide:b"))).toBe(true);
    expect(
      keepsPanelMarker(q("page=2&icon=lucide:a"), q("icon=lucide:b&page=2")),
    ).toBe(true);
  });

  it("набрали поиск по набору или сменили фильтр при открытой панели — пометки нет", () => {
    expect(
      keepsPanelMarker(q("icon=lucide:a"), q("icon=lucide:a&q=home")),
    ).toBe(false);
    expect(
      keepsPanelMarker(q("icon=lucide:a&style=fill"), q("icon=lucide:a")),
    ).toBe(false);
  });
});
