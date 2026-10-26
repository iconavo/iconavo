// Робот поискового индекса — pnpm search-index (ADR-0049). Порядок:
// 1. Наборы из data/ и каталог прототипа → документы карточек.
// 2. Живой манифест раздачи: версии наборов в data/ те же, что на cdn.iconavo.dev, иначе «СТОП» —
//    в поиске не появятся иконки, которых ещё нет на раздаче.
// 3. Векторы иконок — из закрытого бакета; недостающие (новый текст) считает Polza, набор
//    записывается в бакет целиком: векторы, затем оглавление.
// 4. Индекс Meilisearch: настройки — только если отличаются (смена эмбеддера стирает векторы, поэтому
//    без --reembed — «СТОП»); документы — только изменившиеся по отпечатку, лишние удаляются.
// 5. Версия индекса — index.json в бакете: по ней функция edge API строит ключи кэша.
// 6. Векторы фраз каталога заранее — недостающие.
// --dry-run ничего не пишет и не тратит; без ключей — план с нуля без сети.

import { createHash } from "node:crypto";
import {
  EMBEDDER,
  INDEX_SETTINGS,
  INDEX_UID,
  type SearchDocument,
  STORE_KEYS,
  vectorBytes,
} from "@iconavo-ui/search";
import { type Manifest, manifestSchema } from "../cdn/files.js";
import { loadSetData } from "../cdn/load.js";
import { requestWithRetries, type StorageClient } from "../cdn/storage.js";
import { type EmbeddingClient, retryable } from "../embed/client.js";
import { formatRub } from "../embed/cost.js";
import { loadCatalog, type SearchDoc } from "../search/catalog.js";
import type { SourceConfig } from "../sources/config.js";
import type { FetchFn } from "../sources/npm.js";
import { pool } from "../util/pool.js";
import type { MeiliClient } from "./client.js";
import {
  DOCUMENTS_BATCH,
  JSON_TYPE,
  LIVE_MANIFEST_URL,
  PHRASES_LOG_EVERY,
  PUT_CONCURRENCY,
  REPORT_SAMPLES,
  VECTOR_TYPE,
} from "./config.js";
import { type SetFacts, searchDocuments } from "./docs.js";
import {
  type Budget,
  embedBatches,
  estimateTexts,
  searchEmbeddingModel,
} from "./embed.js";
import {
  catalogPhrases,
  type PhraseEntry,
  phraseEntries,
  storedPhraseHashes,
} from "./phrases.js";
import {
  putObject,
  readSetVectors,
  type SetVectors,
  writeSetVectors,
} from "./vectors.js";

export interface SearchIndexOptions {
  configs: readonly SourceConfig[];
  dataDir: string;
  dryRun: boolean;
  maxRub: number;
  /** Сменить эмбеддер индекса: Meilisearch сотрёт векторы, документы уйдут заново целиком. */
  reembed: boolean;
  /** Нет клиента Meilisearch или бакета — план с нуля без сети (только показ). */
  meili?: MeiliClient;
  storage?: StorageClient;
  /** Polza; нет — посчитать недостающие векторы нельзя. */
  embedder?: EmbeddingClient;
  /** Живой манифест раздачи; нет — сверка с раздачей пропускается. */
  liveManifest?: () => Promise<Manifest>;
  log?: (line: string) => void;
  /** Строка хода фраз — каждые столько фраз; по умолчанию PHRASES_LOG_EVERY. */
  phraseLogEvery?: number;
  now?: () => number;
}

export type SettingsState = "same" | "update" | "create" | "unknown";
export type DocumentChange = "add" | "update" | "delete";

export interface SetLine {
  id: string;
  version: string;
  /** Версия на раздаче; нет — сверки не было. */
  live?: string;
  cards: number;
}

