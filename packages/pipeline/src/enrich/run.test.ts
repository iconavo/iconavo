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
import { MODEL, POLL_RETRIES, PROMPT_VERSION } from "./config.js";
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

const input = {
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
} satisfies SourceConfigInput;
const config = sourceConfigSchema.parse(input);
/** Второй набор — для случаев, где наборы не должны мешать друг другу. */
const config2 = sourceConfigSchema.parse({
  ...input,
  id: "demo2",
  name: "Demo 2",
  source: { type: "npm", package: "demo2-icons" },
});

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

const fp = (name: string, id = "demo", bodies = BODIES) =>
  fingerprint(id, name, {
    body: bodies[name] as string,
    width: 24,
    height: 24,
  });

async function writeSet(search?: SearchFile, id = "demo", bodies = BODIES) {
  const dir = join(dataDir, id);
  await mkdir(dir, { recursive: true });
  const icons = Object.fromEntries(
    Object.entries(bodies).map(([name, body]) => [name, { body }]),
  );
  await writeFile(
    join(dir, "icons.json"),
    canonicalJson({ prefix: id, icons, width: 24, height: 24 }),
  );
  const file: SearchFile = search ?? {
    prefix: id,
    icons: Object.fromEntries(
      Object.keys(bodies).map((name) => [
        name,
        { fingerprint: fp(name, id, bodies), tags: [name] },
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

const runSets = (
  configs: readonly (typeof config)[],
  options: Partial<EnrichOptions> = {},
) =>
  enrichSets(configs, dataDir, {
    stateDir,
    maxCost: 5,
    sleep: async () => {},
    ...options,
  });
const run = (options: Partial<EnrichOptions> = {}) =>
  runSets([config], options);

/** Пакет «прошлого запуска» в файле состояния набора demo. */
async function seedState(
  fake: ReturnType<typeof fakeBatchClient>,
  batchId: string,
  names: readonly string[],
) {
  fake.seed(batchId, names);
  await writeState(statePath(), {
    batchId,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    requests: Object.fromEntries(
      names.map((name) => [name, { name, fingerprint: fp(name) }]),
    ),
  });
}

/** Ошибка SDK с кодом ответа; без кода — как сбой сети. */
const apiError = (message: string, status?: number) =>
  Object.assign(new Error(message), status === undefined ? {} : { status });

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

  it("пакет одного набора не найден — «СТОП» только этого набора, остальные собираются (И-4)", async () => {
    await writeSet(undefined, "demo2");
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    await writeState(statePath(), {
      batchId: "msgbatch_missing",
      model: MODEL,
      promptVersion: 1,
      requests: { heart: { name: "heart", fingerprint: fp("heart") } },
    });
    const [a, b] = await runSets([config, config2], { client: fake.client });
    expect(a?.stop).toEqual([
      expect.stringMatching(
        /^пакет msgbatch_missing набора demo не найден — удалите .+batch\.json, если он уже не нужен$/,
      ),
    ]);
    expect(a?.written).toBe(false);
    expect(await exists(statePath())).toBe(true);
    expect(b).toMatchObject({ sent: 3, succeeded: 3, written: true, stop: [] });
  });

  it("ключ не принят при опросе — «СТОП» без повторов, состояние на месте (И-1)", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    await seedState(fake, "msgbatch_old", ["heart"]);
    let sleeps = 0;
    const client = {
      ...fake.client,
      retrieve: async () => {
        throw apiError("invalid x-api-key", 401);
      },
    };
    const [r] = await run({
      client,
      sleep: async () => {
        if (++sleeps > 2) throw new Error("опрос повторяется без конца");
      },
    });
    expect(r?.stop).toEqual([
      expect.stringMatching(/^ключ ANTHROPIC_API_KEY не принят \(HTTP 401\)/),
    ]);
    expect(sleeps).toBe(0);
    expect(await exists(statePath())).toBe(true);
  });

  it("запрос опроса отклонён — «СТОП» набора с причиной (И-1)", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    await seedState(fake, "msgbatch_old", ["heart"]);
    const client = {
      ...fake.client,
      retrieve: async () => {
        throw apiError("bad request", 400);
      },
    };
    const [r] = await run({
      client,
      sleep: async () => {
        throw new Error("опрос повторяется");
      },
    });
    expect(r?.stop).toEqual([
      expect.stringMatching(
        /^опрос пакета msgbatch_old отклонён \(HTTP 400: bad request\)/,
      ),
    ]);
    expect(await exists(statePath())).toBe(true);
  });

  it("сбой опроса повторяется, но не больше POLL_RETRIES раз подряд (И-1)", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    await seedState(fake, "msgbatch_old", ["heart"]);
    // Два сбоя сети подряд, затем ответ — пакет забран.
    let failures = 2;
    const flaky = {
      ...fake.client,
      retrieve: async (id: string) => {
        if (failures-- > 0) throw apiError("Connection error.");
        return fake.client.retrieve(id);
      },
    };
    const [ok] = await run({ client: flaky });
    expect(ok).toMatchObject({ written: true, stop: [] });

    await seedState(fake, "msgbatch_down", ["star"]);
    const sleeps: number[] = [];
    const down = {
      ...fake.client,
      retrieve: async () => {
        throw apiError("Internal server error", 500);
      },
    };
    const [r] = await run({
      client: down,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length > POLL_RETRIES) {
          throw new Error("опрос повторяется без конца");
        }
      },
    });
    expect(r?.stop).toEqual([
      expect.stringMatching(
        new RegExp(
          `^опрос пакета msgbatch_down не удаётся ${POLL_RETRIES} раз подряд \\(Internal server error\\)`,
        ),
      ),
    ]);
    expect(sleeps).toHaveLength(POLL_RETRIES - 1);
    expect(await exists(statePath())).toBe(true);
  });

  it("оценка выше лимита не мешает забрать пакет, оплаченный в прошлый раз (И-13)", async () => {
    await writeSet(undefined, "demo2");
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    await seedState(fake, "msgbatch_old", BASES);
    const [a, b] = await runSets([config, config2], {
      client: fake.client,
      maxCost: 0.000001,
    });
    expect(a).toMatchObject({
      resumed: true,
      succeeded: 3,
      written: true,
      stop: [],
    });
    expect(b?.stop[0]).toMatch(/больше лимита \$0,0000 — поднимите --max-cost/);
    expect(fake.calls.create).toBe(0);
  });

  it("--no-wait забирает готовый пакет прошлого запуска (И-2)", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
      inProgress: 1,
    });
    const [sent] = await run({ client: fake.client, wait: false });
    expect(sent).toMatchObject({
      sent: 3,
      waiting: "msgbatch_1",
      written: false,
    });
    expect(fake.calls.retrieve).toBe(0);
    // Пакет ещё в работе — один опрос, без пауз.
    const [busy] = await run({
      client: fake.client,
      wait: false,
      sleep: async () => {
        throw new Error("пауза в --no-wait");
      },
    });
    expect(busy).toMatchObject({
      resumed: true,
      waiting: "msgbatch_1",
      written: false,
    });
    expect(fake.calls.retrieve).toBe(1);
    // Готов — записывается сразу.
    const [ready] = await run({ client: fake.client, wait: false });
    expect(fake.calls).toEqual({ create: 1, retrieve: 2, results: 1 });
    expect(ready).toMatchObject({ resumed: true, succeeded: 3, written: true });
    expect(ready?.waiting).toBeUndefined();
    expect(await exists(statePath())).toBe(false);
  });

  it("search.json, обновлённый, пока пакет в работе, не затирается (И-3)", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
      inProgress: 1,
    });
    const [r] = await run({
      client: fake.client,
      sleep: async () => {
        // Пока ждём пакет, набор обновили (git pull, pnpm data): у heart новый тег.
        const search = await readSearch();
        (search.icons.heart as { tags: string[] }).tags.push("love");
        await writeSet(search);
      },
    });
    expect(r?.written).toBe(true);
    const search = await readSearch();
    expect(search.icons.heart?.tags).toEqual(["heart", "love"]);
    expect(search.icons.heart?.ru?.description).toBe("ru: heart.");
  });

  it("иконка, которую не нарисовать, — в отказах, остальные уходят (И-15)", async () => {
    const bodies = { ...BODIES, star: `<path d="M0 0"` };
    await writeSet(undefined, "demo", bodies);
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    const [r] = await run({ client: fake.client });
    expect(
      fake.batches.get("msgbatch_1")?.requests.map((q) => q.custom_id),
    ).toEqual(["heart", "house"]);
    expect(r?.failed).toEqual([
      {
        name: "star",
        reason: expect.stringMatching(/^не нарисовалась для модели/),
      },
    ]);
    expect(r).toMatchObject({ sent: 2, succeeded: 2, written: true, stop: [] });
  });

  it("испорченный файл состояния — понятная ошибка с подсказкой (И-14)", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    await mkdir(join(stateDir, "demo"), { recursive: true });
    await writeFile(statePath(), `{"batchId":`);
    const [r] = await run({ client: fake.client });
    expect(r?.stop).toEqual([
      expect.stringMatching(
        /^файл состояния пакета .+batch\.json повреждён — удалите его, если пакет уже не нужен$/,
      ),
    ]);
    expect(fake.calls.create).toBe(0);
  });

  it("номер отправленного пакета — в журнале ещё до записи состояния (И-14)", async () => {
    const fake = fakeBatchClient({
      answer: (req) => goodAnswer(req.custom_id),
    });
    // На месте файла состояния — папка: записать его нельзя.
    await mkdir(statePath(), { recursive: true });
    const lines: string[] = [];
    await expect(
      run({ client: fake.client, log: (line) => lines.push(line) }),
    ).rejects.toThrow();
    expect(lines).toContain("demo: отправлено 3 — пакет msgbatch_1");
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
