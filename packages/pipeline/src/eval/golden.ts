// Эталон поиска (ADR-0021, ADR-0048): запросы — docs/eval/queries.csv, разметка судьи —
// docs/eval/judgments.json, правки владельца — docs/eval/overrides.json. Правки судья не трогает, и
// они главнее его вердиктов. Пара «запрос × иконка» помнит текст запроса, описание и отпечаток
// иконки: поменялось что-то из этого — пара размечается заново.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { canonicalJson, type Json } from "../build/json.js";
import { writeFileAtomic } from "../build/write.js";
import type { Catalog } from "../search/catalog.js";

export const LANGS = ["ru", "en"] as const;
export const SPLITS = ["work", "holdout"] as const;
export const TYPES = ["object", "action", "abstract", "ui", "casual"] as const;
export const VERDICTS = ["fits", "partial", "no"] as const;

export type Lang = (typeof LANGS)[number];
export type Split = (typeof SPLITS)[number];
export type QueryType = (typeof TYPES)[number];
export type Verdict = (typeof VERDICTS)[number];

export interface GoldenQuery {
  id: string;
  query: string;
  lang: Lang;
  type: QueryType;
  /** Какую иконку ожидает человек, словами (по-русски). */
  description: string;
  split: Split;
}

/** Колонки queries.csv по порядку. */
export const COLUMNS = [
  "id",
  "query",
  "lang",
  "type",
  "expected_description",
  "split",
] as const;

/** Строки CSV: поля в кавычках могут содержать запятые, кавычки ("") и переводы строк. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV: незакрытая кавычка");
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Поле CSV: в кавычках, только если в нём запятая, кавычка или перевод строки. */
export const csvCell = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const oneOf = <T extends string>(list: readonly T[], value: string) =>
  (list as readonly string[]).includes(value);

/** Запросы эталона; колонки, языки, типы, части и id сверяются. */
export function parseQueries(text: string): GoldenQuery[] {
  const [head, ...rows] = parseCsv(text);
  if (!head || head.join(",") !== COLUMNS.join(",")) {
    throw new Error(
      `queries.csv: колонки «${head?.join(",") ?? ""}», а нужны «${COLUMNS.join(",")}»`,
    );
  }
  const seen = new Set<string>();
  return rows
    .filter((r) => r.some((c) => c !== ""))
    .map((r, i) => {
      const [id, query, lang, type, description, split] = r as string[];
      const line = i + 2;
      if (r.length !== COLUMNS.length) {
        throw new Error(`queries.csv, строка ${line}: полей ${r.length}`);
      }
      if (!id || !query || !description) {
        throw new Error(`queries.csv, строка ${line}: пустое поле`);
      }
      if (!oneOf(LANGS, lang ?? "") || !oneOf(TYPES, type ?? "")) {
        throw new Error(
          `queries.csv, строка ${line}: язык или тип не из списка`,
        );
      }
      if (!oneOf(SPLITS, split ?? "")) {
        throw new Error(
          `queries.csv, строка ${line}: часть не work и не holdout`,
        );
      }
      if (seen.has(id)) throw new Error(`queries.csv: id ${id} повторяется`);
      seen.add(id);
      return {
        id,
        query,
        lang: lang as Lang,
        type: type as QueryType,
        description,
        split: split as Split,
      };
    });
}

export async function readQueries(path: string): Promise<GoldenQuery[]> {
  return parseQueries(await readFile(path, "utf8"));
}

const verdictSchema = z.enum(VERDICTS);

const judgedSchema = z.strictObject({
  verdict: verdictSchema,
  /** Отпечаток иконки, которую видел судья (ADR-0018). */
  fingerprint: z.string().regex(/^[0-9a-f]{12}$/),
  /** Второй вердикт той же пары в другом окружении — для согласия судьи с собой. */
  repeat: verdictSchema.optional(),
});

export const judgmentsSchema = z.strictObject({
  judge: z.strictObject({
    model: z.string().min(1),
    promptVersion: z.number().int().positive(),
  }),
  /** Сколько стоила разметка за все запуски: по ней же оценивается следующий. */
  spent: z
    .strictObject({
      requests: z.number().int().nonnegative(),
      images: z.number().int().nonnegative(),
      rub: z.number().nonnegative(),
    })
    .optional(),
  queries: z.record(
    z.string(),
    z.strictObject({
      /** Текст запроса и описание, которые видел судья. */
      query: z.string().min(1),
      description: z.string().min(1),
      icons: z.record(z.string(), judgedSchema),
    }),
  ),
});

