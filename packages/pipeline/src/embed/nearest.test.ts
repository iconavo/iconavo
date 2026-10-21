import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../build/json.js";
import { fingerprint } from "../metadata/fingerprint.js";
import { licenseHash } from "../metadata/license.js";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import { apiError } from "./client.js";
import {
  fakeEmbeddingClient,
  hashVector,
  TEST_MODELS,
} from "./client.testing.js";
import {
  median,
  type Neighbor,
  nearestQueries,
  overlap,
  topK,
} from "./nearest.js";
import { formatNearest } from "./report.js";
import { embedSets, loadTexts } from "./run.js";
import { queryInput } from "./text.js";

const [MODEL_A, MODEL_Q] = TEST_MODELS as [
  (typeof TEST_MODELS)[number],
  (typeof TEST_MODELS)[number],
];

describe("ближайшие векторы", () => {
  const sets = [
    {
      id: "x",
      names: ["east", "north"],
      vectors: new Float32Array([1, 0, 0, 1]),
    },
    {
      id: "y",
      names: ["east-too", "diagonal"],
      vectors: new Float32Array([1, 0, Math.SQRT1_2, Math.SQRT1_2]),
    },
  ];

  it("k ближайших по скалярному произведению; при равенстве — по «набор:имя»", () => {
    const got = topK(sets, 2, new Float32Array([1, 0]), 3);
    expect(got.map((n) => `${n.set}:${n.name}`)).toEqual([
      "x:east",
      "y:east-too",
      "y:diagonal",
    ]);
    expect(got[2]?.score).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("k больше числа векторов — все по порядку", () => {
    const got = topK(sets, 2, new Float32Array([0, 1]), 10);
    expect(got.map((n) => n.name)).toEqual([
      "north",
      "diagonal",
      "east",
      "east-too",
    ]);
  });

  it("совпадение первых n и медиана", () => {
    const n = (name: string): Neighbor => ({ set: "x", name, score: 0 });
    expect(overlap([n("a"), n("b"), n("c")], [n("c"), n("a"), n("d")], 3)).toBe(
      2,
    );
    expect(overlap([n("a"), n("b")], [n("b"), n("a")], 1)).toBe(0);
    expect(median([])).toBeUndefined();
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 20, 30])).toBe(25);
  });
});

const BODIES: Record<string, string> = {
  heart: `<path d="M4 4h16v16H4z"/>`,
  star: `<circle cx="12" cy="12" r="8"/>`,
  house: `<path d="M12 2 2 12h3v10h14V12h3z"/>`,
};

const config = sourceConfigSchema.parse({
  id: "demo",
  name: "Demo",
  author: { name: "Demo" },
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  license: {
    spdx: "MIT",
    file: "LICENSE",
    confirmed: licenseHash("MIT", "MIT License"),
  },
} satisfies SourceConfigInput);

let root: string;
let dataDir: string;
let storeDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-nearest-"));
  dataDir = join(root, "data");
  storeDir = join(root, "embeddings");
  const dir = join(dataDir, "demo");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "icons.json"),
    canonicalJson({
      prefix: "demo",
      icons: Object.fromEntries(
        Object.entries(BODIES).map(([name, body]) => [name, { body }]),
      ),
      width: 24,
      height: 24,
    }),
  );
  const lang = (p: string, name: string) => ({
    description: `${p}: ${name}.`,
    synonyms: [`${p} a`, `${p} b`, `${p} c`, `${p} d`, `${p} e`],
  });
  await writeFile(
    join(dir, "search.json"),
    canonicalJson({
      prefix: "demo",
      icons: Object.fromEntries(
        Object.entries(BODIES).map(([name, body]) => [
          name,
          {
            fingerprint: fingerprint("demo", name, {
              body,
              width: 24,
              height: 24,
            }),
            tags: [name],
            ru: lang("ru", name),
            en: lang("en", name),
            promptVersion: 1,
          },
        ]),
      ),
    }),
  );
  await writeFile(join(dir, "metadata.json"), canonicalJson({}));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Текст иконки name в демо-наборе — запрос с тем же вектором найдёт её первой. */
async function textOf(name: string): Promise<string> {
  const { texts } = await loadTexts([config], dataDir);
  const item = texts[0]?.items.find((it) => it.name === name);
  if (!item) throw new Error(`нет иконки ${name}`);
  return item.text;
}

describe("pnpm nearest", () => {
  it("вектор запроса находит иконку с тем же смыслом; первый запрос не считается во времени", async () => {
    await embedSets([config], dataDir, {
      storeDir,
      models: [MODEL_Q],
      maxRub: 100,
      client: fakeEmbeddingClient().client,
    });
    const heart = await textOf("heart");
    const house = await textOf("house");
    const meaning: Record<string, string> = { сердце: heart, домик: house };
    let t = 0;
    const fake = fakeEmbeddingClient({
      vector: (model, input) => {
        const query = input.split("Query:")[1] ?? input;
        return hashVector(meaning[query] ?? input, model.dims);
      },
    });
    // Время ответа: 100, 200 мс — первый запрос в медиану не идёт.
    const client = {
      embed: async (
        ...args: Parameters<typeof fake.client.embed>
      ): ReturnType<typeof fake.client.embed> => {
        t += 100;
        return { ...(await fake.client.embed(...args)), ms: t };
      },
    };
    const r = await nearestQueries([config], dataDir, {
      client,
      storeDir,
      queries: ["сердце", "домик"],
      models: [MODEL_Q],
    });
    const m = r.models[0];
    expect(m?.results.map((x) => x.neighbors[0]?.name)).toEqual([
      "heart",
      "house",
    ]);
    expect(m?.results[0]?.neighbors[0]?.score).toBeCloseTo(1, 5);
    expect(m?.results[0]?.neighbors[0]?.icon?.body).toBe(BODIES.heart);
    // У Qwen запрос уходит с инструкцией.
    expect(fake.calls[0]?.inputs).toEqual([queryInput(MODEL_Q, "сердце")]);
    expect(m?.latencies).toEqual([200]);
    expect(m).toMatchObject({ vectors: 3, stale: 0, absent: 0, notes: [] });
    expect(formatNearest(r)).toContain("совпало в пятёрках");
  });

  it("нет векторов модели — подсказка, без запросов", async () => {
    const fake = fakeEmbeddingClient();
    const r = await nearestQueries([config], dataDir, {
      client: fake.client,
      storeDir,
      queries: ["сердце"],
      models: [MODEL_A],
    });
    expect(r.models[0]?.notes).toEqual([
      "нет векторов модели — запустите pnpm embed --model=a",
    ]);
    expect(fake.calls).toHaveLength(0);
  });

  it("ключ не подошёл — остановка без других моделей", async () => {
    for (const model of TEST_MODELS) {
      await embedSets([config], dataDir, {
        storeDir,
        models: [model],
        maxRub: 100,
        client: fakeEmbeddingClient().client,
      });
    }
    const fake = fakeEmbeddingClient({
      fail: () => apiError("test/a: ключ POLZA_API_KEY не подошёл", "run"),
    });
    const r = await nearestQueries([config], dataDir, {
      client: fake.client,
      storeDir,
      queries: ["сердце", "heart"],
      models: TEST_MODELS,
    });
    expect(r.stop).toEqual(["test/a: ключ POLZA_API_KEY не подошёл"]);
    expect(r.models).toHaveLength(1);
  });
});
