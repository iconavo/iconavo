// Команда pnpm eval (шаг 12, ADR-0048): замер поиска по эталону (ADR-0021). Варианты — из
// eval/systems.ts, разметка — judgments.json с правками владельца. Цифры — только когда первые
// десятки всех вариантов размечены целиком. Запросы, для которых в каталоге нет подходящей иконки,
// в доли не входят, а идут списком: это дыра в каталоге или ошибка разметки. С --service меряется и
// поисковый сервис (ADR-0049): доля смысла — по рабочей части, сравнение с гибридом Gemini прототипа
// на контрольной части — точным тестом Мак-Немара.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SEMANTIC_RATIO } from "@iconavo-ui/search";
import type { EmbeddingClient } from "../embed/client.js";
import { type EmbeddingModel, MODELS } from "../embed/config.js";
import type { MeiliClient } from "../meili/client.js";
import { type Catalog, loadCatalog } from "../search/catalog.js";
import { PER_SET_MODEL } from "../search/config.js";
import { queryVectors } from "../search/query-vectors.js";
import { buildTextIndex } from "../search/text.js";
import { catalogBytes } from "../search/vectors.js";
import type { SourceConfig } from "../sources/config.js";
import {
  JUDGE_MODEL,
  LENGTH_TOLERANCE,
  PROMPT_VERSION,
  SIGNIFICANCE,
} from "./config.js";
import {
  currentLabels,
  fitsOf,
  type GoldenQuery,
  type Labels,
  type Lang,
  type QueryType,
  readJudgments,
  readOverrides,
  readQueries,
  type Split,
  TYPES,
} from "./golden.js";
import {
  hitAt,
  type Paired,
  paired,
  pickLength,
  type Summary,
  summarize,
} from "./metrics.js";
import { serviceLists } from "./service.js";
import {
  type Choice,
  configChoice,
  modelLengths,
  type Rankings,
  rankAll,
  SERVICE_KEY,
  SERVICE_TEXT_KEY,
  type System,
  systems,
  type Tuned,
  tuneAlphas,
  tuneRatio,
  unlabeled,
} from "./systems.js";

export type Group = Split | "all";
export type LangKey = Lang | "all";

export const GROUPS: readonly Group[] = ["holdout", "work", "all"];
export const LANG_KEYS: readonly LangKey[] = ["ru", "en", "all"];

export interface SystemResult {
  system: System;
  /** Часть эталона → язык → цифры по запросам с подходящей иконкой. */
  groups: Record<Group, Record<LangKey, Summary>>;
  /**
   * Строго: по всем запросам, а запрос, для которого подходящей иконки не нашёл ни один вариант, —
   * промах. По этой цифре ставится цель к запуску (ADR-0021).
   */
  strict: Record<Group, Record<LangKey, Summary>>;
  /** По типам запросов — на всех запросах, только для справки. */
  types: Record<QueryType, Summary>;
}

export interface LengthResult {
  model: string;
  points: { length: number; hit: number; mrr: number; bytes: number }[];
  /** Самая короткая длина в пределах допуска (ADR-0048). */
  picked: number;
}

export interface Recommendation {
  /** Гибрид с лучшим Hit@5 на контрольной части. */
  leader: string;
  /** Модели, чья разница с лидером в пределах случайности: на контрольной части и на всех запросах. */
  closeHoldout: string[];
  closeAll: string[];
}

export interface EvalReport {
  catalog: Catalog;
  queries: GoldenQuery[];
  /** Запросы с подходящей иконкой — по ним доли; без неё — потолок. */
  included: GoldenQuery[];
  ceiling: GoldenQuery[];
  labels: Labels;
  choice: Choice;
  tuned?: Map<string, Tuned>;
  main: SystemResult[];
  lengths: LengthResult[];
  perSet?: { model: string; sets: { set: string; summary: Summary }[] };
  /** Попарно на контрольной части и на всех запросах: ключи вариантов и счёты. */
  pairs: { a: string; b: string; holdout: Paired; all: Paired }[];
  recommendation?: Recommendation;
  /**
   * Наборы в первой пятёрке лидера — по имеющейся разметке, без новых пар: доля карточек каталога,
   * доля подходящих иконок, доля мест в пятёрке и сколько из этих мест подходят.
   */
  setShares?: {
    model: string;
    sets: {
      set: string;
      docs: number;
      fits: number;
      slots: number;
      slotFits: number;
    }[];
  };
  /**
   * Поисковый сервис (ADR-0049): доля смысла — подобранная по рабочей части или из настроек; сравнение
   * с гибридом Gemini прототипа на контрольной части. notWorse — сервис не хуже в пределах
   * случайности: Hit@5 не ниже или p ≥ 0,05.
   */
  service?: {
    ratio: number;
    tuned?: Tuned;
    versus?: { key: string; holdout: Paired; notWorse: boolean };
  };
  /** Промахи лучшего гибрида — только по рабочей части. */
  misses: { query: GoldenQuery; fits: string[]; ranked: string[] }[];
  rankings?: Rankings;
  /** Версии наборов из info.json — для baseline.json. */
  versions: Record<string, string>;
  unlabeled: number;
  notes: string[];
  stop: string[];
}

