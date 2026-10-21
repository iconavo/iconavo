// Команда pnpm enrich (шаг 10, ADR-0046): базовые иконки без описаний → PNG → пакет запросов к
// модели → ответы → data/{набор}/search.json. Состояние пакета — .cache/enrich/{набор}/batch.json:
// прерванный запуск продолжает опрос результатов, а не отправляет иконки заново. Сеть — только
// через BatchClient, поэтому в тестах его подменяют.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type MetadataFile,
  type SearchFile,
  validate,
} from "@iconavo-ui/schema";
import { canonicalJson, type Json } from "../build/json.js";
import { writeFileAtomic } from "../build/write.js";
import { stateOf } from "../changelog/state.js";
import { fingerprint } from "../metadata/fingerprint.js";
import type { NormalizedIcon } from "../normalize/normalize.js";
import { initRenderer, renderPreview } from "../qc/render.js";
import type { SourceConfig } from "../sources/config.js";
import {
  applyEnrichment,
  type Enrichment,
  enrichmentBases,
  isEnriched,
} from "./apply.js";
import {
  type BatchClient,
  type BatchRequest,
  type BatchState,
  LAST_FILE,
  type LastRun,
  readLast,
  readState,
  removeState,
  STATE_FILE,
  writeLast,
  writeState,
} from "./batch.js";
import {
  BATCH_LIMIT,
  MODEL,
  POLL_INTERVAL_MS,
  PREVIEW_SIZE,
  PROMPT_VERSION,
  REPORT_CARDS,
} from "./config.js";
import {
  type CostTotal,
  estimateCost,
  formatUsd,
  sumCost,
  type TokenUsage,
} from "./cost.js";
import { resultOutcome } from "./parse.js";
import { buildRequest, customId } from "./prompt.js";
import { type Selection, selectIcons } from "./select.js";

export interface EnrichOptions {
  /** Клиент API; нужен, если есть что отправлять или продолжать. */
  client?: BatchClient;
  /** Папка состояния пакетов, например .cache/enrich. */
  stateDir: string;
  /** Постоянная случайная выборка из N базовых иконок; нет — все без описаний. */
  limit?: number;
  /** Лимит стоимости прогона в долларах: оценка выше — ничего не отправляется. */
  maxCost: number;
  /** Только посчитать и оценить: ничего не отправлять и не писать. */
  dryRun?: boolean;
  /** false — отправить и выйти; результаты заберёт следующий запуск. */
  wait?: boolean;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export type CardStatus = "sent" | "failed" | "cached" | "planned" | "waiting";

export interface EnrichCard {
  name: string;
  icon: NormalizedIcon;
  tags: string[];
  status: CardStatus;
  /** PNG, который ушёл модели — только у отправленных в этом запуске. */
  png?: Buffer;
  value?: Enrichment;
  reason?: string;
  usage?: TokenUsage;
}

export interface SetEnrichReport {
  id: string;
  name: string;
  /** Базовых иконок в наборе; с описаниями до запуска и после. */
  bases: number;
  enrichedBefore: number;
  enrichedAfter: number;
  /** Размер выборки и сколько в ней без описаний. */
  sample: number;
  selected: number;
  /** Продолжение пакета из файла состояния. */
  resumed: boolean;
  sent: number;
  succeeded: number;
  failed: { name: string; reason: string }[];
  cards: EnrichCard[];
  /** Оценка стоимости до отправки. */
  estimate: number;
  /** Факт по ответам. */
  cost?: CostTotal;
  /** Итог последнего прогона с отправкой — когда в этом запуске отправлять было нечего. */
  last?: LastRun;
  /** Пакет ещё обрабатывается (--no-wait): его id, состояние сохранено. */
  waiting?: string;
  written: boolean;
  stop: string[];
}

export interface LoadedSet {
  search: SearchFile;
  /** Видимые иконки из icons.json. */
  icons: Map<string, NormalizedIcon>;
  suffixes: string[];
  /** Алиасы из icons.json: имя → иконка-родитель (поиску нужны прежние имена). */
  aliases: Map<string, string>;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function issuesText(
  kind: string,
  issues: readonly { path: string; message: string }[],
) {
  return `${kind} не проходит схему: ${issues
    .slice(0, 3)
    .map((i) => `${i.path} — ${i.message}`)
    .join("; ")}`;
}

/**
 * Файлы набора из data/: search.json, metadata.json (суффиксы вариантов) и видимые иконки из
 * icons.json. search.json должен быть от этой же сборки: отпечатки сверяются, иначе — подсказка.
 */
export async function loadSet(
  config: SourceConfig,
  dataDir: string,
): Promise<LoadedSet> {
  const dir = join(dataDir, config.id);
  const hint = `запустите pnpm data ${config.id}`;
  const read = async (file: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(join(dir, file), "utf8"));
    } catch {
      throw new Error(`${file} не читается — ${hint}`);
    }
  };
  const searchData = await read("search.json");
  const searchIssues = validate("search", searchData);
  if (searchIssues.length > 0) {
    throw new Error(issuesText("search.json", searchIssues));
  }
  const search = searchData as SearchFile;
  if (search.prefix !== config.id) {
    throw new Error(
      `search.json — от набора «${search.prefix}», а не «${config.id}»`,
    );
  }
  const metadataData = await read("metadata.json");
  const metadataIssues = validate("metadata", metadataData);
  if (metadataIssues.length > 0) {
    throw new Error(issuesText("metadata.json", metadataIssues));
  }
  const suffixes = Object.keys((metadataData as MetadataFile).suffixes ?? {});
  let state: ReturnType<typeof stateOf>;
  try {
    state = stateOf(await read("icons.json"));
  } catch (e) {
    throw new Error(
      `icons.json не читается: ${(e as Error).message} — ${hint}`,
    );
  }
  const icons = new Map<string, NormalizedIcon>();
  for (const [name, { icon, hidden }] of state.icons) {
    if (!hidden) icons.set(name, icon);
  }
  const names = Object.keys(search.icons);
  if (names.length !== icons.size) {
    throw new Error(
      `search.json не совпадает с icons.json: иконок ${names.length} и ${icons.size} — ${hint}`,
    );
  }
  for (const name of names) {
    const icon = icons.get(name);
    if (
      !icon ||
      fingerprint(config.id, name, icon) !== search.icons[name]?.fingerprint
    ) {
      throw new Error(
        `search.json не совпадает с icons.json («${name}») — ${hint}`,
      );
    }
  }
  return { search, icons, suffixes, aliases: state.aliases };
}

