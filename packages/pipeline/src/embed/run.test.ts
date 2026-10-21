import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SearchFile } from "@iconavo-ui/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, type Json } from "../build/json.js";
import { fingerprint } from "../metadata/fingerprint.js";
import { licenseHash } from "../metadata/license.js";
import { CSP } from "../report/html.js";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import { apiError, type EmbeddingClient } from "./client.js";
import { fakeEmbeddingClient, TEST_MODELS } from "./client.testing.js";
import { estimateRub } from "./cost.js";
import {
  formatEmbedReport,
  formatEmbedTable,
  renderEmbedPage,
  renderNearestPage,
} from "./report.js";
import {
  type EmbedOptions,
  embedSets,
  embedStatus,
  hasStop,
  loadTexts,
} from "./run.js";
import { readIndex, readStore, storePaths } from "./store.js";
import { iconText } from "./text.js";

const [MODEL_A, MODEL_Q] = TEST_MODELS as [
  (typeof TEST_MODELS)[number],
  (typeof TEST_MODELS)[number],
];

const DEFAULT_BODIES: Record<string, string> = {
  heart: `<path fill="currentColor" d="M4 4h16v16H4z"/>`,
  "heart-filled": `<path fill="currentColor" d="M2 2h20v20H2z"/>`,
  star: `<circle cx="12" cy="12" r="8" fill="currentColor"/>`,
  house: `<path fill="currentColor" d="M12 2 2 12h3v10h14V12h3z"/>`,
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
  suffixes: { "": "Outline", "-filled": "Filled" },
} satisfies SourceConfigInput);

let root: string;
let dataDir: string;
let storeDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-embed-"));
  dataDir = join(root, "data");
  storeDir = join(root, "embeddings");
  await writeSet();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const lang = (p: string, name: string, extra = "") => ({
  description: `${p}: ${name}${extra}.`,
  synonyms: [`${p} a`, `${p} b`, `${p} c`, `${p} d`, `${p} e`],
});

interface SetOptions {
  bodies?: Record<string, string>;
  /** Базовые с описаниями; по умолчанию все, кроме вариантов «-filled». */
  described?: (name: string) => boolean;
  /** Добавка к описанию — чтобы поменять текст иконки. */
  extra?: Record<string, string>;
  /** Испортить отпечаток — search.json «не от этой сборки». */
  stale?: boolean;
}

async function writeSet(options: SetOptions = {}) {
  const bodies = options.bodies ?? DEFAULT_BODIES;
  const described = options.described ?? ((n) => !n.endsWith("-filled"));
  const dir = join(dataDir, "demo");
  await mkdir(dir, { recursive: true });
  const icons = Object.fromEntries(
    Object.entries(bodies).map(([name, body]) => [name, { body }]),
  );
  await writeFile(
    join(dir, "icons.json"),
    canonicalJson({ prefix: "demo", icons, width: 24, height: 24 }),
  );
  const file: SearchFile = {
    prefix: "demo",
    icons: Object.fromEntries(
      Object.entries(bodies).map(([name, body]) => {
        const fp = fingerprint("demo", name, { body, width: 24, height: 24 });
        const entry = {
          fingerprint: options.stale ? "000000000000" : fp,
          tags: [name],
        };
        if (!described(name)) return [name, entry];
        const extra = options.extra?.[name] ?? "";
        return [
          name,
          {
            ...entry,
            ru: lang("ru", name, extra),
            en: lang("en", name, extra),
            promptVersion: 1,
          },
        ];
      }),
    ),
  };
  await writeFile(
    join(dir, "search.json"),
    canonicalJson(file as unknown as Json),
  );
  await writeFile(
    join(dir, "metadata.json"),
    canonicalJson({ suffixes: { "": "Outline", "-filled": "Filled" } }),
  );
}

const run = (options: Partial<EmbedOptions> = {}) =>
  embedSets([config], dataDir, {
    storeDir,
    models: TEST_MODELS,
    maxRub: 100,
    ...options,
  });

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const sentTexts = (calls: { inputs: string[] }[]) =>
  calls.flatMap((c) => c.inputs);

