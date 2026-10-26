import { SEARCH_MODEL, STORE_KEYS, vectorHash } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import { fakeStorage } from "../cdn/storage.testing.js";
import { buildCatalog, setDocs } from "../search/catalog.js";
import { demoConfig, loadedSet } from "../search/fixture.testing.js";
import {
  catalogPhrases,
  phraseEntries,
  storedPhraseHashes,
} from "./phrases.js";

const lucide = demoConfig("lucide");
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
            tags: ["e-mail"],
            en: ["add to cart"],
            ru: ["добавить в корзину", "Корзина"],
          },
        ],
      }),
    ),
  },
]);

describe("catalogPhrases", () => {
  const phrases = catalogPhrases(catalog);

  it("фразы и слова из них, нормализованные как запрос", () => {
    expect(phrases).toContain("shopping cart");
    expect(phrases).toContain("shopping");
    expect(phrases).toContain("добавить в корзину");
    expect(phrases).toContain("корзину");
    expect(phrases).toContain("корзина");
    expect(phrases).toContain("e mail");
    expect(phrases).toContain("mail");
  });

  it("без служебных слов, однобуквенных слов и повторов, по алфавиту", () => {
    expect(phrases).not.toContain("в");
    expect(phrases).not.toContain("to");
    expect(phrases).not.toContain("e");
    expect(new Set(phrases).size).toBe(phrases.length);
    expect([...phrases].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(
      phrases,
    );
  });
});

describe("phraseEntries и storedPhraseHashes", () => {
  it("ключ фразы — vectorHash, как у функции edge API", async () => {
    const [entry] = await phraseEntries(["корзина"]);
    expect(entry?.hash).toBe(await vectorHash(SEARCH_MODEL.id, "корзина"));
  });

  it("в бакете — только целые векторы под префиксом фраз", async () => {
    const storage = fakeStorage();
    storage.seed(
      STORE_KEYS.phrase("a1"),
      new Uint8Array(SEARCH_MODEL.dims * 4),
    );
    storage.seed(STORE_KEYS.phrase("b2"), new Uint8Array(8));
    storage.seed("icons/gemini-1024/lucide.f32", new Uint8Array(4));
    expect([...(await storedPhraseHashes(storage.client))]).toEqual(["a1"]);
  });
});
