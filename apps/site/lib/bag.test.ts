import { describe, expect, it } from "vitest";
import { BAG_LIMIT, parseBag, toggled } from "./bag";

describe("сумка (шаг 5 фазы 4)", () => {
  it("из хранилища — только имена по правилу, без повторов, не больше лимита", () => {
    expect(
      parseBag(
        JSON.stringify(["lucide:house", "lucide:house", "nope", 3, "ph:x"]),
      ),
    ).toEqual(["lucide:house", "ph:x"]);
    expect(parseBag(null)).toEqual([]);
    expect(parseBag("{")).toEqual([]);
    expect(parseBag('{"a":1}')).toEqual([]);
    const many = Array.from({ length: BAG_LIMIT + 5 }, (_, i) => `set:i${i}`);
    expect(parseBag(JSON.stringify(many))).toHaveLength(BAG_LIMIT);
  });

  it("положить, убрать; полная сумка новую не берёт", () => {
    const one = toggled([], "lucide:house");
    expect(one).toEqual({ bag: ["lucide:house"], change: "added" });
    expect(toggled(one.bag, "ph:x").bag).toEqual(["lucide:house", "ph:x"]);
    expect(toggled(["lucide:house", "ph:x"], "lucide:house")).toEqual({
      bag: ["ph:x"],
      change: "removed",
    });
    const full = Array.from({ length: BAG_LIMIT }, (_, i) => `set:i${i}`);
    expect(toggled(full, "lucide:house").change).toBe("full");
    expect(toggled(full, "set:i0").change).toBe("removed");
  });
});
