import { describe, expect, it } from "vitest";
import { buildCatalog, setDocs } from "../search/catalog.js";
import { demoConfig, loadedSet } from "../search/fixture.testing.js";
import { type SetFacts, searchDocuments } from "./docs.js";

const lucide = demoConfig("lucide");
const fluent = demoConfig("fluent");
const tones = [
  "",
  "-light",
  "-medium-light",
  "-medium",
  "-medium-dark",
  "-dark",
];

const catalog = buildCatalog([
  {
    config: lucide,
    docs: setDocs(
      lucide,
      loadedSet({
        id: "lucide",
        icons: [
          {
            name: "shopping-cart",
            tags: ["Shop"],
            en: ["Cart"],
            ru: ["Ёлка", "корзина"],
          },
          { name: "house", en: ["home"], ru: ["дом"] },
          { name: "bare" },
        ],
        aliases: { home: "house", basket: "shopping-cart" },
      }),
    ),
  },
  {
    config: fluent,
    docs: setDocs(
      fluent,
      loadedSet({
        id: "fluent",
        icons: tones.map((t) => ({
          name: `waving-hand${t}`,
          en: ["wave"],
          ru: ["привет"],
        })),
      }),
    ),
  },
]);

const facts = new Map<string, SetFacts>([
  ["lucide", { palette: false, license: "ISC", order: 0 }],
  ["fluent", { palette: true, license: "MIT", order: 1 }],
]);

describe("searchDocuments", () => {
  const docs = searchDocuments(catalog, facts);
  const byId = new Map(docs.map((d) => [d.id, d]));

  it("карточка: имена для точного совпадения, фразы, наборные поля", () => {
    const cart = byId.get("lucide_shopping-cart");
    expect(cart).toMatchObject({
      icon: "lucide:shopping-cart",
      set: "lucide",
      palette: false,
      license: "ISC",
      names: [
        "basket",
        "lucide:basket",
        "lucide:shopping-cart",
        "shopping-cart",
      ],
      name: ["shopping cart", "basket"],
      tags: ["shop"],
      parts: 2,
      setOrder: 0,
    });
    expect(cart?.synonymsEn[0]).toBe("cart");
    expect(cart?.synonymsRu.slice(0, 2)).toEqual(["елка", "корзина"]);
    expect(cart?.textHash).toMatch(/^[0-9a-f]{16}$/);
    expect(cart?.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("без описаний — карточка есть, вектора нет", () => {
    expect(byId.get("lucide_bare")?.textHash).toBeNull();
  });

  it("оттенки кожи — одна карточка с именами всех оттенков", () => {
    expect(docs.filter((d) => d.set === "fluent")).toHaveLength(1);
    const hand = byId.get("fluent_waving-hand");
    expect(hand?.tones).toHaveLength(5);
    expect(hand?.names).toContain("waving-hand-dark");
    expect(hand?.names).toContain("fluent:waving-hand-medium-light");
    expect(hand).toMatchObject({ palette: true, setOrder: 1 });
  });

  it("отпечаток меняется вместе с документом и только с ним", () => {
    const again = searchDocuments(catalog, facts);
    expect(again.map((d) => d.hash)).toEqual(docs.map((d) => d.hash));
    const other = searchDocuments(
      catalog,
      new Map([
        ...facts,
        ["lucide", { palette: false, license: "MIT", order: 0 }],
      ]),
    );
    expect(other.find((d) => d.id === "lucide_house")?.hash).not.toBe(
      byId.get("lucide_house")?.hash,
    );
    expect(other.find((d) => d.id === "fluent_waving-hand")?.hash).toBe(
      byId.get("fluent_waving-hand")?.hash,
    );
  });

  it("нет сведений о наборе — ошибка", () => {
    expect(() => searchDocuments(catalog, new Map())).toThrow(/info\.json/);
  });
});
