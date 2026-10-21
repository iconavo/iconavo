// Команда pnpm embed (шаг 11, ADR-0047): тексты базовых иконок с описаниями → векторы трёх моделей
// через Polza AI → .cache/embeddings/{модель}/{набор}. Кэш — по хэшу текста: повторный запуск без
// изменений ничего не отправляет и стоит 0 ₽. Сеть — только через EmbeddingClient, поэтому в
// тестах его подменяют.

import { enrichmentBases } from "../enrich/apply.js";
import { type LoadedSet, loadSet } from "../enrich/run.js";
import type { SourceConfig } from "../sources/config.js";
import { pool } from "../util/pool.js";
import { type EmbeddingClient, errorScope } from "./client.js";
import {
  CONCURRENCY,
  type EmbeddingModel,
  MODELS,
  SAVE_EVERY_BATCHES,
} from "./config.js";
import {
  addSpent,
  estimateRub,
  formatRub,
  noSpent,
  rubOfTokens,
  type Spent,
} from "./cost.js";
import {
  readIndex,
  readStore,
  type StoredVectors,
  type StoreIndex,
  type StoreRow,
  writeStore,
} from "./store.js";
import { iconText, textHash } from "./text.js";

export interface IconText {
  name: string;
  text: string;
  hash: string;
}

export interface SetTexts {
  config: SourceConfig;
  set: LoadedSet;
  /** Базовых иконок в наборе. */
  bases: number;
  /** Базовые с описаниями, по алфавиту: их и векторизуем (ADR-0046). */
  items: IconText[];
  /** Базовые без описаний — сначала pnpm enrich. */
  missing: string[];
}

/** Файлы набора из data/ (с проверкой, что они от этой сборки) и тексты его базовых иконок. */
export async function setTexts(
  config: SourceConfig,
  dataDir: string,
): Promise<SetTexts> {
  const set = await loadSet(config, dataDir);
  const bases = enrichmentBases(set.search, set.suffixes);
  const items: IconText[] = [];
  const missing: string[] = [];
  for (const name of bases) {
    const entry = set.search.icons[name];
    const text = entry ? iconText(name, entry) : undefined;
    if (text === undefined) missing.push(name);
    else items.push({ name, text, hash: textHash(text) });
  }
  return { config, set, bases: bases.length, items, missing };
}

