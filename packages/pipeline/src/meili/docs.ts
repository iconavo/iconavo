// Документы поискового индекса из каталога прототипа (ADR-0049): карточка — базовая иконка со своими
// вариантами, оттенки кожи Fluent — одна карточка (ADR-0048). Слова — фразами, как в файлах набора,
// нормализованные так же, как запрос (ё→е, строчные, дефисы — пробелы): Meilisearch сам делит их на
// слова. Отпечаток документа — без вектора: вектор зависит только от textHash, а он в отпечатке есть.

import { createHash } from "node:crypto";
import {
  documentId,
  normalizeText,
  type SearchDocument,
  STYLES,
} from "@iconavo-ui/search";
import { loadSetData } from "../cdn/load.js";
import { type Catalog, loadCatalog } from "../search/catalog.js";
import type { SourceConfig } from "../sources/config.js";

/** Что о наборе нужно документам: цветность и лицензия из info.json, место в реестре. */
export interface SetFacts {
  palette: boolean;
  license: string;
  order: number;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Фразы без пустых и повторов, в порядке файла набора. */
const phrases = (list: readonly string[]): string[] => [
  ...new Set(list.map(normalizeText).filter((p) => p !== "")),
];

/** Отпечаток документа без вектора: 16 символов SHA-256. */
export const documentHash = (doc: Omit<SearchDocument, "hash">): string =>
  createHash("sha256").update(JSON.stringify(doc)).digest("hex").slice(0, 16);

/** Документы всех карточек каталога в его порядке. */
export function searchDocuments(
  catalog: Catalog,
  facts: ReadonlyMap<string, SetFacts>,
): SearchDocument[] {
  // Все имена карточки — голые и с набором: по ним работает правило «точное имя первым».
  const names = catalog.docs.map(() => new Set<string>());
  for (const [full, doc] of catalog.names) {
    const set = names[doc];
    if (!set) continue;
    set.add(full);
    set.add(full.slice(full.indexOf(":") + 1));
  }
  return catalog.docs.map((doc, i) => {
    const f = facts.get(doc.set);
    if (!f) throw new Error(`нет сведений о наборе ${doc.set} (info.json)`);
    const body: Omit<SearchDocument, "hash"> = {
      id: documentId(doc.set, doc.name),
      icon: doc.id,
      set: doc.set,
      palette: f.palette,
      license: f.license,
      names: [...(names[i] ?? [])].sort(order),
      name: phrases(doc.phrases.name),
      tags: phrases(doc.phrases.tags),
      synonymsEn: phrases(doc.phrases.en),
      synonymsRu: phrases(doc.phrases.ru),
      variants: doc.variants,
      tones: doc.tones,
      style: STYLES.filter((style) => doc.styles[style] !== undefined),
      styles: doc.styles,
      about: doc.about,
      parts: catalog.parts[i] ?? 1,
      setOrder: f.order,
      textHash: doc.textHash ?? null,
    };
    return { ...body, hash: documentHash(body) };
  });
}

/** Документы индекса из data/ со сведениями о наборах — для робота индекса и проверки сайта. */
export interface LoadedDocuments {
  docs: SearchDocument[];
  catalog: Catalog;
  /** Версия каждого набора из info.json — робот сверяет их с живым манифестом. */
  versions: Map<string, string>;
  /** Наборы, которые не читаются: файлы не от этой сборки или не по схеме. */
  errors: { id: string; message: string }[];
}

/**
 * Карточки всех наборов реестра в порядке реестра (setOrder — место набора в нём). Файл набора не
 * читается — исключение от loadSetData; ошибки каталога — в errors, документов тогда нет.
 */
export async function loadSearchDocuments(
  configs: readonly SourceConfig[],
  dataDir: string,
): Promise<LoadedDocuments> {
  const facts = new Map<string, SetFacts>();
  const versions = new Map<string, string>();
  for (const [order, config] of configs.entries()) {
    const data = await loadSetData(config, dataDir);
    facts.set(config.id, {
      palette: data.info.palette,
      license: data.info.license.spdx,
      order,
    });
    versions.set(config.id, data.version);
  }
  const { catalog, errors } = await loadCatalog(configs, dataDir);
  const docs = errors.length > 0 ? [] : searchDocuments(catalog, facts);
  return { docs, catalog, versions, errors };
}
