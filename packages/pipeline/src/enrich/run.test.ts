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
import { type SearchFile, validate } from "@iconavo-ui/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, type Json } from "../build/json.js";
import { fingerprint } from "../metadata/fingerprint.js";
import { licenseHash } from "../metadata/license.js";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import {
  type BatchResult,
  readState,
  STATE_FILE,
  writeState,
} from "./batch.js";
import { fakeBatchClient, goodAnswer } from "./batch.testing.js";
import { MODEL, PROMPT_VERSION } from "./config.js";
import { estimateCost } from "./cost.js";
import {
  formatEnrichReport,
  formatEnrichTable,
  renderEnrichPage,
} from "./report.js";
import { type EnrichOptions, enrichSets } from "./run.js";

const BODIES: Record<string, string> = {
  heart: `<path fill="currentColor" d="M4 4h16v16H4z"/>`,
  "heart-filled": `<path fill="currentColor" d="M2 2h20v20H2z"/>`,
  star: `<circle cx="12" cy="12" r="8" fill="currentColor"/>`,
  house: `<path fill="currentColor" d="M12 2 2 12h3v10h14V12h3z"/>`,
};
const BASES = ["heart", "house", "star"];

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
let stateDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-enrich-"));
  dataDir = join(root, "data");
  stateDir = join(root, "state");
  await writeSet();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const fp = (name: string) =>
  fingerprint("demo", name, {
    body: BODIES[name] as string,
    width: 24,
    height: 24,
  });

