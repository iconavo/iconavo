import { rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeJudgeClient } from "./client.testing.js";
import { config, type Env, rule, setupEnv } from "./env.testing.js";
import { judgeEval } from "./judge.js";
import { baselineJson, formatEvalReport, renderEvalPage } from "./report.js";
import {
  type DeviceCurve,
  diagnose,
  evaluate,
  pickDevice,
  type WorstEntry,
  worstOrder,
} from "./run.js";

let env: Env;
beforeEach(async () => {
  env = await setupEnv("iconavo-eval-");
});
afterEach(async () => {
  await rm(env.root, { recursive: true, force: true });
});

const evalOptions = (e: Env) => ({
  queriesPath: e.options.queriesPath,
  judgmentsPath: e.options.judgmentsPath,
  overridesPath: e.options.overridesPath,
  storeDir: e.options.storeDir,
  queryDir: e.options.queryDir,
  ...(e.options.embedClient ? { embedClient: e.options.embedClient } : {}),
  models: e.options.models ?? [],
});

async function judgeAll() {
  await judgeEval([config], env.dataDir, {
    ...env.options,
    client: fakeJudgeClient({ verdict: rule }).client,
  });
}

describe("диагноз худших запросов (ADR-0053)", () => {
  it.each([
    [0, {}, "ceiling"],
    [0, { service: 1 }, "ceiling"],
    [2, { service: 3 }, "weak"],
    [2, { service: 5, words: 1 }, "weak"],
    [2, { service: 12, words: 4 }, "words"],
    [2, { words: 10 }, "words"],
    [2, { service: 12 }, "near"],
    [2, { meaning: 18 }, "near"],
    [2, { words: 20 }, "near"],
    [2, { service: 25, words: 40, meaning: 21 }, "missing"],
    [2, {}, "missing"],
  ] as const)("подходящих %i, места %j → %s", (fits, at, expected) => {
    expect(diagnose(fits, at)).toBe(expected);
  });

  it("порядок: подходящей нет в 30 местах — первыми, затем по месту, затем по id", () => {
    const entry = (id: string, service?: number): WorstEntry => ({
      query: {
        id,
        query: id,
        lang: "ru",
        type: "object",
        description: "",
        split: "work",
      },
      fits: ["a:x"],
      ranked: [],
      at: service === undefined ? {} : { service },
      partials: 0,
      diagnosis: diagnose(1, service === undefined ? {} : { service }),
    });
    const sorted = [
      entry("ru-003", 2),
      entry("ru-002"),
      entry("ru-004", 9),
      entry("ru-001"),
    ].sort(worstOrder);
    expect(sorted.map((e) => e.query.id)).toEqual([
      "ru-001",
      "ru-002",
      "ru-004",
      "ru-003",
    ]);
  });
});

describe("выбор устройства в опыте этапа 2 (ADR-0053)", () => {
  const curve = (
    device: DeviceCurve["device"],
    hits: number,
    mrr = 0.7,
    x = 0.5,
  ): DeviceCurve => ({
    device,
    title: device,
    tuned: { alpha: x, curve: [{ alpha: x, hit: hits / 100, mrr }] },
    hits,
    mrr,
  });

  it("более сложное побеждает только с запасом в 2 попадания", () => {
    expect(
      pickDevice([curve("now", 81), curve("m", 82), curve("c-abs", 82)])
        ?.device,
    ).toBe("now");
    expect(
      pickDevice([curve("now", 81), curve("m", 83), curve("c-abs", 84)])
        ?.device,
    ).toBe("m");
    expect(
      pickDevice([curve("now", 81), curve("m", 83), curve("c-abs", 85)])
        ?.device,
    ).toBe("c-abs");
    // M не победил — сумма сравнивается с «как сейчас».
    expect(
      pickDevice([curve("now", 81), curve("m", 82), curve("c-rel", 83)])
        ?.device,
    ).toBe("c-rel");
  });

  it("суммы одной сложности: попадания, затем MRR, затем «как есть»", () => {
    expect(
      pickDevice([
        curve("now", 80),
        curve("c-abs", 84, 0.7),
        curve("c-rel", 84, 0.8),
      ])?.device,
    ).toBe("c-rel");
    expect(
      pickDevice([
        curve("now", 80),
        curve("c-abs", 84, 0.8),
        curve("c-rel", 84, 0.8),
      ])?.device,
    ).toBe("c-abs");
  });

  it("неразмеченное устройство не участвует", () => {
    expect(
      pickDevice([{ device: "now", title: "now" }, curve("m", 84)])?.device,
    ).toBe("m");
    expect(pickDevice([{ device: "now", title: "now" }])).toBeUndefined();
  });
});