/** Базовые иконки и описания по всему каталогу — для прогноза в отчёте; набор без файлов не считается. */
export async function countBases(
  configs: readonly SourceConfig[],
  dataDir: string,
): Promise<{ bases: number; enriched: number }> {
  const total = { bases: 0, enriched: 0 };
  for (const config of configs) {
    try {
      const dir = join(dataDir, config.id);
      const search = JSON.parse(
        await readFile(join(dir, "search.json"), "utf8"),
      ) as SearchFile;
      const metadata = JSON.parse(
        await readFile(join(dir, "metadata.json"), "utf8"),
      ) as MetadataFile;
      const bases = enrichmentBases(
        search,
        Object.keys(metadata.suffixes ?? {}),
      );
      total.bases += bases.length;
      total.enriched += bases.filter((n) => isEnriched(search.icons[n])).length;
    } catch {
      // набор ещё не собран
    }
  }
  return total;
}

interface Plan {
  config: SourceConfig;
  statePath: string;
  report: SetEnrichReport;
  set?: LoadedSet;
  selection?: Selection;
  state?: BatchState;
  batchId?: string;
  /** custom_id → имя и отпечаток у отправленных сейчас или продолжаемых. */
  requests: Map<string, { name: string; fingerprint: string }>;
  pngs: Map<string, Buffer>;
  usages: Map<string, TokenUsage>;
  results?: Map<string, Enrichment>;
}

const emptyReport = (config: SourceConfig): SetEnrichReport => ({
  id: config.id,
  name: config.name,
  bases: 0,
  enrichedBefore: 0,
  enrichedAfter: 0,
  sample: 0,
  selected: 0,
  resumed: false,
  sent: 0,
  succeeded: 0,
  failed: [],
  cards: [],
  estimate: 0,
  written: false,
  stop: [],
});

const STATUS_ORDER: Record<CardStatus, number> = {
  failed: 0,
  sent: 1,
  waiting: 2,
  planned: 3,
  cached: 4,
};

/** Карточки отчёта: отказы, затем отправленные, ждущие, запланированные и уже обогащённые. */
function cards(plan: Plan): EnrichCard[] {
  const { set, selection } = plan;
  if (!set) return [];
  const names = plan.state
    ? [...plan.requests.values()].map((r) => r.name).sort(order)
    : (selection?.sample ?? []);
  const failed = new Map(plan.report.failed.map((f) => [f.name, f.reason]));
  const out: EnrichCard[] = [];
  for (const name of names) {
    const icon = set.icons.get(name);
    const entry = set.search.icons[name];
    if (!icon || !entry) continue;
    const card: EnrichCard = {
      name,
      icon,
      tags: entry.tags,
      status: "planned",
    };
    const png = plan.pngs.get(name);
    if (png) card.png = png;
    const value = plan.results?.get(name);
    const reason = failed.get(name);
    if (value) {
      card.status = "sent";
      card.value = value;
      const usage = plan.usages.get(name);
      if (usage) card.usage = usage;
    } else if (reason !== undefined) {
      card.status = "failed";
      card.reason = reason;
    } else if (isEnriched(entry) && entry.ru && entry.en) {
      card.status = "cached";
      card.value = { ru: entry.ru, en: entry.en };
      if (entry.promptVersion !== undefined) {
        card.value.promptVersion = entry.promptVersion;
      }
    } else if (plan.batchId !== undefined) {
      card.status = "waiting";
    }
    out.push(card);
  }
  return out.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || order(a.name, b.name),
  );
}