async function writeSet(search?: SearchFile) {
  const dir = join(dataDir, "demo");
  await mkdir(dir, { recursive: true });
  const icons = Object.fromEntries(
    Object.entries(BODIES).map(([name, body]) => [name, { body }]),
  );
  await writeFile(
    join(dir, "icons.json"),
    canonicalJson({ prefix: "demo", icons, width: 24, height: 24 }),
  );
  const file: SearchFile = search ?? {
    prefix: "demo",
    icons: Object.fromEntries(
      Object.keys(BODIES).map((name) => [
        name,
        { fingerprint: fp(name), tags: [name] },
      ]),
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

const searchPath = () => join(dataDir, "demo", "search.json");
const statePath = () => join(stateDir, "demo", STATE_FILE);
const readSearch = async () =>
  JSON.parse(await readFile(searchPath(), "utf8")) as SearchFile;
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const run = (options: Partial<EnrichOptions> = {}) =>
  enrichSets([config], dataDir, {
    stateDir,
    maxCost: 5,
    sleep: async () => {},
    ...options,
  });

describe("pnpm enrich", () => {
  it("только показ: считает выборку и оценку, ничего не отправляет и не пишет", async () => {
    const before = await readFile(searchPath(), "utf8");
    const [r] = await run({ dryRun: true });
    expect(r).toMatchObject({
      bases: 3,
      enrichedBefore: 0,
      sample: 3,
      selected: 3,
      sent: 0,
      written: false,
      stop: [],
    });
    expect(r?.estimate).toBeCloseTo(estimateCost(3), 9);
    expect(r?.cards.map((c) => c.status)).toEqual([
      "planned",
      "planned",
      "planned",
    ]);
    expect(await readFile(searchPath(), "utf8")).toBe(before);
    expect(await exists(statePath())).toBe(false);
    expect(formatEnrichReport(r as never)).toContain("Оценка стоимости");
  });

  it("без клиента отправлять нельзя", async () => {
    await expect(run()).rejects.toThrow(/клиент Claude API не задан/);
  });

  it("отправляет базовые без описаний, ждёт пакет, пишет search.json и убирает состояние", async () => {
    const sleeps: number[] = [];
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
      inProgress: 1,
    });
    const [r] = await run({
      client: fake.client,
      pollIntervalMs: 7,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([7]);
    expect(fake.calls).toEqual({ create: 1, retrieve: 2, results: 1 });
    const batch = fake.batches.get("msgbatch_1");
    expect(batch?.requests.map((q) => q.custom_id)).toEqual(BASES);
    const content = batch?.requests[0]?.params.messages[0]?.content;
    expect(Array.isArray(content) && content[0]).toMatchObject({
      type: "image",
    });

    expect(r).toMatchObject({
      sent: 3,
      succeeded: 3,
      failed: [],
      enrichedAfter: 3,
      written: true,
      resumed: false,
      stop: [],
    });
    expect(r?.cost).toMatchObject({ requests: 3, input: 2400, output: 1200 });
    expect(r?.cost?.usd).toBeGreaterThan(0);
    const search = await readSearch();
    expect(validate("search", search)).toEqual([]);
    for (const name of BASES) {
      expect(search.icons[name]?.ru?.description).toBe(`ru: ${name}.`);
      expect(search.icons[name]?.promptVersion).toBe(PROMPT_VERSION);
    }
    expect(search.icons["heart-filled"]).not.toHaveProperty("ru");
    expect(await exists(statePath())).toBe(false);
    // Карточки: все три отправлены сейчас, с PNG для модели.
    expect(r?.cards.map((c) => [c.name, c.status])).toEqual(
      BASES.map((n) => [n, "sent"]),
    );
    for (const card of r?.cards ?? []) {
      expect(card.png?.subarray(0, 4)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      );
      expect(card.usage).toEqual({ input_tokens: 800, output_tokens: 400 });
    }
    expect(formatEnrichReport(r as never)).toContain(
      "отправлено 3 · получено 3",
    );
    expect(formatEnrichTable([r as never])).toMatch(/^Набор/);
    const page = renderEnrichPage([r as never], { bases: 3, enriched: 3 });
    expect(page).toContain("Content-Security-Policy");
    expect(page).toContain("data:image/png;base64,");
    expect(page).toContain("demo:heart");
    expect(page).not.toContain("<script");

    // Повторный запуск: отправлять нечего, всё из кэша.
    const [again] = await run({ client: fake.client });
    expect(fake.calls.create).toBe(1);
    expect(again).toMatchObject({ selected: 0, sent: 0, written: false });
    expect(again?.cards.map((c) => c.status)).toEqual([
      "cached",
      "cached",
      "cached",
    ]);
    // Итог последнего платного прогона и PNG — и у карточек из кэша.
    expect(again?.last).toMatchObject({
      batchId: "msgbatch_1",
      sent: 3,
      succeeded: 3,
      failed: 0,
      cost: { requests: 3, input: 2400, output: 1200 },
    });
    expect(again?.cards.every((c) => c.png !== undefined)).toBe(true);
    expect(formatEnrichReport(again as never)).toContain(
      "Последний прогон с отправкой",
    );
    expect(
      renderEnrichPage([again as never], { bases: 3, enriched: 3 }),
    ).toContain("Последний прогон с отправкой");
  });

  it("лимит: постоянная выборка, второй запуск с тем же лимитом ничего не отправляет", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    const [first] = await run({ client: fake.client, limit: 2 });
    expect(first).toMatchObject({
      sample: 2,
      selected: 2,
      sent: 2,
      succeeded: 2,
    });
    const [second] = await run({ client: fake.client, limit: 2 });
    expect(fake.calls.create).toBe(1);
    expect(second).toMatchObject({ sample: 2, selected: 0, sent: 0 });
    expect(second?.cards.map((c) => c.status)).toEqual(["cached", "cached"]);
  });

  it("оценка выше лимита — «СТОП» до отправки", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    const before = await readFile(searchPath(), "utf8");
    const [r] = await run({ client: fake.client, maxCost: 0.000001 });
    expect(r?.stop[0]).toMatch(/больше лимита \$0,0000 — поднимите --max-cost/);
    expect(fake.calls.create).toBe(0);
    expect(await readFile(searchPath(), "utf8")).toBe(before);
  });

  it("--no-wait сохраняет состояние, следующий запуск продолжает пакет без новой отправки", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    const before = await readFile(searchPath(), "utf8");
    const [sent] = await run({ client: fake.client, wait: false });
    expect(sent).toMatchObject({
      sent: 3,
      waiting: "msgbatch_1",
      written: false,
    });
    expect(sent?.cards.map((c) => c.status)).toEqual([
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(await readFile(searchPath(), "utf8")).toBe(before);
    const state = await readState(statePath());
    expect(state).toMatchObject({
      batchId: "msgbatch_1",
      model: MODEL,
      promptVersion: PROMPT_VERSION,
    });
    expect(Object.keys(state?.requests ?? {})).toEqual(BASES);

    const [resumed] = await run({ client: fake.client, limit: 1 });
    expect(fake.calls.create).toBe(1);
    expect(resumed).toMatchObject({
      resumed: true,
      sent: 3,
      succeeded: 3,
      written: true,
    });
    expect(await exists(statePath())).toBe(false);
    expect((await readSearch()).icons.star?.en).toBeDefined();
  });

  it("отказы не сохраняются и отправляются в следующий раз", async () => {
    const fake = fakeBatchClient({
      answer: (req): BatchResult => {
        if (req.custom_id === "star") {
          return {
            type: "errored",
            error: { error: { type: "invalid_request_error", message: "bad" } },
          };
        }
        if (req.custom_id === "house") {
          return {
            type: "succeeded",
            message: {
              content: [],
              stop_reason: "refusal",
              stop_details: { category: "general_harms" },
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          };
        }
        return goodAnswer(req.custom_id);
      },
    });
    const [r] = await run({ client: fake.client });
    expect(r).toMatchObject({
      sent: 3,
      succeeded: 1,
      written: true,
      enrichedAfter: 1,
    });
    expect(r?.failed).toEqual([
      { name: "house", reason: "отказ модели (general_harms)" },
      { name: "star", reason: "ошибка запроса invalid_request_error: bad" },
    ]);
    // За отказ модели платят, за ошибку пакета — нет.
    expect(r?.cost).toMatchObject({ requests: 2, input: 810 });
    expect(r?.cards.map((c) => [c.name, c.status])).toEqual([
      ["house", "failed"],
      ["star", "failed"],
      ["heart", "sent"],
    ]);
    const search = await readSearch();
    expect(search.icons.heart?.ru).toBeDefined();
    expect(search.icons.star).not.toHaveProperty("ru");
    const [next] = await run({ client: fake.client, dryRun: true });
    expect(next).toMatchObject({ selected: 2 });
  });

  it("при продолжении результат иконки с изменившимся рисунком отбрасывается", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    fake.seed("msgbatch_old", ["heart", "star"]);
    await writeState(statePath(), {
      batchId: "msgbatch_old",
      model: MODEL,
      promptVersion: 1,
      requests: {
        heart: { name: "heart", fingerprint: "000000000000" },
        star: { name: "star", fingerprint: fp("star") },
      },
    });
    const [r] = await run({ client: fake.client });
    expect(fake.calls.create).toBe(0);
    expect(r?.failed).toEqual([
      {
        name: "heart",
        reason: "рисунок изменился после отправки — отправится снова",
      },
    ]);
    const search = await readSearch();
    expect(search.icons.star?.ru).toBeDefined();
    expect(search.icons.heart).not.toHaveProperty("ru");
    expect(await exists(statePath())).toBe(false);
  });

  it("пакет из состояния не найден — понятная ошибка", async () => {
    const fake = fakeBatchClient({ answer: () => undefined });
    await writeState(statePath(), {
      batchId: "msgbatch_missing",
      model: MODEL,
      promptVersion: 1,
      requests: { heart: { name: "heart", fingerprint: fp("heart") } },
    });
    await expect(run({ client: fake.client })).rejects.toThrow(
      /пакет msgbatch_missing набора demo не найден — удалите/,
    );
  });

  it("search.json не от этой сборки или его нет — «СТОП» с подсказкой, ничего не отправляется", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    const stale = await readSearch();
    (stale.icons.heart as { fingerprint: string }).fingerprint = "000000000000";
    await writeSet(stale);
    const [r] = await run({ client: fake.client });
    expect(r?.stop[0]).toMatch(
      /не совпадает с icons\.json \(«heart»\) — запустите pnpm data demo/,
    );
    expect(fake.calls.create).toBe(0);
    await rm(searchPath());
    const [missing] = await run({ client: fake.client });
    expect(missing?.stop[0]).toMatch(/search\.json не читается/);
  });
});
