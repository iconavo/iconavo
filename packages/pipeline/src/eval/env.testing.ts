import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeEmbeddingClient, TEST_MODELS } from "../embed/client.testing.js";
import { embedSets } from "../embed/run.js";
import { demoConfig, writeDemoSet } from "../search/fixture.testing.js";
import { COLUMNS, type Verdict } from "./golden.js";
import type { JudgeOptions } from "./judge.js";

export const MODEL_A = TEST_MODELS[0] as (typeof TEST_MODELS)[number];
export const config = demoConfig("demo");

export const QUERIES = [
  "ru-001,корзина,ru,object,Мусорное ведро.,work",
  "ru-002,дом,ru,object,Домик с крышей.,holdout",
  "en-001,trash,en,object,Мусорное ведро.,work",
  "en-002,house,en,object,Домик с крышей.,holdout",
  "en-003,unicorn,en,object,Единорог.,work",
];

/** Подходит ли иконка запросу — правило подменного судьи. */
export function rule(prompt: string, name: string): Verdict {
  if (/«(корзина|trash)»/.test(prompt)) {
    if (name === "trash") return "fits";
    if (name === "shopping-cart") return "partial";
  }
  if (/«(дом|house)»/.test(prompt) && name === "house") return "fits";
  return "no";
}

export interface Env {
  root: string;
  dataDir: string;
  options: JudgeOptions;
}

/** Временные данные, векторы и эталон для pnpm judge и pnpm eval. */
export async function setupEnv(prefix: string): Promise<Env> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const dataDir = join(root, "data");
  const storeDir = join(root, "embeddings");
  await writeDemoSet(dataDir, {
    id: "demo",
    icons: [
      { name: "trash", en: ["trash", "bin"], ru: ["корзина", "мусор"] },
      { name: "shopping-cart", en: ["cart"], ru: ["корзина", "покупки"] },
      { name: "house", en: ["house", "home"], ru: ["дом"] },
      { name: "heart", en: ["love"], ru: ["сердце"] },
      { name: "bare", tags: ["bare"] },
    ],
  });
  await embedSets([config], dataDir, {
    storeDir,
    models: [MODEL_A],
    maxRub: 100,
    client: fakeEmbeddingClient().client,
  });
  const queriesPath = join(root, "queries.csv");
  await writeFile(queriesPath, `${COLUMNS.join(",")}\n${QUERIES.join("\n")}\n`);
  return {
    root,
    dataDir,
    options: {
      embedClient: fakeEmbeddingClient().client,
      queriesPath,
      judgmentsPath: join(root, "judgments.json"),
      overridesPath: join(root, "overrides.json"),
      storeDir,
      queryDir: join(root, "queries"),
      models: [MODEL_A],
      maxRub: 100,
    },
  };
}