export const evalStop = (r: EvalReport) => r.stop.length > 0;

export interface EvalOptions {
  queriesPath: string;
  judgmentsPath: string;
  overridesPath: string;
  storeDir: string;
  queryDir: string;
  /** Векторы запросов, которых нет в кэше; нет клиента — нужен полный кэш. */
  embedClient?: EmbeddingClient;
  models?: readonly EmbeddingModel[];
  /**
   * Поисковый сервис: клиент Meilisearch только для чтения; only — без моделей прототипа (в CI нет
   * векторов иконок), а неразмеченные пары — заметка, а не «СТОП».
   */
  service?: { client: MeiliClient; only?: boolean };
  log?: (line: string) => void;
}

/** Версии наборов из info.json; нет файла — «?». */
async function setVersions(
  configs: readonly SourceConfig[],
  dataDir: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of configs) {
    try {
      const info = JSON.parse(
        await readFile(join(dataDir, c.id, "info.json"), "utf8"),
      ) as { version?: string };
      out[c.id] = info.version ?? "?";
    } catch {
      out[c.id] = "?";
    }
  }
  return out;
}

/** Строки метрик: список варианта по запросу и подходящие карточки. */
function rowsOf(
  list: readonly string[][],
  queries: readonly GoldenQuery[],
  index: ReadonlyMap<string, number>,
  labels: Labels,
  keep: (q: GoldenQuery) => boolean,
  restrict?: (id: string) => boolean,
) {
  return queries.filter(keep).map((q) => {
    const fits = fitsOf(labels, q.id);
    const own = restrict ? new Set([...fits].filter(restrict)) : fits;
    return { ranked: list[index.get(q.id) as number] ?? [], fits: own };
  });
}

