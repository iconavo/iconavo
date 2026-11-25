import { describe, expect, it } from "vitest";
import { touchesKey } from "./storage-event";

describe("событие storage (ревизия фазы 5, С-28)", () => {
  it("свой ключ и очистка всего хранилища — касаются, чужой ключ — нет", () => {
    expect(touchesKey("iconavo-bag", "iconavo-bag")).toBe(true);
    expect(touchesKey(null, "iconavo-bag")).toBe(true);
    expect(touchesKey("iconavo-grid", "iconavo-bag")).toBe(false);
  });
});
