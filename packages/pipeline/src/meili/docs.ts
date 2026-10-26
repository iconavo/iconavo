// Документы поискового индекса из каталога прототипа (ADR-0049): карточка — базовая иконка со своими
// вариантами, оттенки кожи Fluent — одна карточка (ADR-0048). Слова — фразами, как в файлах набора,
// нормализованные так же, как запрос (ё→е, строчные, дефисы — пробелы): Meilisearch сам делит их на
// слова. Отпечаток документа — без вектора: вектор зависит только от textHash, а он в отпечатке есть.

import { createHash } from "node:crypto";
import {
  documentId,
  normalizeText,
  type SearchDocument,
} from "@iconavo-ui/search";
import type { Catalog } from "../search/catalog.js";

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
      parts: catalog.parts[i] ?? 1,
      setOrder: f.order,
      textHash: doc.textHash ?? null,
    };
    return { ...body, hash: documentHash(body) };
  });
}