describe("pnpm eval", () => {
  it("без разметки — цифр нет, подсказка pnpm judge", async () => {
    const r = await evaluate([config], env.dataDir, evalOptions(env));
    expect(r.stop).toEqual(["разметки нет — запустите pnpm judge"]);
    expect(renderEvalPage(r)).toContain("разметки нет");
  });

  it("неполная разметка — «СТОП» с числом пар", async () => {
    await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fakeJudgeClient({ verdict: rule }).client,
      limit: 2,
    });
    const r = await evaluate([config], env.dataDir, evalOptions(env));
    expect(r.stop[0]).toMatch(/не размечено пар: \d+ — запустите pnpm judge/);
    expect(r.main).toEqual([]);
  });

  it("полная разметка — цифры по вариантам; без подходящей иконки — потолок", async () => {
    await judgeAll();
    const r = await evaluate([config], env.dataDir, evalOptions(env));
    expect(r.stop).toEqual([]);
    expect(r.unlabeled).toBe(0);
    expect(r.ceiling.map((q) => q.id)).toEqual(["en-003"]);
    expect(r.included).toHaveLength(4);
    expect(r.main.map((m) => m.system.key)).toEqual([
      "text",
      "vector:a",
      "hybrid:a",
    ]);
    // Текстовая часть с точным именем находит все четыре запроса.
    const text = r.main[0];
    expect(text?.groups.all.all).toMatchObject({ n: 4, hits: 4 });
    expect(text?.groups.holdout.ru.n).toBe(1);
    // Строго — все 5 запросов, «потолок» en-003 — промах.
    expect(text?.strict.all.all).toMatchObject({ n: 5, hits: 4 });
    expect(r.tuned?.get("a")?.curve).toHaveLength(11);
    expect(r.recommendation?.leader).toBe("a");
    // Наборы в пятёрке лидера — по имеющейся разметке.
    expect(r.setShares?.model).toBe("a");
    expect(r.setShares?.sets[0]).toMatchObject({ set: "demo", docs: 5 });
    expect(r.setShares?.sets[0]?.slotFits).toBeGreaterThan(0);
    // Промахи — только рабочая часть.
    expect(r.misses.every((m) => m.query.split === "work")).toBe(true);
    expect(formatEvalReport(r)).toContain("Hit@5");
    const base = baselineJson(r) as {
      systems: Record<string, unknown>;
      queries: Record<string, Record<string, string[]>>;
    };
    expect(Object.keys(base.systems)).toEqual(["text", "vector:a", "hybrid:a"]);
    expect(base.queries["en-001"]?.text?.[0]).toBe("demo:trash");
    expect(renderEvalPage(r)).toContain("Контрольная часть");
  });

  it("правки контрольной части не меняют подбор α", async () => {
    await judgeAll();
    const before = await evaluate([config], env.dataDir, evalOptions(env));
    await writeFile(
      env.options.overridesPath,
      JSON.stringify({
        "ru-002": { "demo:house": "no", "demo:heart": "fits" },
        "en-002": { "demo:house": "no", "demo:heart": "fits" },
      }),
    );
    const after = await evaluate([config], env.dataDir, evalOptions(env));
    expect(after.tuned?.get("a")?.alpha).toBe(before.tuned?.get("a")?.alpha);
    expect(after.tuned?.get("a")?.curve).toEqual(before.tuned?.get("a")?.curve);
  });
});
