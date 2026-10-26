import { rm } from "node:fs/promises";
import { SEMANTIC_RATIO } from "@iconavo-ui/search";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbeddingClient } from "../embed/client.testing.js";
import { searchDocuments } from "../meili/docs.js";
import { fakeMeili } from "../meili/fake.testing.js";
import { loadCatalog } from "../search/catalog.js";
import { fakeJudgeClient } from "./client.testing.js";
import { ALPHA_GRID } from "./config.js";
import { config, type Env, rule, setupEnv } from "./env.testing.js";
import { readQueries } from "./golden.js";
import { judgeEval } from "./judge.js";
import { formatEvalReport, renderEvalPage } from "./report.js";
import { evaluate } from "./run.js";
import { serviceKey, serviceLists } from "./service.js";
import { SERVICE_KEY, SERVICE_TEXT_KEY } from "./systems.js";

let env: Env;
beforeEach(async () => {
  env = await setupEnv("iconavo-service-");
});
afterEach(async () => {
  await rm(env.root, { recursive: true, force: true });
});

/** Подменный Meilisearch с документами набора demo из env. */
async function seededMeili(extra: Record<string, unknown>[] = []) {
  const meili = fakeMeili();
  const { catalog } = await loadCatalog([config], env.dataDir);
  const docs = searchDocuments(
    catalog,
    new Map([["demo", { palette: false, license: "MIT", order: 0 }]]),
  );
  for (const d of [...docs, ...extra]) {
    meili.docs.set(String(d.id), { ...d });
  }
  return { meili, catalog };
}

describe("serviceLists", () => {
  it("списки «только слова» и гибрида при каждой доле смысла; точное имя первым", async () => {
    const { meili, catalog } = await seededMeili();
    const queries = await readQueries(env.options.queriesPath);
    const s = await serviceLists({
      client: meili.client,
      catalog,
      queries,
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
    });
    expect(s.error).toBeUndefined();
    expect([...s.lists.keys()]).toEqual([
      serviceKey(),
      ...ALPHA_GRID.map((r) => serviceKey(r)),
    ]);
    const at = (key: string, id: string) =>
      s.lists.get(key)?.[queries.findIndex((q) => q.id === id)];
    expect(at(serviceKey(), "en-002")?.[0]).toBe("demo:house");
    expect(at(serviceKey(0.5), "ru-001")).toEqual(
      expect.arrayContaining(["demo:trash", "demo:shopping-cart"]),
    );
    // Пять запросов — один multi-search.
    expect(meili.calls.filter((c) => c === "multiSearch")).toHaveLength(1);
    expect(s.fetched).toBe(queries.length);
  });

  it("карточка не из data/ — заметка, в списках её нет", async () => {
    const { meili, catalog } = await seededMeili([
      {
        id: "demo_ghost",
        icon: "demo:ghost",
        set: "demo",
        names: ["ghost"],
        name: ["ghost"],
        tags: [],
        synonymsEn: ["house"],
        synonymsRu: [],
        variants: [],
        tones: [],
      },
    ]);
    const queries = await readQueries(env.options.queriesPath);
    const s = await serviceLists({
      client: meili.client,
      catalog,
      queries,
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
    });
    expect(s.notes.join(" ")).toMatch(/demo:ghost/);
    expect(s.lists.get(serviceKey())?.flat()).not.toContain("demo:ghost");
  });

  it("нет векторов запросов или отказ Meilisearch — ошибка", async () => {
    const { meili, catalog } = await seededMeili();
    const queries = await readQueries(env.options.queriesPath);
    const noVectors = await serviceLists({
      client: meili.client,
      catalog,
      queries,
      queryDir: env.options.queryDir,
    });
    expect(noVectors.error).toMatch(/нет векторов запросов сервиса/);
    const failing = fakeMeili({ fail: () => new Error("503") });
    const s = await serviceLists({
      client: failing.client,
      catalog,
      queries,
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
    });
    expect(s.error).toMatch(/Meilisearch: 503/);
  });
});

describe("сервис в замере", () => {
  it("только сервис: «Текст» и сервис без векторов иконок, неразмеченное — заметка", async () => {
    const { meili } = await seededMeili();
    const r = await evaluate([config], env.dataDir, {
      queriesPath: env.options.queriesPath,
      judgmentsPath: env.options.judgmentsPath,
      overridesPath: env.options.overridesPath,
      storeDir: "нет-такой-папки",
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
      service: { client: meili.client, only: true },
    });
    expect(r.stop).toEqual(["разметки нет — запустите pnpm judge"]);
    await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fakeJudgeClient({ verdict: rule }).client,
      limit: 2,
    });
    const partial = await evaluate([config], env.dataDir, {
      queriesPath: env.options.queriesPath,
      judgmentsPath: env.options.judgmentsPath,
      overridesPath: env.options.overridesPath,
      storeDir: "нет-такой-папки",
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
      service: { client: meili.client, only: true },
    });
    expect(partial.stop).toEqual([]);
    expect(partial.notes.join(" ")).toMatch(/не размечено пар/);
    expect(partial.main.map((m) => m.system.key)).toEqual([
      "text",
      SERVICE_KEY,
      SERVICE_TEXT_KEY,
    ]);
    // Подобрана по рабочей части, если её хватило; иначе — из настроек.
    expect(partial.service?.ratio).toBe(
      partial.service?.tuned?.alpha ?? SEMANTIC_RATIO,
    );
    // Без моделей прототипа — ни пустых строк долей и длин, ни разделов без данных.
    expect(formatEvalReport(partial)).not.toMatch(
      /Доля смысловой части:|Длина вектора/,
    );
    const page = renderEvalPage(partial);
    expect(page).not.toContain("<h2>Длина вектора</h2>");
    expect(page).not.toContain("<h2>Промахи");
  });

  it("с разметкой судьи доля смысла подбирается по рабочей части", async () => {
    const { meili } = await seededMeili();
    await judgeEval([config], env.dataDir, {
      ...env.options,
      client: fakeJudgeClient({ verdict: rule }).client,
      service: { client: meili.client },
    });
    const r = await evaluate([config], env.dataDir, {
      queriesPath: env.options.queriesPath,
      judgmentsPath: env.options.judgmentsPath,
      overridesPath: env.options.overridesPath,
      storeDir: env.options.storeDir,
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
      models: env.options.models ?? [],
      service: { client: meili.client },
    });
    expect(r.stop).toEqual([]);
    expect(r.unlabeled).toBe(0);
    expect(r.service?.tuned?.curve).toHaveLength(ALPHA_GRID.length);
    expect(r.main.map((m) => m.system.key)).toContain(SERVICE_KEY);
    expect(r.pairs.map((p) => `${p.a}|${p.b}`)).toContain(
      `${SERVICE_KEY}|text`,
    );
    expect(formatEvalReport(r)).toMatch(/Сервис: доля смысла/);
    expect(renderEvalPage(r)).toContain("Поисковый сервис");
  });
});