/** Отчёты наборов. PNG для модели — у всех карточек, которые попадут на страницу, не только у отправленных. */
async function finish(plans: readonly Plan[]): Promise<SetEnrichReport[]> {
  if (plans.some((p) => p.set !== undefined)) await initRenderer();
  return plans.map((p) => {
    p.report.cards = cards(p);
    for (const card of p.report.cards.slice(0, REPORT_CARDS)) {
      if (card.png) continue;
      try {
        card.png = renderPreview(card.icon, PREVIEW_SIZE);
      } catch {
        // resvg не нарисовал — карточка остаётся с одной иконкой
      }
    }
    return p.report;
  });
}

/** Результаты пакета → search.json на диске; состояние удаляется после записи. */
async function collect(
  plan: Plan & { set: LoadedSet; batchId: string },
  client: BatchClient,
  dataDir: string,
  log: (line: string) => void,
): Promise<void> {
  const { set, config, report } = plan;
  const results = new Map<string, Enrichment>();
  const usages: TokenUsage[] = [];
  const seen = new Set<string>();
  const promptVersion = plan.state?.promptVersion ?? PROMPT_VERSION;
  for await (const response of await client.results(plan.batchId)) {
    const req = plan.requests.get(response.custom_id);
    if (!req) {
      log(`${config.id}: лишний результат «${response.custom_id}» — пропущен`);
      continue;
    }
    seen.add(response.custom_id);
    if (response.result.type === "succeeded") {
      usages.push(response.result.message.usage);
      plan.usages.set(req.name, response.result.message.usage);
    }
    if (set.search.icons[req.name]?.fingerprint !== req.fingerprint) {
      report.failed.push({
        name: req.name,
        reason: "рисунок изменился после отправки — отправится снова",
      });
      continue;
    }
    const outcome = resultOutcome(response.result, req.name, promptVersion);
    if (outcome.ok) results.set(req.name, outcome.value);
    else report.failed.push({ name: req.name, reason: outcome.reason });
  }
  for (const [id, req] of plan.requests) {
    if (!seen.has(id)) {
      report.failed.push({ name: req.name, reason: "нет результата в пакете" });
    }
  }
  report.failed.sort((a, b) => order(a.name, b.name));
  report.sent = plan.requests.size;
  report.succeeded = results.size;
  report.cost = sumCost(usages);
  plan.results = results;

  const next = applyEnrichment(set.search, results);
  const issues = validate("search", next);
  if (issues.length > 0) {
    report.stop.push(issuesText("search.json после обогащения", issues));
    return;
  }
  await writeFileAtomic(
    join(dataDir, config.id, "search.json"),
    canonicalJson(next as unknown as Json),
  );
  await removeState(plan.statePath);
  const last: LastRun = {
    batchId: plan.batchId,
    promptVersion,
    sent: report.sent,
    succeeded: report.succeeded,
    failed: report.failed.length,
    cost: report.cost,
  };
  await writeLast(join(dirname(plan.statePath), LAST_FILE), last);
  report.last = last;
  report.written = true;
  report.enrichedAfter = enrichmentBases(next, set.suffixes).filter((n) =>
    isEnriched(next.icons[n]),
  ).length;
  log(
    `${config.id}: получено ${results.size} из ${plan.requests.size} · ${formatUsd(report.cost.usd)} · записано search.json`,
  );
}

const loaded = (
  p: Plan,
): p is Plan & { set: LoadedSet; selection: Selection } =>
  p.set !== undefined &&
  p.selection !== undefined &&
  p.report.stop.length === 0;

/**
 * Обогащает наборы: оценка стоимости по всем сразу, затем отправка пакетов, опрос и запись
 * search.json. Отчёт по каждому набору — и для тех, что остановились.
 */
