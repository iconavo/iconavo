import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiError } from "../embed/client.js";
import { fakeEmbeddingClient, TEST_MODELS } from "../embed/client.testing.js";
import { embedSets } from "../embed/run.js";
import { loadCatalog } from "./catalog.js";
import { demoConfig, writeDemoSet } from "./fixture.testing.js";
import { queryVectors } from "./query-vectors.js";
import {
  catalogBytes,
  cosines,
  loadModelVectors,
  vectorLengths,
} from "./vectors.js";

const [MODEL_A, MODEL_Q] = TEST_MODELS as [
  (typeof TEST_MODELS)[number],
  (typeof TEST_MODELS)[number],
];
const config = demoConfig("demo");

let root: string;
let dataDir: string;
let storeDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-vectors-"));
  dataDir = join(root, "data");
  storeDir = join(root, "embeddings");
  await writeDemoSet(dataDir, {
    id: "demo",
    icons: [
      { name: "heart", en: ["love"], ru: ["сердце"] },
      { name: "house", en: ["home"], ru: ["дом"] },
      { name: "bare", tags: ["bare"] },
    ],
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Вектор длины 1 из первых n чисел. */
function unitPrefix(v: Float32Array, n: number): number[] {
  const head = Array.from(v.subarray(0, n));
  const norm = Math.sqrt(head.reduce((s, x) => s + x * x, 0));
  return head.map((x) => x / norm);
}

describe("векторы карточек", () => {
  it("длины по возрастанию, полная — последней", () => {
    expect(vectorLengths(MODEL_Q, [4, 2, 4, 6, 9])).toEqual([2, 4, 6]);
    expect(catalogBytes(10, 1024)).toBe(40_960);
  });

  it("косинус укороченного вектора — как у вектора, укороченного и пересчитанного", async () => {
    await embedSets([config], dataDir, {
      storeDir,
      models: [MODEL_Q],
      maxRub: 100,
      client: fakeEmbeddingClient().client,
    });
    const { catalog } = await loadCatalog([config], dataDir);
    const mv = await loadModelVectors(catalog, MODEL_Q, storeDir, [2, 4]);
    expect(mv.lengths).toEqual([2, 4, 6]);
    // Без описаний у «bare» нет вектора.
    expect(Array.from(mv.present)).toEqual([0, 1, 1]);
    expect(mv).toMatchObject({ absent: 1, stale: 0 });
    const query = new Float32Array([0.5, -0.1, 0.3, 0.7, -0.2, 0.4]);
    const norm = Math.hypot(...query);
    const q = query.map((x) => x / norm);
    const cos = cosines(mv, q);
    const heart = catalog.byId.get("demo:heart") as number;
    const stored = mv.data.subarray(heart * 6, heart * 6 + 6);
    for (const [k, length] of mv.lengths.entries()) {
      const a = unitPrefix(q, length);
      const b = unitPrefix(stored, length);
      const expected = a.reduce((s, x, i) => s + x * (b[i] as number), 0);
      expect(cos[k]?.[heart]).toBeCloseTo(expected, 5);
    }
    expect(
      Number.isNaN(cos[2]?.[catalog.byId.get("demo:bare") as number]),
    ).toBe(true);
    expect(() => cosines(mv, new Float32Array(3))).toThrow(/длины 3/);
  });

  it("поменялось описание — вектор устарел, но поиск им пользуется", async () => {
    await embedSets([config], dataDir, {
      storeDir,
      models: [MODEL_A],
      maxRub: 100,
      client: fakeEmbeddingClient().client,
    });
    await writeDemoSet(dataDir, {
      id: "demo",
      icons: [
        { name: "heart", en: ["love", "valentine"], ru: ["сердце"] },
        { name: "house", en: ["home"], ru: ["дом"] },
        { name: "bare", tags: ["bare"] },
      ],
    });
    const { catalog } = await loadCatalog([config], dataDir);
    const mv = await loadModelVectors(catalog, MODEL_A, storeDir);
    expect(mv).toMatchObject({ stale: 1, absent: 1 });
    expect(mv.present[catalog.byId.get("demo:heart") as number]).toBe(1);
    expect(mv.notes.at(-1)).toContain("pnpm embed --model=a");
  });

  it("нет векторов набора — подсказка", async () => {
    const { catalog } = await loadCatalog([config], dataDir);
    const mv = await loadModelVectors(catalog, MODEL_A, storeDir);
    expect(mv.absent).toBe(3);
    expect(mv.notes[0]).toBe(
      "demo: нет векторов — запустите pnpm embed demo --model=a",
    );
  });
});

describe("векторы запросов", () => {
  it("промахи — пачками, повторы запроса — один вектор, второй раз — из кэша", async () => {
    const fake = fakeEmbeddingClient();
    const dir = join(root, "queries");
    const first = await queryVectors(MODEL_A, ["a", "b", "a", "c"], {
      dir,
      client: fake.client,
    });
    // batchSize модели a — 2: три разных запроса уходят двумя пачками.
    expect(fake.calls.map((c) => c.inputs)).toEqual([["a", "b"], ["c"]]);
    expect(first).toMatchObject({ cached: 0, fetched: 3 });
    expect(first.vectors[2]).toBe(first.vectors[0]);
    expect(await readdir(join(dir, "a"))).toHaveLength(3);

    const again = await queryVectors(MODEL_A, ["c", "a"], { dir });
    expect(again).toMatchObject({ cached: 2, fetched: 0 });
    expect(Array.from(again.vectors[1] ?? [])).toEqual(
      Array.from(first.vectors[0] ?? []),
    );
    expect(fake.calls).toHaveLength(2);
  });

  it("у Qwen запрос уходит с инструкцией и хранится отдельно", async () => {
    const fake = fakeEmbeddingClient();
    const dir = join(root, "queries");
    await queryVectors(MODEL_Q, ["дом"], { dir, client: fake.client });
    expect(fake.calls[0]?.inputs).toEqual(["Instruct: Find icons\nQuery:дом"]);
    expect(await readdir(join(dir, "q"))).toHaveLength(1);
  });

  it("нет ключа или отказ — без векторов, с причиной", async () => {
    const dir = join(root, "queries");
    const none = await queryVectors(MODEL_A, ["a"], { dir });
    expect(none.vectors).toEqual([undefined]);
    expect(none.error).toContain("POLZA_API_KEY");
    const fake = fakeEmbeddingClient({
      fail: () => apiError("test/a: ключ не подошёл", "run"),
    });
    const failed = await queryVectors(MODEL_A, ["a"], {
      dir,
      client: fake.client,
    });
    expect(failed).toMatchObject({
      error: "test/a: ключ не подошёл",
      scope: "run",
    });
  });

  it("битый файл кэша — вектор считается заново", async () => {
    const fake = fakeEmbeddingClient();
    const dir = join(root, "queries");
    await queryVectors(MODEL_A, ["a"], { dir, client: fake.client });
    const [file] = await readdir(join(dir, "a"));
    await writeFile(join(dir, "a", file as string), "short");
    const again = await queryVectors(MODEL_A, ["a"], {
      dir,
      client: fake.client,
    });
    expect(again).toMatchObject({ cached: 0, fetched: 1 });
  });
});