export type Judgments = z.infer<typeof judgmentsSchema>;
export type Judged = z.infer<typeof judgedSchema>;

export const overridesSchema = z.record(
  z.string(),
  z.record(z.string(), verdictSchema),
);

export type Overrides = z.infer<typeof overridesSchema>;

async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} — не JSON`);
  }
}

/** Разметка судьи; нет файла — пустая. Другая модель или версия промпта — тоже пустая. */
export async function readJudgments(
  path: string,
  judge: Judgments["judge"],
): Promise<{ judgments: Judgments; reset?: string }> {
  const empty: Judgments = { judge, queries: {} };
  const data = await readJsonFile(path);
  if (data === undefined) return { judgments: empty };
  const parsed = judgmentsSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${path} не по формату: ${issue ? `${issue.path.join(".")} — ${issue.message}` : "?"}`,
    );
  }
  const j = parsed.data;
  if (
    j.judge.model !== judge.model ||
    j.judge.promptVersion !== judge.promptVersion
  ) {
    return {
      judgments: empty,
      reset: `разметка сделана ${j.judge.model}, промпт ${j.judge.promptVersion} — размечается заново`,
    };
  }
  return { judgments: j };
}

export async function writeJudgments(
  path: string,
  j: Judgments,
): Promise<void> {
  await writeFileAtomic(path, canonicalJson(j as unknown as Json));
}

/** Правки владельца; нет файла — правок нет. */
export async function readOverrides(path: string): Promise<Overrides> {
  const data = await readJsonFile(path);
  if (data === undefined) return {};
  const parsed = overridesSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${path} не по формату: ${issue ? `${issue.path.join(".")} — ${issue.message}` : "?"}`,
    );
  }
  return parsed.data;
}

export interface Labels {
  /** id запроса → «набор:имя» карточки → вердикт (правки владельца поверх судьи). */
  byQuery: Map<string, Map<string, Verdict>>;
  /** Пар, у которых поменялся рисунок, и запросов, у которых поменялся текст: размечаются заново. */
  staleIcons: number;
  staleQueries: number;
  /** Имён из разметки, которых больше нет в каталоге. */
  unknown: number;
  /** Правок владельца, которые применены. */
  overridden: number;
}

/**
 * Действующая разметка: вердикты судьи с тем же текстом запроса и отпечатком иконки плюс правки
 * владельца. Имя, ставшее алиасом или вариантом, сводится к карточке.
 */
export function currentLabels(
  queries: readonly GoldenQuery[],
  judgments: Judgments,
  overrides: Overrides,
  catalog: Catalog,
): Labels {
  const labels: Labels = {
    byQuery: new Map(),
    staleIcons: 0,
    staleQueries: 0,
    unknown: 0,
    overridden: 0,
  };
  const cardOf = (name: string) => {
    const doc = catalog.names.get(name) ?? catalog.byId.get(name);
    return doc === undefined ? undefined : catalog.docs[doc];
  };
  for (const q of queries) {
    const map = new Map<string, Verdict>();
    labels.byQuery.set(q.id, map);
    const entry = judgments.queries[q.id];
    if (
      entry &&
      (entry.query !== q.query || entry.description !== q.description)
    ) {
      labels.staleQueries++;
    } else if (entry) {
      for (const [name, judged] of Object.entries(entry.icons)) {
        const doc = cardOf(name);
        if (!doc) labels.unknown++;
        else if (doc.fingerprint !== judged.fingerprint) labels.staleIcons++;
        else map.set(doc.id, judged.verdict);
      }
    }
    for (const [name, verdict] of Object.entries(overrides[q.id] ?? {})) {
      const doc = cardOf(name);
      if (!doc) {
        labels.unknown++;
        continue;
      }
      map.set(doc.id, verdict);
      labels.overridden++;
    }
  }
  return labels;
}

/** Подходящие карточки запроса — те, что считает Hit@5. */
export const fitsOf = (labels: Labels, id: string): Set<string> =>
  new Set(
    [...(labels.byQuery.get(id) ?? [])]
      .filter(([, v]) => v === "fits")
      .map(([name]) => name),
  );
