// Что обогащать (ADR-0020): базовые иконки без описаний. С --limit — постоянная случайная выборка
// из N базовых иконок: порядок по хэшу имени, как у выборки в отчёте метаданных. Повторный запуск
// с тем же N ничего не отправляет: выборка та же, а описания у неё уже есть.

import { createHash } from "node:crypto";
import type { SearchFile } from "@iconavo-ui/schema";
import { enrichmentBases, isEnriched } from "./apply.js";

export interface Selection {
  /** Все базовые иконки набора по алфавиту. */
  bases: string[];
  /** Базовые, у которых описания уже есть. */
  enriched: string[];
  /** Выборка: N базовых по хэшу имени или все базовые, по алфавиту. */
  sample: string[];
  /** Иконки выборки без описаний — их и отправляем. */
  selected: string[];
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

export function selectIcons(
  search: SearchFile,
  suffixes: readonly string[],
  id: string,
  limit?: number,
): Selection {
  const bases = enrichmentBases(search, suffixes);
  const enriched = bases.filter((name) => isEnriched(search.icons[name]));
  const sample =
    limit === undefined
      ? bases
      : bases
          .map((name) => ({ name, key: sha1(`${id}:${name}`) }))
          .sort((x, y) => order(x.key, y.key))
          .slice(0, limit)
          .map(({ name }) => name)
          .sort(order);
  const done = new Set(enriched);
  return {
    bases,
    enriched,
    sample,
    selected: sample.filter((name) => !done.has(name)),
  };
}
