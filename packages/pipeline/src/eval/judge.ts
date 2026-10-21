// Команда pnpm judge (шаг 12, ADR-0048): разметка эталона ИИ-судьёй. Кандидаты — всё неразмеченное в
// первых десятках вариантов замера (eval/systems.ts); судья — Gemini 3.8 Flash через Polza. Он видит
// запрос, описание ожидаемой иконки и PNG кандидатов, перемешанных постоянным случаем. Разметка
// пишется в docs/eval/judgments.json по ходу; повторный запуск отправляет только новые пары. Круги
// повторяются, пока новых пар нет: подбор α меняет списки. Сеть — только через ChatClient и
// EmbeddingClient, поэтому в тестах их подменяют.

import { createHash } from "node:crypto";
import type { EmbeddingClient } from "../embed/client.js";
import { type EmbeddingModel, MODELS } from "../embed/config.js";
import { initRenderer, renderPreview } from "../qc/render.js";
import { type Catalog, loadCatalog } from "../search/catalog.js";
import { PER_SET_MODEL } from "../search/config.js";
import { queryVectors } from "../search/query-vectors.js";
import { buildTextIndex } from "../search/text.js";
import type { SourceConfig } from "../sources/config.js";
import type { ChatClient } from "./client.js";
import {
  AGREEMENT_SHARE,
  CHUNK_SIZE,
  CONCURRENCY,
  EST_IMAGE_TOKENS,
  EST_OUTPUT_TOKENS,
  EST_TEXT_TOKENS,
  IMAGE_SIZE,
  JUDGE_MODEL,
  JUDGE_RUB_PER_MILLION,
  MAX_ROUNDS,
  PROMPT_VERSION,
  SAVE_EVERY,
  SEED,
} from "./config.js";
import {
  currentLabels,
  type GoldenQuery,
  type Judgments,
  LANGS,
  type Labels,
  readJudgments,
  readOverrides,
  readQueries,
  TYPES,
  VERDICTS,
  type Verdict,
  writeJudgments,
} from "./golden.js";
import { type Candidate, judgeBody, parseVerdicts } from "./prompt.js";
import {
  configChoice,
  rankAll,
  systems,
  type Tuned,
  tuneAlphas,
  unlabeled,
} from "./systems.js";

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Число 0…1 из хэша: постоянный случай без генератора. */
const chance = (text: string) =>
  Number.parseInt(sha1(text).slice(0, 8), 16) / 2 ** 32;

/** Перемешивание постоянным случаем: одинаковый seed — одинаковый порядок. */
export function shuffle<T>(list: readonly T[], seed: string): T[] {
  return list
    .map((item, i) => ({ item, key: sha1(`${seed}|${i}`) }))
    .sort((a, b) => order(a.key, b.key))
    .map((x) => x.item);
}

/**
 * Пилот: по запросу из каждой ячейки «язык × тип» по кругу, внутри ячейки — по хэшу id. Так 10
 * запросов — по одному на ячейку, а выборка побольше включает выборку поменьше.
 */
export function pilotSample(
  queries: readonly GoldenQuery[],
  limit: number,
): GoldenQuery[] {
  const cells = LANGS.flatMap((lang) =>
    TYPES.map((type) =>
      queries
        .filter((q) => q.lang === lang && q.type === type)
        .sort((a, b) =>
          order(sha1(`${SEED}|${a.id}`), sha1(`${SEED}|${b.id}`)),
        ),
    ),
  );
  const picked = new Set<string>();
  for (let round = 0; picked.size < limit; round++) {
    let added = false;
    for (const cell of cells) {
      const q = cell[round];
      if (q && picked.size < limit) {
        picked.add(q.id);
        added = true;
      }
    }
    if (!added) break;
  }
  return queries.filter((q) => picked.has(q.id));
}

/** Пара размечается второй раз — постоянная выборка AGREEMENT_SHARE пар. */
export const repeatPair = (queryId: string, docId: string) =>
  chance(`${SEED}|repeat|${queryId}|${docId}`) < AGREEMENT_SHARE;

export interface Spent {
  requests: number;
  images: number;
  promptTokens: number;
  completionTokens: number;
  rub: number;
}

export const noSpent = (): Spent => ({
  requests: 0,
  images: 0,
  promptTokens: 0,
  completionTokens: 0,
  rub: 0,
});

interface Job {
  query: GoldenQuery;
  docs: string[];
  /** Повторная разметка для согласия судьи с собой. */
  repeat: boolean;
}

