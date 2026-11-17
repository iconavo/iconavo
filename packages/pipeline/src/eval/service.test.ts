import { rm } from "node:fs/promises";
import { SEMANTIC_RATIO } from "@iconavo-ui/search";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbeddingClient } from "../embed/client.testing.js";
import { searchDocuments } from "../meili/docs.js";
import { fakeMeili } from "../meili/fake.testing.js";
import { loadCatalog } from "../search/catalog.js";
import { fakeJudgeClient } from "./client.testing.js";
import { ALPHA_GRID, CEILING_DEPTH, DEPTH, SCORED_DEPTH } from "./config.js";
import { config, type Env, rule, setupEnv } from "./env.testing.js";
import { readQueries } from "./golden.js";
import { judgeEval } from "./judge.js";
import { formatEvalReport, renderEvalPage, renderWorstPage } from "./report.js";
import { evaluate } from "./run.js";
import {
  FAMILIES,
  familyKey,
  firstFit,
  serviceKey,
  serviceLists,
  withExact,
} from "./service.js";
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
    // Пять запросов — два multi-search: выдача и списки с оценками.
    expect(meili.calls.filter((c) => c === "multiSearch")).toHaveLength(2);
    expect(s.fetched).toBe(queries.length);
    // Списки с оценками — по запросу эталона; точное имя — отдельно, в списках его нет.
    const i = queries.findIndex((q) => q.id === "en-002");
    expect(s.scored.exact[i]).toEqual(["demo:house"]);
    expect(s.scored.words[i]?.map((h) => h.icon)).not.toContain("demo:house");
    const words = s.scored.words[queries.findIndex((q) => q.id === "ru-001")];
    expect(words?.map((h) => h.icon)).toEqual(
      expect.arrayContaining(["demo:trash", "demo:shopping-cart"]),
    );
    expect(words?.every((h) => h.score > 0 && h.score <= 1)).toBe(true);
    expect(s.scored.meaning).toHaveLength(queries.length);
  });

  it("при доле смысла из настроек список глубже — до 30-го места; списки с оценками — до 200", async () => {
    const { meili, catalog } = await seededMeili();
    const queries = await readQueries(env.options.queriesPath);
    const bodies: Record<string, unknown>[][] = [];
    await serviceLists({
      client: {
        ...meili.client,
        multiSearch: (body) => {
          bodies.push(body as Record<string, unknown>[]);
          return meili.client.multiSearch(body);
        },
      },
      catalog,
      queries,
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
    });
    const [main, scored] = bodies;
    const hybrid = (main ?? []).filter((q) => q.hybrid !== undefined);
    const ratioOf = (q: Record<string, unknown>) =>
      (q.hybrid as { semanticRatio: number }).semanticRatio;
    expect(
      hybrid.filter((q) => ratioOf(q) === SEMANTIC_RATIO).map((q) => q.limit),
    ).toEqual(queries.map(() => CEILING_DEPTH));
    expect(
      new Set(
        hybrid.filter((q) => ratioOf(q) !== SEMANTIC_RATIO).map((q) => q.limit),
      ),
    ).toEqual(new Set([DEPTH]));
    expect(scored).toHaveLength(2 * queries.length);
    expect(
      (scored ?? []).every(
        (q) => q.showRankingScore === true && q.limit === SCORED_DEPTH,
      ),
    ).toBe(true);
    // Пары: только слова, затем только смысл (доля 1).
    expect(scored?.[0]?.hybrid).toBeUndefined();
    expect(ratioOf(scored?.[1] as Record<string, unknown>)).toBe(1);
  });

  it("место первой подходящей и список с точным именем впереди", () => {
    expect(firstFit(["a:x", "a:y"], new Set(["a:y"]))).toBe(2);
    expect(firstFit(["a:x"], new Set(["a:z"]))).toBeUndefined();
    expect(
      withExact(
        ["a:house"],
        [
          { icon: "a:house", score: 0.9 },
          { icon: "a:home", score: 0.8 },
        ],
      ),
    ).toEqual(["a:house", "a:home"]);
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

describe("опыт этапа 2 — слияние слов и смысла (ADR-0053)", () => {
  it("копия слияния повторяет выдачу; семейства — на всей сетке, точное имя впереди", async () => {
    const { meili, catalog } = await seededMeili();
    const queries = await readQueries(env.options.queriesPath);
    const plain = await serviceLists({
      client: meili.client,
      catalog,
      queries,
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
    });
    expect(plain.explore).toBeUndefined();
    expect(plain.lists.has(familyKey("m", 0.5))).toBe(false);
    const s = await serviceLists({
      client: meili.client,
      catalog,
      queries,
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
      explore: true,
    });
    expect(s.explore?.checked).toBe(queries.length * ALPHA_GRID.length);
    expect(s.explore?.mismatches).toEqual([]);
    expect(s.explore?.distribution.sigma).toBeGreaterThan(0);
    for (const family of FAMILIES) {
      for (const x of ALPHA_GRID) {
        expect(s.lists.get(familyKey(family, x))).toHaveLength(queries.length);
      }
    }
    const house = queries.findIndex((q) => q.id === "en-002");
    expect(s.lists.get(familyKey("c-abs", 0.5))?.[house]?.[0]).toBe(
      "demo:house",
    );
  });

  it("судья и замер с explore: кривые устройств, выбор и что он чинит и ломает", async () => {
    const { meili } = await seededMeili();
    await judgeEval([config], env.dataDir, {
      ...env.options,
      storeDir: "нет-такой-папки",
      client: fakeJudgeClient({ verdict: rule }).client,
      service: { client: meili.client, only: true, explore: true },
    });
    const r = await evaluate([config], env.dataDir, {
      queriesPath: env.options.queriesPath,
      judgmentsPath: env.options.judgmentsPath,
      overridesPath: env.options.overridesPath,
      storeDir: "нет-такой-папки",
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
      service: { client: meili.client, only: true, explore: true },
    });
    expect(r.stop).toEqual([]);
    expect(r.unlabeled).toBe(0);
    expect(r.explore?.curves.map((c) => c.device)).toEqual([
      "now",
      "m",
      "c-abs",
      "c-rel",
    ]);
    expect(r.explore?.curves.every((c) => c.tuned !== undefined)).toBe(true);
    // Подделка ищет только словами: всем устройствам доступно одно и то же — остаётся «как сейчас».
    expect(r.explore?.choice?.device).toBe("now");
    expect(r.explore?.broken).toEqual([]);
    expect(formatEvalReport(r)).toMatch(/Опыт этапа 2 \(ADR-0053\)/);
    expect(renderEvalPage(r)).toContain("Опыт этапа 2: слияние слов и смысла");
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
    // «Сервис» — всегда выдача функции, при доле из настроек; правило только советует (ADR-0053).
    expect(partial.service?.ratio).toBe(SEMANTIC_RATIO);
    // Без моделей прототипа — ни пустых строк долей и длин, ни разделов без данных.
    expect(formatEvalReport(partial)).not.toMatch(
      /Доля смысловой части:|Длина вектора/,
    );
    const page = renderEvalPage(partial);
    expect(page).not.toContain("<h2>Длина вектора</h2>");
    expect(page).not.toContain("<h2>Промахи");
  });

  it("судья только для сервиса: без моделей прототипа; худшие запросы, оракул и наборы в пятёрке", async () => {
    const { meili } = await seededMeili();
    const judge = fakeJudgeClient({ verdict: rule });
    const j = await judgeEval([config], env.dataDir, {
      ...env.options,
      // Векторов иконок нет — без моделей прототипа они и не нужны.
      storeDir: "нет-такой-папки",
      client: judge.client,
      service: { client: meili.client, only: true },
    });
    expect(j.stop).toEqual([]);
    expect(j.pending).toBe(0);
    const r = await evaluate([config], env.dataDir, {
      queriesPath: env.options.queriesPath,
      judgmentsPath: env.options.judgmentsPath,
      overridesPath: env.options.overridesPath,
      storeDir: "нет-такой-папки",
      queryDir: env.options.queryDir,
      embedClient: fakeEmbeddingClient().client,
      service: { client: meili.client, only: true },
    });
    expect(r.stop).toEqual([]);
    expect(r.unlabeled).toBe(0);
    // Рабочая часть: ru-001 и en-001 — попадания, en-003 «единорог» — потолок, он худший.
    expect(r.worst[0]?.query.id).toBe("en-003");
    expect(r.worst.map((e) => e.query.id).sort()).toEqual([
      "en-001",
      "en-003",
      "ru-001",
    ]);
    expect(r.worst[0]?.diagnosis).toBe("ceiling");
    expect(r.worst.filter((e) => e.diagnosis === "weak")).toHaveLength(2);
    expect(r.worst.every((e) => e.query.split === "work")).toBe(true);
    expect(r.oracle).toEqual({ ru: { hits: 1, n: 1 }, en: { hits: 1, n: 2 } });
    expect(r.serviceShares?.sets.map((s) => s.set)).toEqual(["demo"]);
    expect(formatEvalReport(r)).toMatch(/Оракул на рабочей части.*ru 1 из 1/);
    expect(renderEvalPage(r)).toContain("Сервис — строго по языкам");
    const worst = renderWorstPage(r);
    expect(worst).toContain("Потолок: подходящей иконки не видел никто");
    expect(worst).toContain("en-003");
    expect(worst).not.toContain("ru-002");
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