export async function evaluate(
  configs: readonly SourceConfig[],
  dataDir: string,
  options: EvalOptions,
): Promise<EvalReport> {
  const log = options.log ?? (() => {});
  const models = options.service?.only ? [] : (options.models ?? MODELS);
  const { catalog, errors } = await loadCatalog(configs, dataDir);
  const queries = await readQueries(options.queriesPath);
  const { judgments, reset } = await readJudgments(options.judgmentsPath, {
    model: JUDGE_MODEL,
    promptVersion: PROMPT_VERSION,
  });
  const overrides = await readOverrides(options.overridesPath);
  const labels = currentLabels(queries, judgments, overrides, catalog);
  const report: EvalReport = {
    catalog,
    queries,
    included: [],
    ceiling: [],
    labels,
    choice: configChoice(models, PER_SET_MODEL),
    main: [],
    lengths: [],
    pairs: [],
    misses: [],
    versions: await setVersions(configs, dataDir),
    unlabeled: 0,
    notes: reset ? [reset] : [],
    stop: errors.map((e) => `${e.id}: ${e.message}`),
  };
  if (report.stop.length > 0) return report;
  const judgedQueries = [...labels.byQuery.values()].filter((m) => m.size > 0);
  if (judgedQueries.length === 0) {
    report.stop.push("разметки нет — запустите pnpm judge");
    return report;
  }

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
    }
  }
  if (report.stop.length > 0) return report;

  let remote: Map<string, string[][]> | undefined;
  if (options.service) {
    log("Сервис: ответы Meilisearch на запросы эталона…");
    const s = await serviceLists({
      client: options.service.client,
      catalog,
      queries,
      queryDir: options.queryDir,
      ...(options.embedClient ? { embedClient: options.embedClient } : {}),
      log,
    });
    report.notes.push(...s.notes);
    if (s.error !== undefined) {
      report.stop.push(`сервис: ${s.error}`);
      return report;
    }
    remote = s.lists;
    report.service = { ratio: SEMANTIC_RATIO };
  }
  const input = {
    catalog,
    text,
    queries,
    vectors,
    models,
    storeDir: options.storeDir,
    ...(remote ? { remote } : {}),
    log,
  };
  const sets = catalog.sets.map((s) => s.id);
  const service = () =>
    report.service ? { ratio: report.service.ratio } : undefined;
  let defs = systems(models, report.choice, sets, service());
  let rankings = await rankAll(input, defs);
  if (report.service) {
    const tunedRatio = tuneRatio(rankings, queries, labels);
    if (tunedRatio) {
      report.service = { ratio: tunedRatio.alpha, tuned: tunedRatio };
      defs = systems(models, report.choice, sets, service());
      rankings = await rankAll(input, defs);
    } else {
      report.notes.push(
        "доля смысла сервиса не подобрана: первые десятки сетки на рабочей части размечены не целиком — взята из настроек (SEMANTIC_RATIO)",
      );
    }
  }
  const tuned = tuneAlphas(rankings, queries, labels, models);
  if (tuned) {
    report.tuned = tuned;
    const changed = models.some(
      (m) => tuned.get(m.key)?.alpha !== report.choice.alpha.get(m.key),
    );
    report.choice = {
      ...report.choice,
      alpha: new Map([...tuned].map(([k, t]) => [k, t.alpha])),
    };
    if (changed) {
      defs = systems(models, report.choice, sets, service());
      rankings = await rankAll(input, defs);
    }
  } else {
    report.notes.push(
      "доля смысловой части не подобрана: первые десятки сетки α на рабочей части размечены не целиком — взята из search/config.ts",
    );
  }
  report.rankings = rankings;
  report.notes.push(...rankings.notes);
  report.unlabeled = [
    ...unlabeled(rankings, defs, queries, labels).values(),
  ].reduce((n, s) => n + s.size, 0);
  if (report.unlabeled > 0) {
    const message = `в первых местах вариантов не размечено пар: ${report.unlabeled} — запустите pnpm judge`;
    // В CI судьи нет: неразмеченные пары считаются неподходящими, цифры — только для отчёта.
    if (options.service?.only) report.notes.push(message);
    else {
      report.stop.push(message);
      return report;
    }
  }

  report.included = queries.filter((q) => fitsOf(labels, q.id).size > 0);
  report.ceiling = queries.filter((q) => fitsOf(labels, q.id).size === 0);
  const index = new Map(queries.map((q, i) => [q.id, i]));
  const listOf = (key: string) => rankings.lists.get(key) ?? [];
  const inGroup = (g: Group, l: LangKey) => (q: GoldenQuery) =>
    (g === "all" || q.split === g) && (l === "all" || q.lang === l);

  for (const def of defs.filter((d) => d.role === "main")) {
    const list = listOf(def.key);
    const groups = {} as SystemResult["groups"];
    const strict = {} as SystemResult["strict"];
    for (const g of GROUPS) {
      groups[g] = {} as Record<LangKey, Summary>;
      strict[g] = {} as Record<LangKey, Summary>;
      for (const l of LANG_KEYS) {
        groups[g][l] = summarize(
          rowsOf(list, report.included, index, labels, inGroup(g, l)),
        );
        strict[g][l] = summarize(
          rowsOf(list, report.queries, index, labels, inGroup(g, l)),
        );
      }
    }
    const types = {} as SystemResult["types"];
    for (const t of TYPES) {
      types[t] = summarize(
        rowsOf(list, report.included, index, labels, (q) => q.type === t),
      );
    }
    report.main.push({ system: def, groups, strict, types });
  }

  for (const m of models) {
    const points = modelLengths(m).map((length) => {
      const s = summarize(
        rowsOf(
          listOf(`length:${m.key}/${length}`),
          report.included,
          index,
          labels,
          () => true,
        ),
      );
      return {
        length,
        hit: s.hit,
        mrr: s.mrr,
        bytes: catalogBytes(catalog.docs.length, length),
      };
    });
    report.lengths.push({
      model: m.key,
      points,
      picked: pickLength(points, LENGTH_TOLERANCE),
    });
  }

  const chosen = report.choice.perSetModel;
  if (chosen !== undefined) {
    report.perSet = {
      model: chosen,
      sets: sets.map((set) => {
        const inSet = (id: string) => id.startsWith(`${set}:`);
        const keep = (q: GoldenQuery) => [...fitsOf(labels, q.id)].some(inSet);
        return {
          set,
          summary: summarize(
            rowsOf(
              listOf(`set:${chosen}|${set}`),
              report.included,
              index,
              labels,
              keep,
              inSet,
            ),
          ),
        };
      }),
    };
  }

  // Попарно: гибриды моделей между собой и с текстом.
  const hitsOf = (key: string, keep: (q: GoldenQuery) => boolean) =>
    report.included
      .filter(keep)
      .map((q) =>
        hitAt(
          listOf(key)[index.get(q.id) as number] ?? [],
          fitsOf(labels, q.id),
        ),
      );
  const hybridKeys = models.map((m) => `hybrid:${m.key}`);
  const pairKeys: [string, string][] = [];
  hybridKeys.forEach((a, i) => {
    for (const b of hybridKeys.slice(i + 1)) pairKeys.push([a, b]);
  });
  for (const h of hybridKeys) pairKeys.push([h, "text"]);
  if (report.service) {
    if (hybridKeys.includes("hybrid:gemini")) {
      pairKeys.push([SERVICE_KEY, "hybrid:gemini"]);
    }
    pairKeys.push([SERVICE_KEY, "text"], [SERVICE_TEXT_KEY, "text"]);
  }
  const holdout = (q: GoldenQuery) => q.split === "holdout";
  for (const [a, b] of pairKeys) {
    report.pairs.push({
      a,
      b,
      holdout: paired(hitsOf(a, holdout), hitsOf(b, holdout)),
      all: paired(
        hitsOf(a, () => true),
        hitsOf(b, () => true),
      ),
    });
  }

  // Сервис против гибрида Gemini прототипа (ADR-0049): не хуже — Hit@5 не ниже или разница в пределах
  // случайности.
  const versus = report.pairs.find(
    (p) => p.a === SERVICE_KEY && p.b === "hybrid:gemini",
  );
  if (report.service && versus) {
    report.service.versus = {
      key: "hybrid:gemini",
      holdout: versus.holdout,
      notWorse:
        versus.holdout.onlyA >= versus.holdout.onlyB ||
        versus.holdout.p >= SIGNIFICANCE,
    };
  }

  // Лидер — по правилу ADR-0048: Hit@5 на контрольной части, затем на всех и MRR@10 на всех.
  const hybrids = report.main.filter((r) => r.system.key.startsWith("hybrid:"));
  const ranked = [...hybrids].sort(
    (x, y) =>
      y.groups.holdout.all.hit - x.groups.holdout.all.hit ||
      y.groups.all.all.hit - x.groups.all.all.hit ||
      y.groups.all.all.mrr - x.groups.all.all.mrr,
  );
  const leader = ranked[0];
  if (leader) {
    const close = (part: "holdout" | "all") =>
      ranked
        .slice(1)
        .filter((r) => {
          const pair = report.pairs.find(
            (p) =>
              (p.a === leader.system.key && p.b === r.system.key) ||
              (p.b === leader.system.key && p.a === r.system.key),
          );
          return (pair?.[part].p ?? 0) >= SIGNIFICANCE;
        })
        .map((r) => r.system.model as string);
    report.recommendation = {
      leader: leader.system.model as string,
      closeHoldout: close("holdout"),
      closeAll: close("all"),
    };
    const list = listOf(leader.system.key);
    const shares = sets.map((set) => ({
      set,
      docs: catalog.docs.filter((d) => d.set === set).length,
      fits: 0,
      slots: 0,
      slotFits: 0,
    }));
    const shareOf = (id: string) =>
      shares.find((s) => id.startsWith(`${s.set}:`));
    for (const q of queries) {
      const known = labels.byQuery.get(q.id);
      for (const [id, v] of known ?? []) {
        if (v === "fits") {
          const s = shareOf(id);
          if (s) s.fits++;
        }
      }
      for (const id of (list[index.get(q.id) as number] ?? []).slice(0, 5)) {
        const s = shareOf(id);
        if (!s) continue;
        s.slots++;
        if (known?.get(id) === "fits") s.slotFits++;
      }
    }
    report.setShares = {
      model: leader.system.model as string,
      sets: shares,
    };
    for (const q of report.included.filter((x) => x.split === "work")) {
      const fits = fitsOf(labels, q.id);
      const top = list[index.get(q.id) as number] ?? [];
      if (!hitAt(top, fits)) {
        report.misses.push({
          query: q,
          fits: [...fits].sort(),
          ranked: top.slice(0, 5),
        });
      }
    }
  }
  return report;
}
