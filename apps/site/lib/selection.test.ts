import { describe, expect, it } from "vitest";
import { SELECT_LIMIT, toggleSelected } from "./selection";

describe("выделение иконок в сетке (редизайн, шаг 5)", () => {
  it("выбирает, снимает выбор и держит порядок выбора", () => {
    let list: readonly string[] = [];
    ({ list } = toggleSelected(list, "lucide:house"));
    ({ list } = toggleSelected(list, "ph:house"));
    expect(list).toEqual(["lucide:house", "ph:house"]);
    const off = toggleSelected(list, "lucide:house");
    expect(off).toEqual({ list: ["ph:house"], change: "removed" });
  });

  it("больше 100 не выбирается, снять выбор можно", () => {
    const full = Array.from({ length: SELECT_LIMIT }, (_, i) => `lucide:i${i}`);
    expect(toggleSelected(full, "lucide:extra")).toEqual({
      list: full,
      change: "full",
    });
    expect(toggleSelected(full, "lucide:i0").list).toHaveLength(
      SELECT_LIMIT - 1,
    );
  });
});
