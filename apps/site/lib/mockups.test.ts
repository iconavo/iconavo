import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mockupLabel,
  neighbourCandidates,
  pickNeighbours,
  SLOT_LABELS,
  styleSuffix,
} from "./mockups";

const root = join(import.meta.dirname, "..", "..", "..");

describe("мокапы страницы иконки (шаг 4 фазы 4)", () => {
  it("суффикс стиля — то, чем имя длиннее карточки", () => {
    expect(styleSuffix("ph:house-fill", "ph:house")).toBe("-fill");
    expect(
      styleSuffix(
        "material-symbols:home-outline-rounded",
        "material-symbols:home",
      ),
    ).toBe("-outline-rounded");
    expect(styleSuffix("lucide:house", "lucide:house")).toBe("");
    expect(styleSuffix("lucide:house", null)).toBe("");
    // Имя карточки — не начало имени (главное имя стиля с другой основой): без суффикса.
    expect(
      styleSuffix("material-symbols:done-outline", "material-symbols:check"),
    ).toBe("");
    expect(styleSuffix("ph:housework", "ph:house")).toBe("");
  });

  const samples = [
    "house",
    "magnifying-glass",
    "gear",
    "user",
    "heart",
    "star",
  ];

  it("соседи — поиск, настройки, профиль, сердце в стиле иконки; дом и звезда — на замену ей", () => {
    expect(
      neighbourCandidates(samples, { icon: "ph:house-fill", card: "ph:house" }),
    ).toEqual([
      {
        styled: "ph:magnifying-glass-fill",
        base: "ph:magnifying-glass",
        slot: 1,
      },
      { styled: "ph:gear-fill", base: "ph:gear", slot: 2 },
      { styled: "ph:user-fill", base: "ph:user", slot: 3 },
      { styled: "ph:heart-fill", base: "ph:heart", slot: 4 },
    ]);
    // Сама иконка — из витрины: на её место встаёт звезда.
    expect(
      neighbourCandidates(samples, { icon: "ph:gear", card: "ph:gear" }).map(
        (n) => n.slot,
      ),
    ).toEqual([1, 3, 4, 5]);
    expect(
      neighbourCandidates(["a", "b"], { icon: "lucide:a", card: "lucide:a" }),
    ).toEqual([{ styled: "lucide:b", base: "lucide:b", slot: 1 }]);
  });

  it("нет имени в стиле иконки — имя витрины; подпись — по месту в витрине", () => {
    const candidates = [
      { styled: "tabler:search-filled", base: "tabler:search", slot: 1 },
      { styled: "tabler:home-filled", base: "tabler:home", slot: 0 },
      { styled: "tabler:x-filled", base: "tabler:x", slot: 7 },
    ];
    expect(
      pickNeighbours(candidates, new Set(["tabler:home-filled"]), "ru"),
    ).toEqual([
      { icon: "tabler:search", label: "Поиск" },
      { icon: "tabler:home-filled", label: "Главная" },
      { icon: "tabler:x", label: "X" },
    ]);
  });

  it("витрины наборов в data/ — те смыслы, что у подписей мест", () => {
    // Порядок витрины задаёт конфиг набора (samples): дом, поиск, настройки, профиль, сердце, звезда.
    const meaning = [
      /^(house|home)$/,
      /search|magnifying-glass/,
      /settings|gear/,
      /user|person/,
      /heart|favorite/,
      /star/,
    ];
    for (const set of [
      "lucide",
      "tabler",
      "material-symbols",
      "ph",
      "fluent-emoji-flat",
    ]) {
      const info = JSON.parse(
        readFileSync(join(root, "data", set, "info.json"), "utf8"),
      ) as { samples: string[] };
      expect(info.samples).toHaveLength(SLOT_LABELS.length);
      info.samples.forEach((sample, i) => {
        expect(sample, `${set}: ${i}`).toMatch(meaning[i] as RegExp);
      });
    }
  });

  it("подпись — первый синоним с большой буквы, без синонимов — имя карточки словами", () => {
    const synonyms = { en: ["home", "building"], ru: ["дом", "здание"] };
    const house = { icon: "lucide:house", card: "lucide:house", synonyms };
    expect(mockupLabel(house, "ru")).toBe("Дом");
    expect(mockupLabel(house, "en")).toBe("Home");
    expect(
      mockupLabel(
        { icon: "lucide:arrow-up-right", card: null, synonyms: null },
        "ru",
      ),
    ).toBe("Arrow up right");
    // Без синонимов — имя карточки, без суффикса стиля.
    expect(
      mockupLabel(
        { icon: "ph:house-fill", card: "ph:house", synonyms: null },
        "en",
      ),
    ).toBe("House");
  });
});