export interface SearchIndexReport {
  /** offline — план без сети; dry-run — сравнение без записи; write — запись. */
  mode: "offline" | "dry-run" | "write";
  stop: string[];
  notes: string[];
  sets: SetLine[];
  cards: number;
  /** Карточек с описаниями — у них есть вектор. */
  withText: number;
  settings: SettingsState;
  settingsChanged: string[];
  documents: {
    add: number;
    update: number;
    delete: number;
    same: number;
    samples: { id: string; change: DocumentChange }[];
  };
  vectors: {
    stored: number;
    reused: number;
    missing: number;
    computed: number;
    brokenSets: string[];
  };
  phrases: { total: number; stored: number; missing: number; computed: number };
  rub: { estimate: number; spent: number; limit: number };
  version: { before?: string; after: string; written: boolean };
  ms: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const sortedStrings = (v: unknown): string[] | undefined =>
  Array.isArray(v)
    ? v
        .flatMap((item) =>
          typeof item === "string"
            ? [item]
            : // Новые версии Meilisearch отдают фильтруемые поля объектами с attributePatterns.
              isObject(item) && Array.isArray(item.attributePatterns)
              ? item.attributePatterns.filter(
                  (p): p is string => typeof p === "string",
                )
              : [JSON.stringify(item)],
        )
        .sort()
    : undefined;

/**
 * Какие настройки индекса отличаются от INDEX_SETTINGS. Сравнивается только то, что ставит робот:
 * остальное Meilisearch хранит по умолчанию. embedderChanged — эмбеддер уже есть, но другой.
 */
export function settingsDiff(current: Record<string, unknown>): {
  keys: string[];
  embedderChanged: boolean;
} {
  const keys: string[] = [];
  const want = INDEX_SETTINGS;
  for (const key of [
    "searchableAttributes",
    "displayedAttributes",
    "rankingRules",
  ] as const) {
    if (!sameJson(current[key], want[key])) keys.push(key);
  }
  for (const key of ["filterableAttributes", "stopWords"] as const) {
    if (!sameJson(sortedStrings(current[key]), [...want[key]].sort())) {
      keys.push(key);
    }
  }
  const typo = isObject(current.typoTolerance) ? current.typoTolerance : {};
  if (
    typo.enabled !== want.typoTolerance.enabled ||
    !sameJson(typo.minWordSizeForTypos, want.typoTolerance.minWordSizeForTypos)
  ) {
    keys.push("typoTolerance");
  }
  const pagination = isObject(current.pagination) ? current.pagination : {};
  if (pagination.maxTotalHits !== want.pagination.maxTotalHits) {
    keys.push("pagination");
  }
  const embedders = isObject(current.embedders) ? current.embedders : {};
  const ours = embedders[EMBEDDER];
  const wantEmbedder = want.embedders[EMBEDDER];
  const sameEmbedder =
    isObject(ours) &&
    ours.source === wantEmbedder?.source &&
    ours.dimensions === wantEmbedder?.dimensions;
  const others = Object.keys(embedders).filter((k) => k !== EMBEDDER);
  if (!sameEmbedder || others.length > 0) keys.push("embedders");
  return {
    keys,
    embedderChanged: Object.keys(embedders).length > 0 && !sameEmbedder,
  };
}

/** Версия индекса: 8 символов SHA-256 от настроек и отпечатков документов. */
export function indexVersion(docs: readonly SearchDocument[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        settings: INDEX_SETTINGS,
        documents: docs.map((d) => `${d.id} ${d.hash}`),
      }),
    )
    .digest("hex")
    .slice(0, 8);
}

/** Что отправить и что удалить: новые и изменившиеся документы, лишние в индексе. */
export function diffDocuments(
  docs: readonly SearchDocument[],
  current: ReadonlyMap<string, string>,
  all: boolean,
): {
  upsert: SearchDocument[];
  remove: string[];
  changes: { id: string; change: DocumentChange }[];
  same: number;
} {
  const upsert: SearchDocument[] = [];
  const changes: { id: string; change: DocumentChange }[] = [];
  let same = 0;
  const ids = new Set<string>();
  for (const doc of docs) {
    ids.add(doc.id);
    const hash = current.get(doc.id);
    if (hash === undefined) {
      upsert.push(doc);
      changes.push({ id: doc.id, change: "add" });
    } else if (all || hash !== doc.hash) {
      upsert.push(doc);
      changes.push({ id: doc.id, change: "update" });
    } else {
      same++;
    }
  }
  const remove = [...current.keys()].filter((id) => !ids.has(id)).sort();
  for (const id of remove) changes.push({ id, change: "delete" });
  return { upsert, remove, changes, same };
}