export interface EmbedOptions {
  /** Клиент Polza; нужен, если есть что отправлять. */
  client?: EmbeddingClient;
  /** Папка векторов, например .cache/embeddings. */
  storeDir: string;
  /** Модели прогона; по умолчанию все из конфига. */
  models?: readonly EmbeddingModel[];
  /** Лимит стоимости прогона в рублях. */
  maxRub: number;
  /** Только посчитать и оценить: ничего не отправлять и не писать. */
  dryRun?: boolean;
  /** Пачек одной модели одновременно. */
  concurrency?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export interface SetInfo {
  id: string;
  name: string;
  bases: number;
  /** Базовых с описаниями. */
  withText: number;
  missing: string[];
  stop: string[];
}

export interface ModelSetReport {
  id: string;
  /** Векторов из кэша; текстов к отправке и сколько из них посчитано. */
  cached: number;
  todo: number;
  computed: number;
  /** Символов в текстах к отправке и оценка в рублях. */
  chars: number;
  estimate: number;
  /** Расход этого прогона и всего набора с первого прогона. */
  spent: Spent;
  total: Spent;
  /** Векторов на диске и размер файла векторов. */
  stored: number;
  bytes: number;
  written: boolean;
  /** Почему кэш не подошёл. */
  notes: string[];
}

export interface ModelEmbedReport {
  model: EmbeddingModel;
  sets: ModelSetReport[];
  /** Сколько шла отправка этой модели и ответы на каждую пачку, мс. */
  ms: number;
  batchMs: number[];
  stop: string[];
}

export interface EmbedReport {
  sets: SetInfo[];
  models: ModelEmbedReport[];
  /** Оценка до отправки и факт этого прогона. */
  estimate: number;
  spent: Spent;
  /** Остановки всего прогона: лимит, ключ, баланс. */
  stop: string[];
}

export const hasStop = (r: EmbedReport): boolean =>
  r.stop.length > 0 ||
  r.sets.some((s) => s.stop.length > 0) ||
  r.models.some((m) => m.stop.length > 0);

interface Work {
  texts: SetTexts;
  report: ModelSetReport;
  todo: IconText[];
  /** Писать файлы: есть новые тексты или в кэше лишние строки. */
  write: boolean;
}

/** Хэш текста → строка в векторах на диске. */
const rowsByHash = (index: StoreIndex | undefined) => {
  const out = new Map<string, number>();
  index?.rows.forEach((row, i) => {
    out.set(row.textHash, i);
  });
  return out;
};

const sameRows = (index: StoreIndex, items: readonly IconText[]) =>
  index.rows.length === items.length &&
  index.rows.every(
    (row, i) => row.name === items[i]?.name && row.textHash === items[i]?.hash,
  );

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Векторы набора на диск: кэш и новые — по алфавиту; чего нет ни там ни там, посчитается в
 * следующий раз. Расход — накопленный: с диска плюс этот прогон.
 */
async function writeRows(
  storeDir: string,
  model: EmbeddingModel,
  w: Work,
  store: StoredVectors | undefined,
  fresh: ReadonlyMap<string, Float32Array>,
): Promise<{ index: StoreIndex; total: Spent }> {
  const dims = model.dims;
  const old = rowsByHash(store?.index);
  const rows: StoreRow[] = [];
  const vectors = new Float32Array(w.texts.items.length * dims);
  for (const it of w.texts.items) {
    const offset = rows.length * dims;
    const vector = fresh.get(it.hash);
    const row = old.get(it.hash);
    if (vector) vectors.set(vector, offset);
    else if (store && row !== undefined) {
      vectors.set(store.vectors.subarray(row * dims, (row + 1) * dims), offset);
    } else continue;
    rows.push({ name: it.name, textHash: it.hash });
  }
  const total = addSpent(store?.index.spent ?? noSpent(), w.report.spent);
  const index = await writeStore(
    storeDir,
    model,
    w.texts.config.id,
    rows,
    rows.length === w.texts.items.length
      ? vectors
      : vectors.slice(0, rows.length * dims),
    total,
  );
  return { index, total };
}

/**
 * Векторы наборов: оценка стоимости по всем моделям сразу, затем пачки к Polza и запись. Отчёт —
 * и для тех наборов и моделей, что остановились.
 */
export async function embedSets(
  configs: readonly SourceConfig[],
  dataDir: string,
  options: EmbedOptions,
): Promise<EmbedReport> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => performance.now());
  const models = options.models ?? MODELS;
  const limit = options.concurrency ?? CONCURRENCY;
  const report: EmbedReport = {
    sets: [],
    models: [],
    estimate: 0,
    spent: noSpent(),
    stop: [],
  };

  const texts: SetTexts[] = [];
  for (const config of configs) {
    const info: SetInfo = {
      id: config.id,
      name: config.name,
      bases: 0,
      withText: 0,
      missing: [],
      stop: [],
    };
    report.sets.push(info);
    try {
      const t = await setTexts(config, dataDir);
      texts.push(t);
      info.bases = t.bases;
      info.withText = t.items.length;
      info.missing = t.missing;
    } catch (e) {
      info.stop.push((e as Error).message);
    }
  }

  // Что уже посчитано: векторы с диска подходят по хэшу текста. Векторы здесь только проверяются —
  // в памяти держится одна модель и один набор за раз.
  const plans: { model: ModelEmbedReport; work: Work[] }[] = [];
  for (const model of models) {
    const mr: ModelEmbedReport = {
      model,
      sets: [],
      ms: 0,
      batchMs: [],
      stop: [],
    };
    report.models.push(mr);
    const work: Work[] = [];
    for (const t of texts) {
      const id = t.config.id;
      const read = await readStore(options.storeDir, model, id);
      const index = read.kind === "ok" ? read.store.index : undefined;
      const r: ModelSetReport = {
        id,
        cached: 0,
        todo: 0,
        computed: 0,
        chars: 0,
        estimate: 0,
        spent: noSpent(),
        total: index?.spent ?? noSpent(),
        stored: index?.count ?? 0,
        bytes: index?.bytes ?? 0,
        written: false,
        notes: [],
      };
      if (read.kind === "broken") {
        r.notes.push(`${read.reason} — векторы посчитаются заново`);
        log(`${model.key}/${id}: ${read.reason} — векторы посчитаются заново`);
      }
      const old = rowsByHash(index);
      const todo = t.items.filter((it) => !old.has(it.hash));
      r.cached = t.items.length - todo.length;
      r.todo = todo.length;
      r.chars = todo.reduce((n, it) => n + it.text.length, 0);
      r.estimate = estimateRub(model, r.chars);
      report.estimate += r.estimate;
      mr.sets.push(r);
      work.push({
        texts: t,
        report: r,
        todo,
        write: todo.length > 0 || !index || !sameRows(index, t.items),
      });
    }
    plans.push({ model: mr, work });
  }

  // Лимит стоимости — по сумме всех моделей и наборов до первой отправки.
  if (report.estimate > options.maxRub) {
    report.stop.push(
      `оценка стоимости ${formatRub(report.estimate)} больше лимита ${formatRub(options.maxRub)} — поднимите --max-rub`,
    );
    return report;
  }
  if (options.dryRun) return report;
  const client = options.client;
  if (plans.some((p) => p.work.some((w) => w.todo.length > 0)) && !client) {
    throw new Error("клиент Polza не задан");
  }

  let runStopped = false;
  for (const { model: mr, work } of plans) {
    const model = mr.model;
    if (runStopped) break;
    const sending = work.reduce((n, w) => n + w.todo.length, 0);
    if (sending > 0) {
      log(
        `${model.key}: отправляю ${sending} текстов — ${model.id}, оценка ${formatRub(work.reduce((n, w) => n + w.report.estimate, 0))}`,
      );
    }
    const started = now();
    let modelStopped = false;
    for (const w of work) {
      if (!w.write || runStopped || modelStopped) continue;
      const id = w.texts.config.id;
      const read = await readStore(options.storeDir, model, id);
      const store: StoredVectors | undefined =
        read.kind === "ok" ? read.store : undefined;
      const fresh = new Map<string, Float32Array>();
      const batches = chunks(w.todo, model.batchSize);
      let done = 0;
      let answered = 0;
      // Запись по ходу — по очереди, чтобы оглавление и векторы были из одного снимка: если
      // прогон оборвут, пропадут только пачки после последней записи.
      let saving: Promise<unknown> = Promise.resolve();
      const save = () => {
        const next = saving.then(() =>
          writeRows(options.storeDir, model, w, store, fresh),
        );
        saving = next.catch(() => {});
        return next;
      };
      await pool(batches, limit, async (batch) => {
        if (runStopped || modelStopped || !client) return;
        try {
          const res = await client.embed(
            model,
            batch.map((it) => it.text),
          );
          batch.forEach((it, i) => {
            const vector = res.vectors[i];
            if (vector) fresh.set(it.hash, vector);
          });
          const chars = batch.reduce((n, it) => n + it.text.length, 0);
          const rub =
            res.rub ??
            (res.tokens === undefined
              ? estimateRub(model, chars)
              : rubOfTokens(model, res.tokens));
          const spent: Spent = {
            requests: 1,
            texts: batch.length,
            tokens: res.tokens ?? 0,
            chars,
            rub,
            rubCalculated: res.rub === undefined ? rub : 0,
          };
          w.report.spent = addSpent(w.report.spent, spent);
          report.spent = addSpent(report.spent, spent);
          mr.batchMs.push(res.ms);
          done += batch.length;
          answered++;
          if (answered % SAVE_EVERY_BATCHES === 0 && done < w.todo.length) {
            await save();
            log(`${model.key}/${id}: ${done} из ${w.todo.length} · сохранено`);
          }
          if (report.spent.rub > options.maxRub && !runStopped) {
            runStopped = true;
            report.stop.push(
              `потрачено ${formatRub(report.spent.rub)} — больше лимита ${formatRub(options.maxRub)}: новые пачки не отправляются`,
            );
          }
        } catch (e) {
          const message = (e as Error).message;
          if (errorScope(e) === "run") {
            if (!runStopped) report.stop.push(message);
            runStopped = true;
          } else {
            if (!modelStopped) mr.stop.push(message);
            modelStopped = true;
          }
        }
      });

      const { index, total } = await save();
      w.report.computed = fresh.size;
      w.report.stored = index.count;
      w.report.bytes = index.bytes;
      w.report.total = total;
      w.report.written = true;
      if (w.todo.length > 0) {
        log(
          `${model.key}/${id}: посчитано ${fresh.size} из ${w.todo.length} · ${formatRub(w.report.spent.rub)} · векторов на диске ${index.count}`,
        );
      }
    }
    mr.ms = now() - started;
  }
  return report;
}

