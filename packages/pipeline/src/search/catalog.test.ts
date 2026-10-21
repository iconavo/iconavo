import { describe, expect, it } from "vitest";
import { buildCatalog, setDocs } from "./catalog.js";
import { demoConfig, loadedSet } from "./fixture.testing.js";

const ph = demoConfig("ph");
const phSet = loadedSet({
  id: "ph",
  suffixes: { "": "Regular", "-bold": "Bold", "-fill": "Fill" },
  icons: [
    { name: "pulse", tags: ["heartbeat"], en: ["pulse"], ru: ["пульс"] },
    { name: "pulse-bold" },
    { name: "pulse-fill" },
    { name: "house", tags: ["home"], en: ["house"], ru: ["дом"] },
    { name: "house-bold" },
  ],
  // Переименование (прежнее имя варианта) и алиас-вариант.
  aliases: {
    "activity-bold": "pulse-bold",
    activity: "pulse",
    "house-fill": "house",
  },
});

describe("документы набора", () => {
  const { docs, names } = setDocs(ph, phSet);
  const byName = new Map(docs.map((d) => [d.name, d]));

  it("документ — базовая иконка, варианты внутри карточки", () => {
    expect(docs.map((d) => d.id)).toEqual(["ph:house", "ph:pulse"]);
    expect(byName.get("pulse")?.variants).toEqual(["pulse-bold", "pulse-fill"]);
    expect(byName.get("house")?.variants).toEqual(["house-bold"]);
  });

  it("слова: имя и прежние имена без слов вариантов, теги, синонимы", () => {
    const pulse = byName.get("pulse");
    expect(pulse?.words.name).toEqual(["pulse", "activity"]);
    expect(pulse?.words.tags).toEqual(["heartbeat"]);
    expect(pulse?.words.synonyms).toContain("пульс");
    // Слова вариантов (bold, fill) и алиас-вариант house-fill слов не добавляют.
    expect(byName.get("house")?.words.name).toEqual(["house"]);
    expect(pulse?.words.name).not.toContain("bold");
  });

  it("любое имя набора ведёт к карточке: вариант, алиас, прежнее имя", () => {
    expect(names.get("pulse-fill")).toBe("pulse");
    expect(names.get("activity-bold")).toBe("pulse");
    expect(names.get("house-fill")).toBe("house");
  });

  it("у иконки с описаниями есть хэш текста для векторов, без описаний — нет", () => {
    expect(byName.get("pulse")?.textHash).toMatch(/^[0-9a-f]{16}$/);
    const bare = setDocs(
      ph,
      loadedSet({ id: "ph", icons: [{ name: "x", tags: ["x"] }] }),
    ).docs[0];
    expect(bare?.textHash).toBeUndefined();
  });
});

describe("оттенки кожи", () => {
  const tones = ["-light", "-medium-light", "-medium", "-medium-dark", "-dark"];
  const fluent = demoConfig("fluent-emoji-flat");
  const set = loadedSet({
    id: "fluent-emoji-flat",
    icons: [
      { name: "waving-hand", en: ["wave"], ru: ["привет"] },
      ...tones.map((t) => ({ name: `waving-hand${t}`, en: ["wave"] })),
      { name: "police-car", en: ["police"] },
      { name: "police-car-light", en: ["siren"] },
    ],
  });
  const { docs, names } = setDocs(fluent, set);

  it("основа и все пять оттенков — одна карточка", () => {
    const hand = docs.find((d) => d.name === "waving-hand");
    expect(hand?.tones).toEqual(tones.map((t) => `waving-hand${t}`));
    expect(docs.some((d) => d.name === "waving-hand-dark")).toBe(false);
    expect(names.get("waving-hand-medium-dark")).toBe("waving-hand");
  });

  it("police-car-light — не оттенок: остальных четырёх нет", () => {
    expect(docs.map((d) => d.name)).toContain("police-car-light");
    expect(docs.find((d) => d.name === "police-car")?.tones).toEqual([]);
  });
});

describe("каталог", () => {
  it("номера документов, имена с набором и без, части имени", () => {
    const lucide = demoConfig("lucide");
    const catalog = buildCatalog([
      { config: ph, docs: setDocs(ph, phSet) },
      {
        config: lucide,
        docs: setDocs(
          lucide,
          loadedSet({
            id: "lucide",
            icons: [{ name: "house-plus", en: ["house"] }, { name: "house" }],
            aliases: { home: "house" },
          }),
        ),
      },
    ]);
    expect(catalog.docs.map((d) => d.id)).toEqual([
      "ph:house",
      "ph:pulse",
      "lucide:house",
      "lucide:house-plus",
    ]);
    expect(catalog.names.get("lucide:home")).toBe(2);
    expect(catalog.bareNames.get("house")).toEqual([0, 2]);
    expect(catalog.bareNames.get("home")).toEqual([2]);
    expect([...catalog.parts]).toEqual([1, 1, 1, 2]);
    expect(catalog.sets.map((s) => s.id)).toEqual(["ph", "lucide"]);
  });
});
