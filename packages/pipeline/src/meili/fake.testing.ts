// Подменный Meilisearch для тестов: индекс, настройки, документы и задачи в памяти, журнал вызовов.
// Задачи выполняются сразу; сбой — по правилу fail. multi-search понимает ровно то, что строят
// запросы общего модуля: фильтры set IN, palette, names = и NOT names =, слова — по вхождению.

import type { MeiliClient, MeiliIndex, MeiliTask } from "./client.js";

export interface FakeMeiliOptions {
  /** Ошибка для операции и номера её вызова (с 1). */
  fail?: (op: string, call: number) => Error | undefined;
}

export interface StoredDocument {
  [key: string]: unknown;
  _vectors?: Record<string, number[] | null>;
}

export function fakeMeili(options: FakeMeiliOptions = {}) {
  let index: MeiliIndex | undefined;
  let settings: Record<string, unknown> = {};
  const docs = new Map<string, StoredDocument>();
  const tasks = new Map<number, MeiliTask>();
  const calls: string[] = [];
  const count = new Map<string, number>();
  let nextTask = 1;

  const begin = (op: string) => {
    calls.push(op);
    const n = (count.get(op) ?? 0) + 1;
    count.set(op, n);
    const error = options.fail?.(op, n);
    if (error) throw error;
  };
  const task = (type: string, run: () => void): number => {
    const uid = nextTask++;
    run();
    tasks.set(uid, { uid, status: "succeeded", type });
    return uid;
  };

  /** Условие фильтра: только те формы, что строит общий модуль. */
  const matches = (doc: StoredDocument, filter: readonly string[]) =>
    filter.every((f) => {
      let m = /^NOT names = "(.+)"$/.exec(f);
      if (m) return !(doc.names as string[]).includes(m[1] as string);
      m = /^names = "(.+)"$/.exec(f);
      if (m) return (doc.names as string[]).includes(m[1] as string);
      m = /^set IN \[(.+)\]$/.exec(f);
      if (m) return (m[1] as string).includes(`"${doc.set as string}"`);
      m = /^palette = (true|false)$/.exec(f);
      if (m) return String(doc.palette) === m[1];
      throw new Error(`подменный Meilisearch: фильтр не понят: ${f}`);
    });

  const words = (doc: StoredDocument) =>
    ["name", "tags", "synonymsEn", "synonymsRu"]
      .flatMap((k) => (doc[k] as string[]) ?? [])
      .join(" ");

  const client: MeiliClient = {
    async index() {
      begin("index");
      return index;
    },
    async createIndex(uid, primaryKey) {
      begin("createIndex");
      return task("indexCreation", () => {
        index = { uid, primaryKey };
      });
    },
    async settings() {
      begin("settings");
      return structuredClone(settings);
    },
    async updateSettings(_uid, next) {
      begin("updateSettings");
      return task("settingsUpdate", () => {
        const embedders = (next as { embedders?: unknown }).embedders;
        const before = JSON.stringify(settings.embedders ?? {});
        settings = { ...settings, ...structuredClone(next) };
        // Смена эмбеддера стирает векторы, как у Meilisearch.
        if (embedders !== undefined && JSON.stringify(embedders) !== before) {
          for (const d of docs.values()) delete d._vectors;
        }
      });
    },
    async documents(_uid, fields) {
      begin("documents");
      return [...docs.values()].map((d) =>
        Object.fromEntries(fields.map((f) => [f, d[f]])),
      );
    },
    async addDocuments(_uid, list) {
      begin("addDocuments");
      return task("documentAdditionOrUpdate", () => {
        for (const d of list as StoredDocument[]) {
          docs.set(String(d.id), structuredClone(d));
        }
      });
    },
    async deleteDocuments(_uid, ids) {
      begin("deleteDocuments");
      return task("documentDeletion", () => {
        for (const id of ids) docs.delete(id);
      });
    },
    async waitTask(uid) {
      begin("waitTask");
      const t = tasks.get(uid);
      if (!t) throw new Error(`подменный Meilisearch: нет задачи ${uid}`);
      return t;
    },
    async multiSearch(queries) {
      begin("multiSearch");
      return {
        results: (queries as Record<string, unknown>[]).map((q) => {
          const filter = (q.filter as string[] | undefined) ?? [];
          const text = String(q.q ?? "");
          const found = [...docs.values()].filter(
            (d) =>
              matches(d, filter) &&
              (text === "" ||
                text.split(" ").some((w) => words(d).includes(w))),
          );
          const offset = Number(q.offset ?? 0);
          const limit = Number(q.limit ?? 20);
          return {
            hits: found.slice(offset, offset + limit).map((d) => ({
              icon: d.icon,
              variants: d.variants,
              tones: d.tones,
            })),
          };
        }),
      };
    },
  };
  return {
    client,
    calls,
    docs,
    get settings() {
      return settings;
    },
    set settings(value: Record<string, unknown>) {
      settings = value;
    },
    get index() {
      return index;
    },
    set index(value: MeiliIndex | undefined) {
      index = value;
    },
  };
}
