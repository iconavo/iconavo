import { readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiError } from "../embed/client.js";
import { fakeJudgeClient } from "./client.testing.js";
import { CHUNK_SIZE } from "./config.js";
import { config, type Env, rule, setupEnv } from "./env.testing.js";
import { type GoldenQuery, type Judgments, judgmentsSchema } from "./golden.js";
import {
  agreementOf,
  judgeEval,
  pilotSample,
  repeatPair,
  shuffle,
} from "./judge.js";

let env: Env;
beforeEach(async () => {
  env = await setupEnv("iconavo-judge-");
});
afterEach(async () => {
  await rm(env.root, { recursive: true, force: true });
});

const readJ = async (path: string) =>
  judgmentsSchema.parse(JSON.parse(await readFile(path, "utf8"))) as Judgments;

describe("выборки", () => {
  it("пилот — по запросу на ячейку «язык × тип», бо́льшая выборка включает меньшую", () => {
    const qs: GoldenQuery[] = ["ru", "en"].flatMap((lang) =>
      ["object", "action"].flatMap((type) =>
        [1, 2, 3].map((n) => ({
          id: `${lang}-${type}-${n}`,
          query: "q",
          lang: lang as GoldenQuery["lang"],
          type: type as GoldenQuery["type"],
          description: "d",
          split: "work" as const,
        })),
      ),
    );
    const four = pilotSample(qs, 4);
    expect(new Set(four.map((q) => `${q.lang}/${q.type}`)).size).toBe(4);
    const eight = pilotSample(qs, 8);
    expect(four.every((q) => eight.includes(q))).toBe(true);
    expect(pilotSample(qs, 100)).toHaveLength(qs.length);
  });

  it("перемешивание и повторная разметка — постоянный случай", () => {
    const list = ["a", "b", "c", "d", "e"];
    expect(shuffle(list, "s")).toEqual(shuffle(list, "s"));
    expect([...shuffle(list, "s")].sort()).toEqual(list);
    expect(repeatPair("ru-001", "demo:trash")).toBe(
      repeatPair("ru-001", "demo:trash"),
    );
  });

  it("согласие судьи с собой — по парам с повтором", () => {
    const j: Judgments = {
      judge: { model: "m", promptVersion: 1 },
      queries: {
        x: {
          query: "q",
          description: "d",
          icons: {
            "s:a": {
              verdict: "fits",
              fingerprint: "000000000000",
              repeat: "fits",
            },
            "s:b": {
              verdict: "partial",
              fingerprint: "000000000000",
              repeat: "no",
            },
            "s:c": { verdict: "no", fingerprint: "000000000000" },
          },
        },
      },
    };
    expect(agreementOf(j)).toEqual({ pairs: 2, same: 1, sameFits: 2 });
  });
});

describe("pnpm judge", () => {
  it("пробный прогон — оценка без запросов к судье и без записи", async () => {
    const fake = fakeJudgeClient();
    const r = await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fake.client,
      dryRun: true,
    });
    expect(fake.calls).toHaveLength(0);
    expect(r.rounds[0]?.pending).toBeGreaterThan(0);
    expect(r.rounds[0]?.estimate).toBeGreaterThan(0);
    await expect(readFile(env.options.judgmentsPath)).rejects.toThrow();
  });

  it("размечает всё из первых мест; повторный запуск ничего не отправляет", async () => {
    const fake = fakeJudgeClient({ verdict: rule });
    const r = await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fake.client,
    });
    expect(r.stop).toEqual([]);
    expect(r.pending).toBe(0);
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call.images).toBe(call.names.length);
      expect(call.names.length).toBeLessThanOrEqual(CHUNK_SIZE);
      // Имена — без набора.
      expect(call.names.every((n) => !n.includes(":"))).toBe(true);
    }
    const j = await readJ(env.options.judgmentsPath);
    expect(j.queries["ru-001"]?.query).toBe("корзина");
    expect(j.queries["ru-001"]?.icons["demo:trash"]?.verdict).toBe("fits");
    expect(j.queries["ru-001"]?.icons["demo:shopping-cart"]?.verdict).toBe(
      "partial",
    );
    expect(j.queries["en-003"]?.icons["demo:trash"]?.verdict).toBe("no");
    expect(j.spent?.requests).toBe(r.spent.requests);

    const again = fakeJudgeClient({ verdict: rule });
    const r2 = await judgeEval([config], env.dataDir, {
      ...env.options,
      client: again.client,
    });
    expect(again.calls).toHaveLength(0);
    expect(r2.judged).toBe(0);
  });

  it("правки владельца главнее: их пары судье не отправляются", async () => {
    await writeFile(
      env.options.overridesPath,
      JSON.stringify({ "ru-001": { "demo:heart": "fits" } }),
    );
    const fake = fakeJudgeClient({ verdict: rule });
    const r = await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fake.client,
    });
    expect(r.labels.byQuery.get("ru-001")?.get("demo:heart")).toBe("fits");
    const j = await readJ(env.options.judgmentsPath);
    expect(j.queries["ru-001"]?.icons["demo:heart"]).toBeUndefined();
  });

  it("оценка выше лимита — ничего не отправляется", async () => {
    const fake = fakeJudgeClient();
    const r = await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fake.client,
      maxRub: 0.0001,
    });
    expect(fake.calls).toHaveLength(0);
    expect(r.stop[0]).toMatch(/больше лимита/);
  });

  it("ключ не подошёл — остановка; разобранное до этого сохранено", async () => {
    const fake = fakeJudgeClient({
      verdict: rule,
      fail: (call) =>
        call === 2
          ? apiError("test: ключ POLZA_API_KEY не подошёл", "run")
          : undefined,
    });
    const r = await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fake.client,
      concurrency: 1,
    });
    expect(r.stop).toEqual(["test: ключ POLZA_API_KEY не подошёл"]);
    expect(fake.calls).toHaveLength(2);
    const j = await readJ(env.options.judgmentsPath);
    expect(Object.keys(j.queries)).toHaveLength(1);
  });

  it("неразборчивый ответ — повтор, затем пары остаются на следующий запуск", async () => {
    const fake = fakeJudgeClient({ answer: () => "не JSON" });
    const r = await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fake.client,
    });
    expect(r.failures.length).toBeGreaterThan(0);
    expect(fake.calls).toHaveLength(2 * r.failures.length);
    expect(r.pending).toBeGreaterThan(0);
    expect(r.stop).toEqual([]);
  });

  it("пилот — только выбранные запросы", async () => {
    const fake = fakeJudgeClient({ verdict: rule });
    const r = await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fake.client,
      limit: 2,
    });
    // По одному запросу из ячеек ru/object и en/object.
    expect(r.queries.map((q) => q.lang).sort()).toEqual(["en", "ru"]);
    expect(r.queries.every((q) => q.type === "object")).toBe(true);
    // Пилот не подбирает α: размечена не вся рабочая часть.
    expect(r.tuned).toBeUndefined();
  });
});
