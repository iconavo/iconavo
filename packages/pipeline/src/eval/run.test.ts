import { rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeJudgeClient } from "./client.testing.js";
import { config, type Env, rule, setupEnv } from "./env.testing.js";
import { judgeEval } from "./judge.js";
import { baselineJson, formatEvalReport, renderEvalPage } from "./report.js";
import { evaluate } from "./run.js";

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