/** Рубли по токенам — если Polza не вернула cost_rub. */
const rubOf = (input: number, output: number) =>
  (input * JUDGE_RUB_PER_MILLION.input +
    output * JUDGE_RUB_PER_MILLION.output) /
  1e6;

/**
 * Оценка до отправки: по факту прошлых запусков (рублей на картинку), а до первого — по константам с
 * запасом.
 */
export function estimateRub(
  jobs: readonly Job[],
  measured?: { images: number; rub: number },
): number {
  const images = jobs.reduce((n, j) => n + j.docs.length, 0);
  if (measured && measured.images > 0)
    return (images * measured.rub) / measured.images;
  return rubOf(
    images * EST_IMAGE_TOKENS + jobs.length * EST_TEXT_TOKENS,
    jobs.length * EST_OUTPUT_TOKENS,
  );
}

export interface JudgeOptions {
  /** Судья; нужен, если есть что отправлять. */
  client?: ChatClient;
  /** Векторы запросов эталона: кэш, недостающие — у Polza. */
  embedClient?: EmbeddingClient;
  queriesPath: string;
  judgmentsPath: string;
  overridesPath: string;
  /** Папки векторов иконок и кэша векторов запросов. */
  storeDir: string;
  queryDir: string;
  models?: readonly EmbeddingModel[];
  /** Пилот: столько запросов, по ячейкам «язык × тип». */
  limit?: number;
  /** Лимит стоимости запуска в рублях. */
  maxRub: number;
  /** Только посчитать пары и оценить стоимость. */
  dryRun?: boolean;
  concurrency?: number;
  log?: (line: string) => void;
}

export interface JudgeRound {
  round: number;
  /** Неразмеченных пар в начале круга, запросов к судье и оценка. */
  pending: number;
  requests: number;
  estimate: number;
  /** Получено вердиктов в этом круге. */
  judged: number;
}

export interface JudgeReport {
  catalog: Catalog;
  /** Размечаемые запросы и всего в эталоне. */
  queries: GoldenQuery[];
  total: number;
  rounds: JudgeRound[];
  /** Расход этого запуска и всей разметки. */
  spent: Spent;
  spentTotal: { requests: number; images: number; rub: number };
  /** Вердиктов в этом запуске и ответов, которые не разобрались. */
  judged: number;
  failures: { id: string; reason: string }[];
  /** Действующая разметка после запуска. */
  labels: Labels;
  /** Подобранная доля смысловой части — когда размечена вся рабочая часть. */
  tuned?: Map<string, Tuned>;
  /** Неразмеченных пар осталось. */
  pending: number;
  /** Согласие судьи с собой по повторно размеченным парам. */
  agreement: { pairs: number; same: number; sameFits: number };
  notes: string[];
  stop: string[];
}

export const judgeStop = (r: JudgeReport) => r.stop.length > 0;

/** До limit задач одновременно; задача сама ловит свои ошибки. */
async function pool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++] as T);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

/** Согласие судьи с собой: тот же вердикт и то же «подходит или нет». */
export function agreementOf(j: Judgments): JudgeReport["agreement"] {
  let pairs = 0;
  let same = 0;
  let sameFits = 0;
  for (const entry of Object.values(j.queries)) {
    for (const icon of Object.values(entry.icons)) {
      if (icon.repeat === undefined) continue;
      pairs++;
      if (icon.repeat === icon.verdict) same++;
      if ((icon.repeat === "fits") === (icon.verdict === "fits")) sameFits++;
    }
  }
  return { pairs, same, sameFits };
}