/** Живой манифест раздачи cdn.iconavo.dev: он идёт мимо кэша CDN (ADR-0023), так что всегда свежий. */
export function fetchLiveManifest(
  fetchFn: FetchFn = fetch,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Manifest> {
  return requestWithRetries(
    `манифест ${LIVE_MANIFEST_URL}`,
    (signal) => fetchFn(LIVE_MANIFEST_URL, { signal }),
    async (res) => manifestSchema.parse(JSON.parse(await res.text())),
    {
      runStops: {},
      retryable,
      secrets: [],
      sleep,
      timeoutMs: 30_000,
      maxAttempts: 3,
    },
  );
}

/** Версия из index.json в бакете; нет или не читается — undefined. */
async function storedVersion(
  storage: StorageClient,
): Promise<string | undefined> {
  const bytes = await storage.get(STORE_KEYS.index);
  if (bytes === undefined) return undefined;
  try {
    const json = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return isObject(json) && typeof json.version === "string"
      ? json.version
      : undefined;
  } catch {
    return undefined;
  }
}

const chunks = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export async function searchIndex(
  o: SearchIndexOptions,
): Promise<SearchIndexReport> {
  const now = o.now ?? (() => performance.now());
  const log = o.log ?? (() => {});
  const started = now();
  const model = searchEmbeddingModel();
  const report: SearchIndexReport = {
    mode: o.meili && o.storage ? (o.dryRun ? "dry-run" : "write") : "offline",
    stop: [],
    notes: [],
    sets: [],
    cards: 0,
    withText: 0,
    settings: "unknown",
    settingsChanged: [],
    documents: { add: 0, update: 0, delete: 0, same: 0, samples: [] },
    vectors: { stored: 0, reused: 0, missing: 0, computed: 0, brokenSets: [] },
    phrases: { total: 0, stored: 0, missing: 0, computed: 0 },
    rub: { estimate: 0, spent: 0, limit: o.maxRub },
    version: { after: "", written: false },
    ms: 0,
  };
  const finish = () => {
    report.ms = now() - started;
    return report;
  };
  if (report.mode === "offline" && !o.dryRun) {
    report.stop.push(
      "нет ключей Meilisearch или бакета поиска: запись невозможна, для плана запустите с --dry-run",
    );
    return finish();
  }
  try {
    // 1. Наборы и карточки.
    const facts = new Map<string, SetFacts>();
    const versions = new Map<string, string>();
    for (const [order, config] of o.configs.entries()) {
      const data = await loadSetData(config, o.dataDir);
      facts.set(config.id, {
        palette: data.info.palette,
        license: data.info.license.spdx,
        order,
      });
      versions.set(config.id, data.version);
    }
    const { catalog, errors } = await loadCatalog(o.configs, o.dataDir);
    for (const e of errors) report.stop.push(`${e.id}: ${e.message}`);
    if (report.stop.length > 0) return finish();
    const docs = searchDocuments(catalog, facts);
    const cardOf = new Map(catalog.docs.map((d) => [d.id, d]));
    report.cards = docs.length;
    report.withText = docs.filter((d) => d.textHash !== null).length;
    report.sets = o.configs.map((c) => ({
      id: c.id,
      version: versions.get(c.id) ?? "",
      cards: docs.filter((d) => d.set === c.id).length,
    }));
    report.version.after = indexVersion(docs);
    const phrases = catalogPhrases(catalog);
    report.phrases.total = phrases.length;
    log(
      `Карточек ${report.cards}, с описаниями ${report.withText}; фраз каталога ${phrases.length}`,
    );

    // 2. Индекс не обгоняет раздачу.
    if (o.liveManifest) {
      const live = (await o.liveManifest()).sets;
      const behind: string[] = [];
      for (const s of report.sets) {
        const version = live[s.id]?.version;
        if (version !== undefined) s.live = version;
        if (version !== s.version) {
          behind.push(`${s.id} ${s.version} ≠ ${version ?? "нет"}`);
        }
      }
      if (behind.length > 0) {
        const message = `версии наборов в data/ не совпадают с раздачей (${behind.join(", ")}): сначала «Выкладка», иначе в поиске появятся иконки, которых нет на CDN`;
        if (o.dryRun) report.notes.push(message);
        else {
          report.stop.push(message);
          return finish();
        }
      }
    }

    // Без ключей — план с нуля.
    if (!o.meili || !o.storage) {
      const texts = catalog.docs.flatMap((d) => (d.text ? [d.text] : []));
      report.vectors.missing = texts.length;
      report.phrases.missing = phrases.length;
      report.rub.estimate =
        estimateTexts(model, texts) + estimateTexts(model, phrases);
      report.documents.add = docs.length;
      report.notes.push(
        "без ключей Meilisearch и бакета: сеть не используется, показан план с нуля",
      );
      return finish();
    }
    const { meili, storage } = o;

    // 3. Векторы иконок в бакете.
    const stored = new Map<string, SetVectors>();
    for (const s of report.sets) {
      const read = await readSetVectors(storage, s.id);
      stored.set(s.id, read.vectors);
      report.vectors.stored += read.vectors.size;
      if (read.status === "broken") {
        report.vectors.brokenSets.push(s.id);
        report.notes.push(
          `${s.id}: векторы в бакете не читаются (${read.reason}) — набор считается заново`,
        );
      }
    }
    const missingCards: SearchDoc[] = catalog.docs.filter(
      (d) =>
        d.textHash !== undefined &&
        stored.get(d.set)?.get(d.name)?.textHash !== d.textHash,
    );
    report.vectors.missing = missingCards.length;
    report.vectors.reused = report.withText - missingCards.length;

    // 4. Фразы в бакете.
    const entries = await phraseEntries(phrases);
    const have = await storedPhraseHashes(storage);
    const missingPhrases = entries.filter((e) => !have.has(e.hash));
    report.phrases.missing = missingPhrases.length;
    report.phrases.stored = entries.length - missingPhrases.length;

    // 5. Стоимость — до отправки.
    report.rub.estimate =
      estimateTexts(
        model,
        missingCards.map((d) => d.text ?? ""),
      ) +
      estimateTexts(
        model,
        missingPhrases.map((e) => e.phrase),
      );
    if (report.rub.estimate > o.maxRub) {
      report.stop.push(
        `оценка ${formatRub(report.rub.estimate)} выше лимита ${formatRub(o.maxRub)}: поднимите --max-rub=`,
      );
      return finish();
    }

    // 6. Индекс сейчас.
    const index = await meili.index(INDEX_UID);
    const current = new Map<string, string>();
    let all = false;
    if (index === undefined) {
      report.settings = "create";
      report.settingsChanged = Object.keys(INDEX_SETTINGS);
    } else {
      if (index.primaryKey !== null && index.primaryKey !== "id") {
        report.stop.push(
          `у индекса ${INDEX_UID} первичный ключ ${index.primaryKey}, а нужен id`,
        );
        return finish();
      }
      const diff = settingsDiff(await meili.settings(INDEX_UID));
      report.settingsChanged = diff.keys;
      report.settings = diff.keys.length > 0 ? "update" : "same";
      if (diff.embedderChanged) {
        if (!o.reembed) {
          report.stop.push(
            "эмбеддер индекса другой: его смена стирает векторы всех документов — запустите с --reembed",
          );
          return finish();
        }
        all = true;
      }
      for (const d of await meili.documents(INDEX_UID, ["id", "hash"])) {
        current.set(String(d.id), String(d.hash));
      }
    }
    const diff = diffDocuments(docs, current, all);
    for (const c of diff.changes) report.documents[c.change]++;
    report.documents.same = diff.same;
    report.documents.samples = diff.changes.slice(0, REPORT_SAMPLES);
    report.version.before = await storedVersion(storage);
    log(
      `Документы: добавить ${report.documents.add}, изменить ${report.documents.update}, удалить ${report.documents.delete}, без изменений ${report.documents.same}`,
    );
    if (o.dryRun) return finish();

    // 7. Недостающие векторы иконок — набор за набором, каждый набор сразу в бакет.
    const budget: Budget = { limit: o.maxRub, spent: 0 };
    const cardsOfSet = (set: string) =>
      new Set(catalog.docs.filter((d) => d.set === set).map((d) => d.name));
    for (const s of report.sets) {
      const vectors = stored.get(s.id) ?? new Map();
      const names = cardsOfSet(s.id);
      const todo = missingCards.filter((d) => d.set === s.id);
      const stale = [...vectors.keys()].filter((name) => !names.has(name));
      if (todo.length === 0 && stale.length === 0) continue;
      if (todo.length > 0) {
        if (!o.embedder) {
          report.stop.push(
            "нет ключа POLZA_API_KEY: недостающие векторы иконок не посчитать",
          );
          return finish();
        }
        log(`${s.id}: векторы ${todo.length} иконок…`);
        const res = await embedBatches(todo, {
          client: o.embedder,
          model,
          budget,
          text: (d) => d.text ?? "",
          onBatch: async (items, batch) => {
            items.forEach((d, i) => {
              const vector = batch[i];
              if (vector && d.textHash !== undefined) {
                vectors.set(d.name, { textHash: d.textHash, vector });
              }
            });
          },
        });
        report.vectors.computed += res.computed;
        if (res.error !== undefined) {
          // Посчитанное сохраняется: следующий запуск его не оплачивает.
          await writeSetVectors(storage, s.id, vectors);
          report.rub.spent = budget.spent;
          report.stop.push(`${s.id}: векторы иконок — ${res.error}`);
          return finish();
        }
      }
      for (const name of stale) vectors.delete(name);
      await writeSetVectors(storage, s.id, vectors);
      stored.set(s.id, vectors);
    }
    report.rub.spent = budget.spent;

    // 8. Индекс: создать, настройки, документы.
    if (index === undefined) {
      await meili.waitTask(await meili.createIndex(INDEX_UID, "id"));
    }
    if (report.settings !== "same") {
      log("Настройки индекса…");
      await meili.waitTask(
        await meili.updateSettings(INDEX_UID, INDEX_SETTINGS),
      );
    }
    for (const batch of chunks(diff.upsert, DOCUMENTS_BATCH)) {
      const body = batch.map((d) => {
        const card = cardOf.get(d.icon);
        const vector =
          d.textHash === null || !card
            ? undefined
            : stored.get(d.set)?.get(card.name);
        if (d.textHash !== null && vector?.textHash !== d.textHash) {
          throw new Error(`${d.icon}: нет вектора для текста ${d.textHash}`);
        }
        return {
          ...d,
          _vectors: {
            [EMBEDDER]: vector ? Array.from(vector.vector) : null,
          },
        };
      });
      await meili.waitTask(await meili.addDocuments(INDEX_UID, body));
      log(`  записано документов: ${batch.length}`);
    }
    if (diff.remove.length > 0) {
      await meili.waitTask(await meili.deleteDocuments(INDEX_UID, diff.remove));
    }

    // 9. Версия индекса — сразу после документов: по ней меняются ключи кэша функции.
    if (report.version.before !== report.version.after) {
      const body = {
        version: report.version.after,
        documents: docs.length,
        sets: Object.fromEntries(report.sets.map((s) => [s.id, s.version])),
        updated: new Date().toISOString(),
      };
      await putObject(
        storage,
        STORE_KEYS.index,
        Buffer.from(`${JSON.stringify(body)}\n`, "utf8"),
        JSON_TYPE,
      );
      report.version.written = true;
    }

    // 10. Векторы фраз заранее.
    if (missingPhrases.length > 0) {
      if (!o.embedder) {
        report.stop.push(
          "нет ключа POLZA_API_KEY: векторы фраз каталога не посчитать",
        );
        return finish();
      }
      log(`Фразы: векторы ${missingPhrases.length}…`);
      const every = o.phraseLogEvery ?? PHRASES_LOG_EVERY;
      let done = 0;
      const res = await embedBatches<PhraseEntry>(missingPhrases, {
        client: o.embedder,
        model,
        budget,
        text: (e) => e.phrase,
        onBatch: async (items, vectors) => {
          const pairs = items.map((e, i) => ({ e, v: vectors[i] }));
          await pool(pairs, PUT_CONCURRENCY, async ({ e, v }) => {
            if (!v) return;
            await putObject(
              storage,
              STORE_KEYS.phrase(e.hash),
              vectorBytes(v),
              VECTOR_TYPE,
            );
          });
          const before = done;
          done += items.length;
          if (Math.floor(done / every) > Math.floor(before / every)) {
            log(
              `  фразы: ${done} из ${missingPhrases.length} · ${formatRub(budget.spent)}`,
            );
          }
        },
      });
      report.phrases.computed = res.computed;
      report.rub.spent = budget.spent;
      if (res.error !== undefined) {
        report.stop.push(`векторы фраз — ${res.error}`);
      }
    }
  } catch (e) {
    report.stop.push((e as Error).message);
  }
  return finish();
}
