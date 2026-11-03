import { describe, expect, it } from "vitest";
import { DEFAULT_NAME_FORMAT, formatName, NAME_FORMATS } from "./names";

describe("форматы имени (шаг 5 фазы 4)", () => {
  it("все форматы — как у Iconify", () => {
    expect(
      NAME_FORMATS.map((f) => formatName("material-symbols:home-outline", f)),
    ).toEqual([
      "material-symbols/home-outline",
      "material-symbols:home-outline",
      "MaterialSymbolsHomeOutline",
      "icon-[material-symbols--home-outline]",
      "i-material-symbols:home-outline",
      "i-material-symbols-home-outline",
      "home-outline",
      "material-symbols--home-outline",
    ]);
  });

  it("по умолчанию — набор/иконка", () => {
    expect(formatName("lucide:house", DEFAULT_NAME_FORMAT)).toBe(
      "lucide/house",
    );
  });

  it("цифры в имени компонента — как у Iconify: noto-v1:house → NotoV1House", () => {
    expect(formatName("noto-v1:house", "component")).toBe("NotoV1House");
    expect(formatName("tabler:number-1", "component")).toBe("TablerNumber1");
  });
});
