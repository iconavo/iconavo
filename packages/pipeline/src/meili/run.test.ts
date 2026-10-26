import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMBEDDER,
  INDEX_SETTINGS,
  SEARCH_MODEL,
  STORE_KEYS,
  vectorHash,
} from "@iconavo-ui/search";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Manifest } from "../cdn/files.js";
import { writeCdnDemoSet } from "../cdn/fixture.testing.js";
import { fakeStorage } from "../cdn/storage.testing.js";
import { fakeEmbeddingClient } from "../embed/client.testing.js";
import {
  type DemoSet,
  demoConfig,
  writeDemoSet,
} from "../search/fixture.testing.js";
import { fakeMeili } from "./fake.testing.js";
import {
  diffDocuments,
  type SearchIndexOptions,
  searchIndex,
  settingsDiff,
} from "./run.js";
import { readSetVectors } from "./vectors.js";

const LUCIDE: DemoSet = {
  id: "lucide",
  icons: [
    {
      name: "house",
      tags: ["home"],
      en: ["home"],
      ru: ["дом"],
      body: '<path d="M1 0h1v1H1z"/>',
    },
    {
      name: "trash",
      en: ["trash"],
      ru: ["корзина", "мусор"],
      body: '<path d="M2 0h1v2H2z"/>',
    },
    {
      name: "calendar",
      en: ["date"],
      ru: ["Календарь"],
      body: '<path d="M3 0h1v3H3z"/>',
    },
  ],
  aliases: { home: "house" },
};

const TABLER: DemoSet = {
  id: "tabler",
  suffixes: { "": "Outline", "-filled": "Filled" },
  icons: [
    {
      name: "trash",
      en: ["trash"],
      ru: ["корзина"],
      body: '<path d="M4 0h1v4H4z"/>',
    },
    { name: "trash-filled", body: '<path d="M5 0h1v5H5z"/>' },
  ],
};

let root: string;
let dataDir: string;
let versions: Map<string, string>;

async function writeSets(sets: readonly DemoSet[]) {
  versions = new Map();
  for (const set of sets) {
    await writeDemoSet(dataDir, set);
    // Файлы раздачи по схеме: icons.json с lastModified и info.json с версией (их читает loadSetData).
    const { version } = await writeCdnDemoSet(dataDir, {
      id: set.id,
      icons: Object.fromEntries(
        set.icons.map((i) => [i.name, { body: i.body as string }]),
      ),
      ...(set.aliases
        ? {
            aliases: Object.fromEntries(
              Object.entries(set.aliases).map(([a, parent]) => [a, { parent }]),
            ),
          }
        : {}),
    });
    versions.set(set.id, version);
  }
}

const liveManifest = async (): Promise<Manifest> => ({
  sets: Object.fromEntries(
    [...versions].map(([id, version]) => [id, { version, lastModified: 1 }]),
  ),
});

const configs = [demoConfig("lucide"), demoConfig("tabler")];