export async function enrichSets(
  configs: readonly SourceConfig[],
  dataDir: string,
  options: EnrichOptions,
): Promise<SetEnrichReport[]> {
  const log = options.log ?? (() => {});
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  const plans: Plan[] = [];
  for (const config of configs) {
    const plan: Plan = {
      config,
      statePath: join(options.stateDir, config.id, STATE_FILE),
      report: emptyReport(config),
      requests: new Map(),
      pngs: new Map(),
      usages: new Map(),
    };
    plans.push(plan);
    const r = plan.report;
    try {
      plan.set = await loadSet(config, dataDir);
      plan.state = await readState(plan.statePath);
      const last = await readLast(join(options.stateDir, config.id, LAST_FILE));
      if (last) r.last = last;
      plan.selection = selectIcons(
        plan.set.search,
        plan.set.suffixes,
        config.id,
        options.limit,
      );
      r.bases = plan.selection.bases.length;
      r.enrichedBefore = plan.selection.enriched.length;
      r.enrichedAfter = r.enrichedBefore;
      r.sample = plan.selection.sample.length;
      r.selected = plan.selection.selected.length;
      if (plan.state) {
        r.resumed = true;
        plan.batchId = plan.state.batchId;
        for (const [id, req] of Object.entries(plan.state.requests)) {
          plan.requests.set(id, req);
        }
        log(
          `${config.id}: продолжаю пакет ${plan.state.batchId} (${plan.requests.size} иконок)`,
        );
      } else {
        r.estimate = estimateCost(Math.min(r.selected, BATCH_LIMIT));
      }
    } catch (e) {
      r.stop.push((e as Error).message);
    }
  }

  // Лимит стоимости — по сумме всех наборов до первой отправки.
  const sending = plans.filter(
    (p): p is Plan & { set: LoadedSet; selection: Selection } =>
      loaded(p) && p.state === undefined && p.selection.selected.length > 0,
  );
  const total = sending.reduce((n, p) => n + p.report.estimate, 0);
  if (total > options.maxCost) {
    for (const p of sending) {
      p.report.stop.push(
        `оценка стоимости ${formatUsd(total)}${sending.length > 1 ? " за все наборы" : ""} больше лимита ${formatUsd(options.maxCost)} — поднимите --max-cost`,
      );
    }
    return finish(plans);
  }
  if (options.dryRun) return finish(plans);

  const resuming = plans.filter(
    (p): p is Plan & { set: LoadedSet; batchId: string } =>
      loaded(p) && p.batchId !== undefined,
  );
  const client = options.client;
  if ((sending.length > 0 || resuming.length > 0) && !client) {
    throw new Error("клиент Claude API не задан");
  }
  if (!client) return finish(plans);

  if (sending.length > 0) await initRenderer();
  for (const p of sending) {
    const { set, selection, config } = p;
    const requests: BatchRequest[] = [];
    for (const name of selection.selected.slice(0, BATCH_LIMIT)) {
      const icon = set.icons.get(name);
      const entry = set.search.icons[name];
      if (!icon || !entry) continue;
      const png = renderPreview(icon, PREVIEW_SIZE);
      const id = customId(name);
      p.pngs.set(name, png);
      p.requests.set(id, { name, fingerprint: entry.fingerprint });
      requests.push({
        custom_id: id,
        params: buildRequest({
          setName: config.name,
          name,
          tags: entry.tags,
          png,
        }),
      });
    }
    const { id } = await client.create(requests);
    p.batchId = id;
    await writeState(p.statePath, {
      batchId: id,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      requests: Object.fromEntries(p.requests),
    });
    p.report.sent = requests.length;
    log(`${config.id}: отправлено ${requests.length} — пакет ${id}`);
  }

  const active = plans.filter(
    (p): p is Plan & { set: LoadedSet; batchId: string } =>
      loaded(p) && p.batchId !== undefined,
  );
  if (options.wait === false) {
    for (const p of active) p.report.waiting = p.batchId;
    return finish(plans);
  }

  let pending = active;
  while (pending.length > 0) {
    const still: typeof pending = [];
    for (const p of pending) {
      try {
        const status = await client.retrieve(p.batchId);
        const c = status.request_counts;
        if (status.processing_status === "ended") {
          log(
            `${p.config.id}: пакет завершён — готово ${c.succeeded}, ошибок ${c.errored}, истекло ${c.expired}, отменено ${c.canceled}`,
          );
          continue;
        }
        log(
          `${p.config.id}: ${status.processing_status} — в работе ${c.processing}, готово ${c.succeeded}, ошибок ${c.errored}`,
        );
        still.push(p);
      } catch (e) {
        if ((e as { status?: number }).status === 404) {
          throw new Error(
            `пакет ${p.batchId} набора ${p.config.id} не найден — удалите ${p.statePath}, если он уже не нужен`,
          );
        }
        log(
          `${p.config.id}: опрос не удался (${(e as Error).message}) — повтор через ${Math.round(interval / 1000)} с`,
        );
        still.push(p);
      }
    }
    pending = still;
    if (pending.length > 0) await sleep(interval);
  }

  for (const p of active) await collect(p, client, dataDir, log);
  return finish(plans);
}
