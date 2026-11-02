import type { SearchDocument } from "@iconavo-ui/search";
import { afterEach, describe, expect, it } from "vitest";
import {
  type LocalMeili,
  localSearch,
  localSimilar,
  startLocalMeili,
} from "./local.js";

const doc = (
  icon: string,
  extra: Partial<SearchDocument> = {},
): SearchDocument => {
  const [set = "", name = ""] = icon.split(":");
  return {
    id: `${set}_${name}`,
    icon,
    set,
    palette: false,
    license: "MIT",
    names: [name, icon],
    name: [name.replaceAll("-", " ")],
    tags: [],
    synonymsEn: [],
    synonymsRu: [],
    variants: [],
    tones: [],
    style: ["outline"],
    styles: { outline: name },
    about: { tags: [] },
    parts: 1,
    setOrder: 0,
    hash: "0".repeat(16),
    textHash: null,
    ...extra,
  };
};

const DOCS = [
  doc("lucide:house"),
  doc("ph:house", {
    variants: ["house-fill"],
    style: ["outline", "filled"],
    styles: { outline: "house", filled: "house-fill" },
  }),
  doc("lucide:heart"),
];

describe("локальный Meilisearch проверки сайта", () => {
  it("слова по вхождению, фильтры общего модуля, только запрошенные поля", () => {
    expect(
      localSearch(DOCS, {
        q: "house",
        filter: ['style = "filled"'],
        attributesToRetrieve: ["icon", "styles"],
        limit: 10,
      }),
    ).toEqual({
      hits: [
        {
          icon: "ph:house",
          styles: { outline: "house", filled: "house-fill" },
        },
      ],
    });
    expect(
      localSearch(DOCS, { q: "", filter: ['names = "house"'], limit: 1 }).hits,
    ).toEqual([{ icon: "lucide:house" }]);
    expect(() =>
      localSearch(DOCS, { q: "a", filter: ["unknown = 1"] }),
    ).toThrow(/фильтр не понят/);
  });

  it("похожие: соседи по общим словам, без самого документа; без вектора — 400, нет документа — 404", () => {
    const docs = [
      doc("lucide:house", { tags: ["home", "building"], textHash: "a" }),
      doc("ph:house", { tags: ["home"], textHash: "b", setOrder: 1 }),
      doc("lucide:heart", { tags: ["love"], textHash: "c" }),
      doc("tabler:new"),
    ];
    const answer = localSimilar(docs, {
      id: "lucide_house",
      limit: 2,
      attributesToRetrieve: ["icon", "styles"],
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      hits: [
        { icon: "ph:house", styles: { outline: "house" } },
        { icon: "lucide:heart", styles: { outline: "heart" } },
      ],
      id: "lucide_house",
    });
    expect(localSimilar(docs, { id: "tabler_new" }).status).toBe(400);
    expect(localSimilar(docs, { id: "nope_x" }).status).toBe(404);
  });

  let meili: LocalMeili | undefined;
  afterEach(async () => {
    await meili?.close();
    meili = undefined;
  });

  it("POST /multi-search с ключом; без ключа — 401", async () => {
    meili = await startLocalMeili(DOCS);
    const post = (key: string) =>
      fetch(`${meili?.url}/multi-search`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: JSON.stringify({
          queries: [{ q: "heart", attributesToRetrieve: ["icon"] }],
        }),
      });
    const ok = await post(meili.key);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      results: [{ hits: [{ icon: "lucide:heart" }] }],
    });
    expect((await post("wrong")).status).toBe(401);
    expect(meili.calls).toBe(1);
  });
});