function setup() {
  const meili = fakeMeili();
  const storage = fakeStorage();
  const embed = fakeEmbeddingClient();
  const run = (extra: Partial<SearchIndexOptions> = {}) =>
    searchIndex({
      configs,
      dataDir,
      dryRun: false,
      maxRub: 10,
      reembed: false,
      meili: meili.client,
      storage: storage.client,
      embedder: embed.client,
      liveManifest,
      ...extra,
    });
  return { meili, storage, embed, run };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-meili-"));
  dataDir = join(root, "data");
  await writeSets([LUCIDE, TABLER]);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("searchIndex: первый запуск", () => {
  it("создаёт индекс, ставит настройки, пишет документы с векторами, фразы и версию", async () => {
    const { meili, storage, embed, run } = setup();
    const r = await run();
    expect(r.stop).toEqual([]);
    expect(r.mode).toBe("write");
    expect(r.cards).toBe(4);
    expect(r.withText).toBe(4);
    expect(r.settings).toBe("create");
    expect(r.documents).toMatchObject({ add: 4, update: 0, delete: 0 });
    expect(r.vectors).toMatchObject({ missing: 4, computed: 4 });
    expect(r.phrases.computed).toBe(r.phrases.total);
    expect(r.version.written).toBe(true);

    expect(meili.index).toEqual({ uid: "icons", primaryKey: "id" });
    expect(meili.settings).toMatchObject(INDEX_SETTINGS);
    const house = meili.docs.get("lucide_house");
    expect(house).toMatchObject({
      icon: "lucide:house",
      names: ["home", "house", "lucide:home", "lucide:house"],
      name: ["house", "home"],
    });
    expect(house?._vectors?.[EMBEDDER]).toHaveLength(SEARCH_MODEL.dims);
    // Вариант — в карточке базовой иконки, а не отдельным документом.
    expect(meili.docs.get("tabler_trash")?.variants).toEqual(["trash-filled"]);
    expect(meili.docs.has("tabler_trash-filled")).toBe(false);

    // Векторы иконок — в бакете по наборам; версия индекса — последней из записей индекса.
    const lucide = await readSetVectors(storage.client, "lucide");
    expect(lucide.status).toBe("ok");
    expect([...lucide.vectors.keys()].sort()).toEqual([
      "calendar",
      "house",
      "trash",
    ]);
    const puts = storage.puts();
    expect(puts.indexOf(STORE_KEYS.iconVectors("lucide"))).toBeLessThan(
      puts.indexOf(STORE_KEYS.iconIndex("lucide")),
    );
    expect(puts.indexOf(STORE_KEYS.index)).toBeGreaterThan(
      puts.indexOf(STORE_KEYS.iconIndex("tabler")),
    );

    // Фраза каталога лежит по тому же ключу, что посчитает функция для запроса.
    const key = STORE_KEYS.phrase(
      await vectorHash(SEARCH_MODEL.id, "календарь"),
    );
    expect(storage.store.has(key)).toBe(true);
    expect(embed.calls.length).toBeGreaterThan(0);
  });

  it("пишет в журнал ход фраз и потраченное", async () => {
    const { run } = setup();
    const lines: string[] = [];
    const r = await run({ log: (l) => lines.push(l), phraseLogEvery: 2 });
    const total = r.phrases.missing;
    expect(total).toBeGreaterThan(2);
    expect(lines).toContain(`Фразы: векторы ${total}…`);
    expect(lines.at(-1)).toMatch(
      new RegExp(`^ {2}фразы: ${total} из ${total} · .+₽$`),
    );
  });

  it("повтор без изменений ничего не пишет и не платит", async () => {
    const { storage, embed, meili, run } = setup();
    await run();
    const writes = storage.puts().length;
    const polza = embed.calls.length;
    const meiliCalls = meili.calls.length;
    const r = await run();
    expect(r.stop).toEqual([]);
    expect(r.settings).toBe("same");
    expect(r.documents).toMatchObject({
      add: 0,
      update: 0,
      delete: 0,
      same: 4,
    });
    expect(r.vectors.missing).toBe(0);
    expect(r.phrases.missing).toBe(0);
    expect(r.version.written).toBe(false);
    expect(r.version.before).toBe(r.version.after);
    expect(storage.puts().length).toBe(writes);
    expect(embed.calls.length).toBe(polza);
    expect(
      meili.calls
        .slice(meiliCalls)
        .filter((c) => c !== "index" && c !== "settings" && c !== "documents"),
    ).toEqual([]);
  });
});

describe("searchIndex: изменения", () => {
  it("новый синоним — один документ и один вектор заново; лишняя иконка удаляется", async () => {
    const { meili, embed, run } = setup();
    await run();
    const before = embed.calls.flatMap((c) => c.inputs).length;
    await writeSets([
      {
        ...LUCIDE,
        icons: [
          { ...(LUCIDE.icons[0] as object), ru: ["дом", "домик"] } as never,
          LUCIDE.icons[1] as never,
        ],
      },
      TABLER,
    ]);
    const r = await run();
    expect(r.stop).toEqual([]);
    expect(r.documents).toMatchObject({ add: 0, update: 1, delete: 1 });
    expect(r.vectors).toMatchObject({ missing: 1, computed: 1 });
    expect(meili.docs.has("lucide_calendar")).toBe(false);
    expect(meili.docs.get("lucide_house")?.synonymsRu).toContain("домик");
    const sent = embed.calls.flatMap((c) => c.inputs).slice(before);
    expect(sent).toContain("домик");
    expect(r.version.written).toBe(true);
  });

  it("версия набора не та, что на раздаче: запись — «СТОП», показ — заметка", async () => {
    const { meili, run } = setup();
    const stale = async (): Promise<Manifest> => ({
      sets: { lucide: { version: "00000000", lastModified: 1 } },
    });
    const r = await run({ liveManifest: stale });
    expect(r.stop.join(" ")).toMatch(/сначала «Выкладка»/);
    expect(r.stop.join(" ")).toMatch(/tabler .* ≠ нет/);
    expect(meili.calls).toEqual([]);
    const dry = await run({ liveManifest: stale, dryRun: true });
    expect(dry.stop).toEqual([]);
    expect(dry.notes.join(" ")).toMatch(/сначала «Выкладка»/);
  });

  it("другой эмбеддер в индексе — «СТОП» без --reembed; с ним — все документы заново", async () => {
    const { meili, run } = setup();
    await run();
    meili.settings = {
      ...meili.settings,
      embedders: { [EMBEDDER]: { source: "userProvided", dimensions: 3072 } },
    };
    const r = await run();
    expect(r.stop.join(" ")).toMatch(/--reembed/);
    const again = await run({ reembed: true });
    expect(again.stop).toEqual([]);
    expect(again.documents).toMatchObject({ update: 4, same: 0 });
    expect(meili.docs.get("lucide_house")?._vectors?.[EMBEDDER]).toHaveLength(
      SEARCH_MODEL.dims,
    );
  });

  it("оценка выше лимита — «СТОП» до любой записи", async () => {
    const { meili, storage, embed, run } = setup();
    const r = await run({ maxRub: 0 });
    expect(r.stop.join(" ")).toMatch(/выше лимита/);
    expect(storage.puts()).toEqual([]);
    expect(embed.calls).toEqual([]);
    expect(meili.calls).not.toContain("createIndex");
  });

  it("сбой Polza — «СТОП», посчитанное сохранено, индекс не тронут", async () => {
    const { meili, storage, run } = setup();
    const embed = fakeEmbeddingClient({
      fail: (call) => (call === 1 ? undefined : new Error("polza упала")),
    });
    const r = await run({ embedder: embed.client });
    expect(r.stop.join(" ")).toMatch(/polza упала/);
    expect(meili.calls).not.toContain("addDocuments");
    expect(storage.puts().some((k) => k.startsWith("icons/"))).toBe(true);
  });

  it("показ ничего не пишет и не платит", async () => {
    const { meili, storage, embed, run } = setup();
    const r = await run({ dryRun: true, embedder: undefined });
    expect(r.mode).toBe("dry-run");
    expect(r.documents.add).toBe(4);
    expect(r.rub.estimate).toBeGreaterThan(0);
    expect(storage.puts()).toEqual([]);
    expect(embed.calls).toEqual([]);
    expect(meili.calls).toEqual(["index"]);
  });

  it("без ключей: показ — план без сети, запись — «СТОП»", async () => {
    const plan = await searchIndex({
      configs,
      dataDir,
      dryRun: true,
      maxRub: 10,
      reembed: false,
    });
    expect(plan.mode).toBe("offline");
    expect(plan.stop).toEqual([]);
    expect(plan.documents.add).toBe(4);
    expect(plan.phrases.missing).toBe(plan.phrases.total);
    const write = await searchIndex({
      configs,
      dataDir,
      dryRun: false,
      maxRub: 10,
      reembed: false,
    });
    expect(write.stop.join(" ")).toMatch(/нет ключей/);
  });
});

describe("settingsDiff", () => {
  it("те же настройки — без отличий, даже если Meilisearch отдал их иначе", () => {
    const current = {
      ...structuredClone(INDEX_SETTINGS),
      filterableAttributes: [...INDEX_SETTINGS.filterableAttributes].reverse(),
      typoTolerance: {
        ...INDEX_SETTINGS.typoTolerance,
        disableOnWords: [],
        disableOnAttributes: [],
      },
      faceting: { maxValuesPerFacet: 100 },
    };
    expect(settingsDiff(current)).toEqual({ keys: [], embedderChanged: false });
  });

  it("пустой индекс — эмбеддер добавляется, а не меняется", () => {
    expect(settingsDiff({}).embedderChanged).toBe(false);
    expect(settingsDiff({}).keys).toContain("embedders");
  });

  it("другие правила ранжирования и другой эмбеддер", () => {
    const d = settingsDiff({
      ...structuredClone(INDEX_SETTINGS),
      rankingRules: ["words"],
      embedders: { other: { source: "openAi" } },
    });
    expect(d.keys).toEqual(["rankingRules", "embedders"]);
    expect(d.embedderChanged).toBe(true);
  });
});

describe("diffDocuments", () => {
  const doc = (id: string, hash: string) =>
    ({ id, hash }) as Parameters<typeof diffDocuments>[0][number];

  it("добавить, изменить, удалить, без изменений", () => {
    const d = diffDocuments(
      [doc("a", "1"), doc("b", "2"), doc("c", "3")],
      new Map([
        ["b", "2"],
        ["c", "x"],
        ["z", "9"],
      ]),
      false,
    );
    expect(d.upsert.map((x) => x.id)).toEqual(["a", "c"]);
    expect(d.remove).toEqual(["z"]);
    expect(d.same).toBe(1);
    expect(d.changes).toEqual([
      { id: "a", change: "add" },
      { id: "c", change: "update" },
      { id: "z", change: "delete" },
    ]);
    expect(
      diffDocuments([doc("b", "2")], new Map([["b", "2"]]), true).upsert,
    ).toHaveLength(1);
  });
});