describe("pnpm embed", () => {
  it("только показ: оценка без запросов и файлов, клиент не нужен", async () => {
    const r = await run({ dryRun: true });
    expect(r.sets[0]).toMatchObject({
      bases: 3,
      withText: 3,
      missing: [],
      stop: [],
    });
    const [a, q] = r.models;
    expect(a?.sets[0]).toMatchObject({ cached: 0, todo: 3, written: false });
    expect(q?.sets[0]?.todo).toBe(3);
    const { texts } = await loadTexts([config], dataDir);
    const chars = (texts[0]?.items ?? []).reduce(
      (n, it) => n + it.text.length,
      0,
    );
    expect(r.estimate).toBeCloseTo(
      estimateRub(MODEL_A, chars) + estimateRub(MODEL_Q, chars),
      9,
    );
    expect(await exists(storeDir)).toBe(false);
    expect(formatEmbedReport(r)).toContain("к отправке 3");
  });

  it("без клиента отправлять нельзя", async () => {
    await expect(run()).rejects.toThrow(/клиент Polza не задан/);
  });

  it("отправляет только базовые иконки с описаниями и пишет векторы каждой модели", async () => {
    const fake = fakeEmbeddingClient();
    const r = await run({ client: fake.client });
    expect(hasStop(r)).toBe(false);
    const texts = sentTexts(fake.calls);
    expect(texts).toHaveLength(6);
    expect(texts.some((t) => t.startsWith("heart filled"))).toBe(false);
    // Модель a — пачки по 2: 2 + 1; модель q — одна пачка.
    expect(fake.calls.map((c) => [c.model, c.inputs.length])).toEqual([
      ["a", 2],
      ["a", 1],
      ["q", 3],
    ]);
    for (const model of TEST_MODELS) {
      const read = await readStore(storeDir, model, "demo");
      expect(read.kind).toBe("ok");
      if (read.kind !== "ok") continue;
      expect(read.store.index.rows.map((row) => row.name)).toEqual([
        "heart",
        "house",
        "star",
      ]);
      expect(read.store.vectors.length).toBe(3 * model.dims);
    }
    const a = r.models[0]?.sets[0];
    expect(a).toMatchObject({ computed: 3, stored: 3, written: true });
    expect(a?.spent).toMatchObject({ requests: 2, texts: 3, rub: 0.02 });
    expect(r.spent.rub).toBeCloseTo(0.03, 9);
  });

  it("повторный запуск ничего не отправляет и не переписывает файлы", async () => {
    await run({ client: fakeEmbeddingClient().client });
    const paths = storePaths(storeDir, MODEL_A, "demo");
    const before = await readFile(paths.vectors);
    const index = await readFile(paths.index, "utf8");
    const fake = fakeEmbeddingClient();
    const r = await run({ client: fake.client });
    expect(fake.calls).toHaveLength(0);
    expect(r.spent.rub).toBe(0);
    expect(r.models[0]?.sets[0]).toMatchObject({
      cached: 3,
      todo: 0,
      written: false,
    });
    expect(await readFile(paths.vectors)).toEqual(before);
    expect(await readFile(paths.index, "utf8")).toBe(index);
    // Расход в оглавлении — накопленный с первого прогона.
    expect(r.models[0]?.sets[0]?.total.texts).toBe(3);
  });

  it("поменялось одно описание — уходит ровно один текст, остальные векторы те же", async () => {
    await run({ client: fakeEmbeddingClient().client });
    const old = await readStore(storeDir, MODEL_A, "demo");
    await writeSet({ extra: { house: " с трубой" } });
    const fake = fakeEmbeddingClient();
    const r = await run({ client: fake.client, models: [MODEL_A] });
    expect(sentTexts(fake.calls)).toHaveLength(1);
    expect(sentTexts(fake.calls)[0]).toContain("с трубой");
    expect(r.models[0]?.sets[0]).toMatchObject({ cached: 2, computed: 1 });
    const now = await readStore(storeDir, MODEL_A, "demo");
    if (old.kind !== "ok" || now.kind !== "ok") throw new Error("нет векторов");
    const row = (v: Float32Array, i: number) =>
      Array.from(v.subarray(i * MODEL_A.dims, (i + 1) * MODEL_A.dims));
    expect(row(now.store.vectors, 0)).toEqual(row(old.store.vectors, 0)); // heart
    expect(row(now.store.vectors, 2)).toEqual(row(old.store.vectors, 2)); // star
    expect(row(now.store.vectors, 1)).not.toEqual(row(old.store.vectors, 1));
    expect(now.store.index.spent.texts).toBe(4);
  });

  it("пропавшая иконка уходит из векторов без запросов", async () => {
    await run({ client: fakeEmbeddingClient().client });
    const rest = Object.fromEntries(
      Object.entries(DEFAULT_BODIES).filter(([name]) => name !== "star"),
    );
    await writeSet({ bodies: rest });
    const fake = fakeEmbeddingClient();
    const r = await run({ client: fake.client });
    expect(fake.calls).toHaveLength(0);
    expect(r.models[0]?.sets[0]).toMatchObject({ stored: 2, written: true });
    const read = await readStore(storeDir, MODEL_A, "demo");
    if (read.kind !== "ok") throw new Error("нет векторов");
    expect(read.store.index.rows.map((x) => x.name)).toEqual([
      "heart",
      "house",
    ]);
  });

  it("иконка без описаний пропускается с подсказкой", async () => {
    await writeSet({ described: (n) => n === "heart" || n === "house" });
    const fake = fakeEmbeddingClient();
    const r = await run({ client: fake.client, models: [MODEL_Q] });
    expect(r.sets[0]).toMatchObject({ withText: 2, missing: ["star"] });
    expect(sentTexts(fake.calls)).toHaveLength(2);
    expect(formatEmbedReport(r)).toContain("сначала pnpm enrich demo");
  });

  it("оценка выше лимита — «СТОП», ничего не отправлено", async () => {
    const fake = fakeEmbeddingClient();
    const r = await run({ client: fake.client, maxRub: 1e-9 });
    expect(r.stop[0]).toMatch(/больше лимита .* поднимите --max-rub/);
    expect(fake.calls).toHaveLength(0);
    expect(await exists(storeDir)).toBe(false);
  });

  it("факт выше лимита — новые пачки не уходят, посчитанное сохраняется", async () => {
    const fake = fakeEmbeddingClient({ rub: 1 });
    const r = await run({
      client: fake.client,
      models: [{ ...MODEL_A, batchSize: 1 }],
      maxRub: 1.5,
      concurrency: 1,
    });
    expect(fake.calls).toHaveLength(2);
    expect(r.stop[0]).toMatch(/потрачено 2,00 ₽ — больше лимита 1,50 ₽/);
    expect(r.models[0]?.sets[0]).toMatchObject({ computed: 2, stored: 2 });
  });

  it("402 на второй пачке: векторы первой сохранены, остальные модели не идут", async () => {
    const fake = fakeEmbeddingClient({
      fail: (call) =>
        call === 2
          ? apiError("test/a: на балансе Polza не хватает денег", "run")
          : undefined,
    });
    const r = await run({ client: fake.client, concurrency: 1 });
    expect(r.stop).toEqual(["test/a: на балансе Polza не хватает денег"]);
    expect(hasStop(r)).toBe(true);
    expect(r.models[0]?.sets[0]).toMatchObject({ computed: 2, stored: 2 });
    expect(fake.calls.filter((c) => c.model === "q")).toHaveLength(0);
    expect(await exists(storePaths(storeDir, MODEL_Q, "demo").index)).toBe(
      false,
    );
  });

  it("отказ одной модели не мешает другой", async () => {
    const fake = fakeEmbeddingClient({
      fail: (_call, model) =>
        model.key === "a"
          ? apiError("test/a: запрос отклонён", "model")
          : undefined,
    });
    const r = await run({ client: fake.client });
    expect(r.models[0]?.stop).toEqual(["test/a: запрос отклонён"]);
    expect(r.models[1]?.stop).toEqual([]);
    expect(r.models[1]?.sets[0]).toMatchObject({ computed: 3, stored: 3 });
  });

  it("250 текстов: пачки 100/100/50; одновременно не больше 4 пачек", async () => {
    const bodies: Record<string, string> = {};
    for (let i = 0; i < 250; i++) {
      bodies[`i-${String(i).padStart(3, "0")}`] =
        `<circle cx="12" cy="12" r="${1 + i / 100}"/>`;
    }
    await writeSet({ bodies });
    const fake = fakeEmbeddingClient();
    await run({ client: fake.client, models: [MODEL_Q] });
    expect(fake.calls.map((c) => c.inputs.length)).toEqual([100, 100, 50]);
    const wide = fakeEmbeddingClient();
    await rm(storeDir, { recursive: true, force: true });
    await run({ client: wide.client, models: [{ ...MODEL_Q, batchSize: 10 }] });
    expect(wide.calls).toHaveLength(25);
    expect(wide.stats.maxInFlight).toBe(4);
  });

  it("векторы пишутся и по ходу — каждые 10 пачек", async () => {
    const bodies: Record<string, string> = {};
    for (let i = 0; i < 250; i++) {
      bodies[`i-${String(i).padStart(3, "0")}`] =
        `<circle cx="12" cy="12" r="${1 + i / 100}"/>`;
    }
    await writeSet({ bodies });
    const model = { ...MODEL_Q, batchSize: 10 };
    const fake = fakeEmbeddingClient();
    // Перед каждой пачкой — сколько векторов уже на диске: так видно запись по ходу.
    const onDisk: number[] = [];
    const client: EmbeddingClient = {
      async embed(m, inputs) {
        const head = await readIndex(storeDir, m, "demo");
        onDisk.push(head.kind === "ok" ? head.index.count : 0);
        return fake.client.embed(m, inputs);
      },
    };
    await run({ client, models: [model], concurrency: 1 });
    expect(onDisk).toHaveLength(25);
    expect(onDisk[9]).toBe(0);
    expect(onDisk[10]).toBe(100);
    expect(onDisk[20]).toBe(200);
    const read = await readStore(storeDir, model, "demo");
    expect(read.kind === "ok" && read.store.index.count).toBe(250);
  });

  it("модель на выбор пишет только свою папку", async () => {
    await run({ client: fakeEmbeddingClient().client, models: [MODEL_Q] });
    expect(await exists(join(storeDir, "q", "demo.f32"))).toBe(true);
    expect(await exists(join(storeDir, "a"))).toBe(false);
  });

  it("search.json не от этой сборки — «СТОП» набора", async () => {
    await writeSet({ stale: true });
    const r = await run({ client: fakeEmbeddingClient().client });
    expect(r.sets[0]?.stop[0]).toMatch(
      /search\.json не совпадает с icons\.json/,
    );
    expect(hasStop(r)).toBe(true);
  });

  it("сломанное оглавление — пересчёт с заметкой", async () => {
    await run({ client: fakeEmbeddingClient().client });
    await writeFile(storePaths(storeDir, MODEL_A, "demo").index, "мусор");
    const fake = fakeEmbeddingClient();
    const r = await run({ client: fake.client, models: [MODEL_A] });
    expect(sentTexts(fake.calls)).toHaveLength(3);
    expect(r.models[0]?.sets[0]?.notes[0]).toMatch(
      /оглавление векторов не читается — векторы посчитаются заново/,
    );
  });

  it("готовность и отчёты: таблица, CSP, без скриптов, экранирование", async () => {
    const r = await run({ client: fakeEmbeddingClient().client });
    const { texts } = await loadTexts([config], dataDir);
    const status = await embedStatus(texts, storeDir, TEST_MODELS);
    expect(status.map((m) => m.sets[0]?.fresh)).toEqual([3, 3]);
    expect(formatEmbedTable(status).split("\n")).toEqual([
      "Модель  demo  Всего",
      "a        3/3    3/3",
      "q        3/3    3/3",
    ]);
    const page = renderEmbedPage(r, status);
    expect(page).toContain(CSP);
    expect(page).not.toContain("<script");
    const heart = texts[0]?.set.icons.get("heart");
    const nearest = renderNearestPage({
      queries: ["<b>сердце</b>", "heart"],
      models: [
        {
          model: MODEL_A,
          results: [
            {
              query: "<b>сердце</b>",
              neighbors: [
                {
                  set: "demo",
                  name: "heart",
                  score: 0.9,
                  ...(heart ? { icon: heart } : {}),
                },
              ],
              ms: 120,
            },
          ],
          latencies: [120],
          vectors: 3,
          stale: 0,
          absent: 0,
          notes: [],
          stop: [],
        },
      ],
      errors: [],
      stop: [],
    });
    expect(nearest).toContain("&lt;b&gt;сердце&lt;/b&gt;");
    expect(nearest).not.toContain("<b>сердце</b>");
    expect(nearest).toContain("data:image/svg+xml;base64,");
    expect(nearest).not.toContain("<script");
    // Текст, который уходит модели, — тот же, что строит text.ts.
    const entry = texts[0]?.set.search.icons.heart;
    expect(texts[0]?.items[0]?.text).toBe(
      entry ? iconText("heart", entry) : "",
    );
  });
});
