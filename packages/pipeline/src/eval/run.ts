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
  DEPTH,
  HIT_K,
  JUDGE_MODEL,
  LENGTH_TOLERANCE,
  MISS_DEPTH,
  PROMPT_VERSION,
  SIGNIFICANCE,
  WORST,
} from "./config.js";
import {
  currentLabels,
  fitsOf,
  type GoldenQuery,
  LANGS,
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
import {
  firstFit,
  type ScoredLists,
  serviceLists,
  withExact,
} from "./service.js";
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

/**
 * Наборы в первой пятёрке варианта на рабочей части — по имеющейся разметке, без новых пар: доля
 * карточек каталога, доля подходящих иконок, доля мест в пятёрке и сколько из этих мест подходят.
 */
export interface SetShares {
  /** Подпись варианта: модель гибрида прототипа или «Сервис». */
  model: string;
  sets: {
    set: string;
    docs: number;
    fits: number;
    slots: number;
    slotFits: number;
  }[];
}

/**
 * Диагноз худшего запроса (ADR-0053): ceiling — подходящей иконки не видел никто; weak — попадание,
 * но не на первых местах; words — слова нашли её в десятке, а в выдаче она ниже пятёрки; near —
 * рядом, до 20-го места; missing — иконка есть, но ни слова, ни смысл её не находят.
 */
export type Diagnosis = "ceiling" | "weak" | "words" | "near" | "missing";

/** Места первой подходящей (с 1): в выдаче сервиса, только по словам, только по смыслу. */
export interface FitPlaces {
  service?: number;
  words?: number;
  meaning?: number;
}

export function diagnose(fits: number, at: FitPlaces): Diagnosis {
  if (fits === 0) return "ceiling";
  if (at.service !== undefined && at.service <= HIT_K) return "weak";
  if (at.words !== undefined && at.words <= DEPTH) return "words";
  const near = (place?: number) => place !== undefined && place <= MISS_DEPTH;
  if (near(at.service) || near(at.words) || near(at.meaning)) return "near";
  return "missing";
}

export interface WorstEntry {
  query: GoldenQuery;
  /** Подходящие по разметке. */
  fits: string[];
  /** Выдача сервиса при доле смысла из настроек — до 30-го места. */
  ranked: string[];
  at: FitPlaces;
  /** «Частично» в пятёрке сервиса: если таких много, судья, возможно, строг. */
  partials: number;
  diagnosis: Diagnosis;
}

/** Порядок худших: дальше всего — подходящей нет и в 30 местах, затем по месту, затем по id. */
export function worstOrder(a: WorstEntry, b: WorstEntry): number {
  const place = (e: WorstEntry) => e.at.service ?? Number.POSITIVE_INFINITY;
  const severity: Diagnosis[] = ["missing", "ceiling", "words", "near", "weak"];
  return (
    place(b) - place(a) ||
    severity.indexOf(a.diagnosis) - severity.indexOf(b.diagnosis) ||
    (a.query.id < b.query.id ? -1 : a.query.id > b.query.id ? 1 : 0)
  );
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
  /** Наборы в первой пятёрке лидера прототипа — на рабочей части. */
  setShares?: SetShares;
  /**
   * Поисковый сервис (ADR-0049, ADR-0053): «Сервис» — выдача функции edge API, при доле смысла из
   * настроек (SEMANTIC_RATIO); tuned — какую долю выбрало бы правило на рабочей части. Сравнение с
   * гибридом Gemini прототипа на контрольной части: notWorse — Hit@5 не ниже или p ≥ 0,05.
   */
  service?: {
    ratio: number;
    tuned?: Tuned;
    versus?: { key: string; holdout: Paired; notWorse: boolean };
  };
  /** Списки сервиса с оценками — для диагноза худших запросов. */
  scored?: ScoredLists;
  /** Худшие запросы рабочей части у сервиса — с диагнозом (шаг 8 фазы 4, ADR-0053). */
  worst: WorstEntry[];
  /**
   * Оракул рабочей части по языкам: запрос засчитан, если хоть один вариант замера нашёл подходящую
   * иконку в пятёрке; n — все запросы языка, и с «потолком». Это потолок любой перестановки выдачи.
   */
  oracle?: Record<Lang, { hits: number; n: number }>;
  /** Наборы в первой пятёрке сервиса — на рабочей части. */
  serviceShares?: SetShares;
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
    worst: [],
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
    report.scored = s.scored;
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
  // «Сервис» — всегда выдача функции, при доле из настроек; правило на рабочей части только советует
  // (ADR-0053): долю меняет правка SEMANTIC_RATIO, а не замер.
  if (report.service) {
    const tunedRatio = tuneRatio(rankings, queries, labels);
    if (tunedRatio) report.service.tuned = tunedRatio;
    else {
      report.notes.push(
        "доля смысла сервиса по правилу не подобрана: первые десятки сетки на рабочей части размечены не целиком",
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
    report.setShares = setSharesOf(
      leader.system.model as string,
      list,
      queries.filter((q) => q.split === "work"),
      { index, labels, catalog, sets },
    );
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

  // Сервис (шаг 8 фазы 4, ADR-0053): наборы в пятёрке, оракул и худшие запросы — только рабочая часть.
  if (report.service) {
    const work = queries.filter((q) => q.split === "work");
    const serviceList = listOf(SERVICE_KEY);
    report.serviceShares = setSharesOf("Сервис", serviceList, work, {
      index,
      labels,
      catalog,
      sets,
    });
    const keys = [...rankings.lists.keys()];
    const oracle = {} as Record<Lang, { hits: number; n: number }>;
    for (const lang of LANGS) {
      const own = work.filter((q) => q.lang === lang);
      oracle[lang] = {
        n: own.length,
        hits: own.filter((q) => {
          const fits = fitsOf(labels, q.id);
          const i = index.get(q.id) as number;
          return keys.some((k) => hitAt(listOf(k)[i] ?? [], fits));
        }).length,
      };
    }
    report.oracle = oracle;
    const scored = report.scored;
    report.worst = work
      .map((q): WorstEntry => {
        const i = index.get(q.id) as number;
        const fits = fitsOf(labels, q.id);
        const ranked = serviceList[i] ?? [];
        const at: FitPlaces = {};
        const own = firstFit(ranked, fits);
        if (own !== undefined) at.service = own;
        if (scored) {
          const exact = scored.exact[i] ?? [];
          const words = firstFit(withExact(exact, scored.words[i] ?? []), fits);
          if (words !== undefined) at.words = words;
          const meaning = firstFit(
            withExact(exact, scored.meaning[i] ?? []),
            fits,
          );
          if (meaning !== undefined) at.meaning = meaning;
        }
        const known = labels.byQuery.get(q.id);
        return {
          query: q,
          fits: [...fits].sort(),
          ranked,
          at,
          partials: ranked
            .slice(0, HIT_K)
            .filter((id) => known?.get(id) === "partial").length,
          diagnosis: diagnose(fits.size, at),
        };
      })
      .sort(worstOrder)
      .slice(0, WORST);
  }
  return report;
}

/** Наборы в первой пятёрке варианта — по запросам queries и имеющейся разметке. */
function setSharesOf(
  model: string,
  list: readonly string[][],
  queries: readonly GoldenQuery[],
  ctx: {
    index: ReadonlyMap<string, number>;
    labels: Labels;
    catalog: Catalog;
    sets: readonly string[];
  },
): SetShares {
  const shares = ctx.sets.map((set) => ({
    set,
    docs: ctx.catalog.docs.filter((d) => d.set === set).length,
    fits: 0,
    slots: 0,
    slotFits: 0,
  }));
  const shareOf = (id: string) =>
    shares.find((s) => id.startsWith(`${s.set}:`));
  for (const q of queries) {
    const known = ctx.labels.byQuery.get(q.id);
    for (const [id, v] of known ?? []) {
      if (v === "fits") {
        const s = shareOf(id);
        if (s) s.fits++;
      }
    }
    for (const id of (list[ctx.index.get(q.id) as number] ?? []).slice(
      0,
      HIT_K,
    )) {
      const s = shareOf(id);
      if (!s) continue;
      s.slots++;
      if (known?.get(id) === "fits") s.slotFits++;
    }
  }
  return { model, sets: shares };
}