/** Разметка эталона: круги «варианты замера → неразмеченные пары → судья», пока пары есть. */
export async function judgeEval(
  configs: readonly SourceConfig[],
  dataDir: string,
  options: JudgeOptions,
): Promise<JudgeReport> {
  const log = options.log ?? (() => {});
  const models = options.models ?? MODELS;
  const { catalog, errors } = await loadCatalog(configs, dataDir);
  const all = await readQueries(options.queriesPath);
  const queries =
    options.limit === undefined ? all : pilotSample(all, options.limit);
  const read = await readJudgments(options.judgmentsPath, {
    model: JUDGE_MODEL,
    promptVersion: PROMPT_VERSION,
  });
  const judgments = read.judgments;
  const overrides = await readOverrides(options.overridesPath);
  const report: JudgeReport = {
    catalog,
    queries,
    total: all.length,
    rounds: [],
    spent: noSpent(),
    spentTotal: judgments.spent ?? { requests: 0, images: 0, rub: 0 },
    judged: 0,
    failures: [],
    labels: currentLabels(queries, judgments, overrides, catalog),
    pending: 0,
    agreement: agreementOf(judgments),
    notes: read.reset ? [read.reset] : [],
    stop: errors.map((e) => `${e.id}: ${e.message}`),
  };
  if (report.stop.length > 0) return report;

  const text = buildTextIndex(catalog.docs.map((d) => d.words));
  const vectors = new Map<string, (Float32Array | undefined)[]>();
  for (const model of models) {
    const qv = await queryVectors(
      model,
      queries.map((q) => q.query),
      {
        dir: options.queryDir,
        ...(options.embedClient ? { client: options.embedClient } : {}),
      },
    );
    vectors.set(model.key, qv.vectors);
    if (qv.vectors.some((v) => v === undefined)) {
      report.stop.push(
        `${model.key}: нет векторов запросов — ${qv.error ?? "неизвестная причина"}`,
      );
    } else if (qv.fetched > 0) {
      log(`${model.key}: векторы ${qv.fetched} запросов посчитаны`);
    }
  }
  if (report.stop.length > 0) return report;

  const allWork =
    queries.filter((q) => q.split === "work").length ===
    all.filter((q) => q.split === "work").length;
  let choice = configChoice(models, PER_SET_MODEL);
  const sets = catalog.sets.map((s) => s.id);
  const input = {
    catalog,
    text,
    queries,
    vectors,
    models,
    storeDir: options.storeDir,
    log,
  };
  const byId = new Map(queries.map((q) => [q.id, q]));
  let stopped = false;
  let saving: Promise<void> = Promise.resolve();
  const save = () => {
    judgments.spent = report.spentTotal;
    const next = saving.then(() =>
      writeJudgments(options.judgmentsPath, judgments),
    );
    saving = next.catch(() => {});
    return next;
  };
  const pngs = new Map<string, Buffer>();
  const pngOf = (id: string) => {
    let png = pngs.get(id);
    if (!png) {
      const doc = catalog.docs[catalog.byId.get(id) as number];
      if (!doc) throw new Error(`нет карточки ${id}`);
      png = renderPreview(doc.icon, IMAGE_SIZE);
      pngs.set(id, png);
    }
    return png;
  };

  // Пересчитать остаток после разметки: судья мог добавить вердикты.
  let recount = false;
  for (let round = 1; round <= MAX_ROUNDS && !stopped; round++) {
    const defs = systems(models, choice, sets);
    const rankings = await rankAll(input, defs);
    if (round === 1) report.notes.push(...rankings.notes);
    const labels = currentLabels(queries, judgments, overrides, catalog);
    report.labels = labels;
    const tuned = allWork
      ? tuneAlphas(rankings, queries, labels, models)
      : undefined;
    if (tuned) {
      report.tuned = tuned;
      const changed = models.some(
        (m) => tuned.get(m.key)?.alpha !== choice.alpha.get(m.key),
      );
      if (changed) {
        choice = {
          ...choice,
          alpha: new Map([...tuned].map(([k, t]) => [k, t.alpha])),
        };
        log(
          `доля смысловой части подобрана: ${[...tuned].map(([k, t]) => `${k} ${t.alpha}`).join(", ")} — списки пересчитываются`,
        );
        continue;
      }
    }
    const pending = unlabeled(rankings, defs, queries, labels);
    const count = [...pending.values()].reduce((n, s) => n + s.size, 0);
    report.pending = count;
    if (count === 0) {
      // Остаток только что посчитан — пересчитывать не нужно.
      recount = false;
      break;
    }

    const jobs: Job[] = [];
    const repeats: Job[] = [];
    for (const [id, docs] of pending) {
      const query = byId.get(id) as GoldenQuery;
      const sorted = [...docs].sort(order);
      const mixed = shuffle(sorted, `${SEED}|${id}|${round}`);
      for (let i = 0; i < mixed.length; i += CHUNK_SIZE) {
        jobs.push({
          query,
          docs: mixed.slice(i, i + CHUNK_SIZE),
          repeat: false,
        });
      }
      const again = shuffle(
        sorted.filter((d) => repeatPair(id, d)),
        `${SEED}|repeat|${id}|${round}`,
      );
      for (let i = 0; i < again.length; i += CHUNK_SIZE) {
        repeats.push({
          query,
          docs: again.slice(i, i + CHUNK_SIZE),
          repeat: true,
        });
      }
    }
    const measured = judgments.spent;
    const estimate = estimateRub([...jobs, ...repeats], measured);
    const r: JudgeRound = {
      round,
      pending: count,
      requests: jobs.length + repeats.length,
      estimate,
      judged: 0,
    };
    report.rounds.push(r);
    log(
      `круг ${round}: неразмеченных пар ${count}, запросов к судье ${r.requests}, оценка ${estimate.toFixed(2)} ₽`,
    );
    if (options.dryRun) break;
    if (report.spent.rub + estimate > options.maxRub) {
      report.stop.push(
        `оценка ${(report.spent.rub + estimate).toFixed(2)} ₽ больше лимита ${options.maxRub} ₽ — поднимите --max-rub`,
      );
      break;
    }
    const client = options.client;
    if (!client) throw new Error("судья не задан: нужен ключ POLZA_API_KEY");
    await initRenderer();

    let done = 0;
    const run = async (job: Job) => {
      if (stopped) return;
      const candidates: Candidate[] = job.docs.map((id, k) => ({
        n: k + 1,
        name: catalog.docs[catalog.byId.get(id) as number]?.name ?? id,
        png: pngOf(id),
      }));
      let verdicts: Map<number, Verdict> | undefined;
      let reason = "";
      for (let attempt = 1; attempt <= 2 && !verdicts && !stopped; attempt++) {
        try {
          const res = await client.complete(judgeBody(job.query, candidates));
          const rub =
            res.rub ?? rubOf(res.promptTokens ?? 0, res.completionTokens ?? 0);
          report.spent.requests++;
          report.spent.images += candidates.length;
          report.spent.promptTokens += res.promptTokens ?? 0;
          report.spent.completionTokens += res.completionTokens ?? 0;
          report.spent.rub += rub;
          report.spentTotal = {
            requests: report.spentTotal.requests + 1,
            images: report.spentTotal.images + candidates.length,
            rub: report.spentTotal.rub + rub,
          };
          verdicts = parseVerdicts(
            res.text,
            candidates.map((c) => c.n),
          );
        } catch (e) {
          reason = (e as Error).message;
          // Отказ API (ключ, баланс, недоступная модель) — остановка; неразборчивый ответ — повтор.
          if ((e as { scope?: string }).scope !== undefined) {
            if (!stopped) report.stop.push(reason);
            stopped = true;
            return;
          }
        }
        if (report.spent.rub > options.maxRub && !stopped) {
          stopped = true;
          report.stop.push(
            `потрачено ${report.spent.rub.toFixed(2)} ₽ — больше лимита ${options.maxRub} ₽: новые запросы не отправляются`,
          );
        }
      }
      const got = verdicts;
      if (!got) {
        report.failures.push({ id: job.query.id, reason });
        return;
      }
      let entry = judgments.queries[job.query.id];
      if (
        !entry ||
        entry.query !== job.query.query ||
        entry.description !== job.query.description
      ) {
        entry = {
          query: job.query.query,
          description: job.query.description,
          icons: {},
        };
        judgments.queries[job.query.id] = entry;
      }
      job.docs.forEach((id, k) => {
        const verdict = got.get(k + 1) as Verdict;
        const doc = catalog.docs[catalog.byId.get(id) as number];
        if (!doc) return;
        const had = entry.icons[id];
        if (job.repeat) {
          if (had) had.repeat = verdict;
        } else {
          entry.icons[id] = { verdict, fingerprint: doc.fingerprint };
        }
      });
      r.judged += job.repeat ? 0 : job.docs.length;
      report.judged += job.repeat ? 0 : job.docs.length;
      done++;
      if (done % SAVE_EVERY === 0) {
        await save();
        log(
          `  ответов ${done} из ${r.requests} · ${report.spent.rub.toFixed(2)} ₽ · сохранено`,
        );
      }
    };
    recount = true;
    await pool(jobs, options.concurrency ?? CONCURRENCY, run);
    // Повторы — после основных: у пары уже есть первый вердикт.
    await pool(repeats, options.concurrency ?? CONCURRENCY, run);
    await save();
    // Круг без единого вердикта — те же запросы снова не помогут: остаток — в следующий запуск.
    if (r.judged === 0) break;
  }

  report.labels = currentLabels(queries, judgments, overrides, catalog);
  if (recount) {
    const defs = systems(models, choice, sets);
    const rankings = await rankAll(input, defs);
    report.pending = [
      ...unlabeled(rankings, defs, queries, report.labels).values(),
    ].reduce((n, s) => n + s.size, 0);
  }
  report.agreement = agreementOf(judgments);
  return report;
}

/** Вердиктов каждого вида в действующей разметке. */
export function verdictCounts(labels: Labels): Record<Verdict, number> {
  const out = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<
    Verdict,
    number
  >;
  for (const map of labels.byQuery.values()) {
    for (const v of map.values()) out[v]++;
  }
  return out;
}