export interface StatusCell {
  id: string;
  /** Базовых с описаниями и сколько из них с векторами по текущему тексту. */
  withText: number;
  fresh: number;
  stored: number;
  bytes: number;
  /** Расход на векторы набора с первого прогона. */
  spent: Spent;
  note?: string;
}

export interface ModelStatus {
  model: EmbeddingModel;
  sets: StatusCell[];
}

/**
 * Готовность векторов по каталогу (условие шага 11 — векторы всех пяти наборов во всех моделях):
 * по оглавлениям, без чтения самих векторов.
 */
export async function embedStatus(
  texts: readonly SetTexts[],
  storeDir: string,
  models: readonly EmbeddingModel[] = MODELS,
): Promise<ModelStatus[]> {
  const out: ModelStatus[] = [];
  for (const model of models) {
    const sets: StatusCell[] = [];
    for (const t of texts) {
      const head = await readIndex(storeDir, model, t.config.id);
      const cell: StatusCell = {
        id: t.config.id,
        withText: t.items.length,
        fresh: 0,
        stored: 0,
        bytes: 0,
        spent: noSpent(),
      };
      if (head.kind === "ok") {
        const hashes = new Set(head.index.rows.map((r) => r.textHash));
        cell.fresh = t.items.filter((it) => hashes.has(it.hash)).length;
        cell.stored = head.index.count;
        cell.bytes = head.index.bytes;
        cell.spent = head.index.spent;
      } else if (head.kind === "broken") {
        cell.note = head.reason;
      }
      sets.push(cell);
    }
    out.push({ model, sets });
  }
  return out;
}

/** Тексты всех наборов, которые читаются; набор без файлов или с ошибкой — в errors. */
export async function loadTexts(
  configs: readonly SourceConfig[],
  dataDir: string,
): Promise<{ texts: SetTexts[]; errors: { id: string; message: string }[] }> {
  const texts: SetTexts[] = [];
  const errors: { id: string; message: string }[] = [];
  for (const config of configs) {
    try {
      texts.push(await setTexts(config, dataDir));
    } catch (e) {
      errors.push({ id: config.id, message: (e as Error).message });
    }
  }
  return { texts, errors };
}
