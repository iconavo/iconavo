import { describe, expect, it } from "vitest";
import {
  BAG_LIMIT,
  MISSING_SHOWN,
  missingMessage,
  parseBag,
  restored,
  toggled,
} from "./bag";
import { DICTIONARIES } from "./i18n";

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

  it("Undo после Clear: прежний порядок, за ним положенное после, без повторов, не больше лимита", () => {
    expect(restored([], ["lucide:house", "ph:x"])).toEqual([
      "lucide:house",
      "ph:x",
    ]);
    expect(restored(["ph:y", "ph:x"], ["lucide:house", "ph:x"])).toEqual([
      "lucide:house",
      "ph:x",
      "ph:y",
    ]);
    const full = Array.from({ length: BAG_LIMIT }, (_, i) => `set:i${i}`);
    expect(restored(["lucide:house"], full)).toEqual(full);
  });

  it("сообщение о не вошедших в файл: всё вошло, часть, ничего (ревизия фазы 5, С-11)", () => {
    const en = DICTIONARIES.en;
    expect(missingMessage(en, [], false)).toBeUndefined();
    expect(missingMessage(en, ["lucide:house", "ph:x"], false)).toBe(
      "Not in the file — didn't load: lucide:house, ph:x.",
    );
    expect(missingMessage(en, ["lucide:house"], true)).toBe(
      "Icons didn't load. Try again.",
    );
    const many = Array.from({ length: MISSING_SHOWN + 3 }, (_, i) => `s:i${i}`);
    expect(missingMessage(DICTIONARIES.ru, many, false)).toBe(
      "Не вошли в файл — не загрузились: s:i0, s:i1, s:i2, s:i3, s:i4 и ещё 3.",
    );
  });
});
