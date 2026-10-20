// Описания в search.json (ADR-0020, ADR-0046): лежат только у базовых иконок. Сборка переносит их
// с диска, пока отпечаток тот же, а pnpm enrich дописывает новые. Обе команды идут через эти
// функции, поэтому повторная сборка даёт побайтно те же файлы.

import {
  type Language,
  type SearchEntry,
  type SearchFile,
  validate,
} from "@iconavo-ui/schema";
import { baseName } from "../build/aliases.js";

export interface Enrichment {
  ru: Language;
  en: Language;
  /** Версия промпта; нет — запись сделана до того, как версия стала записываться. */
  promptVersion?: number;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Базовые иконки набора (ADR-0002): имя, у которого снятие суффикса варианта не даёт другой иконки
 * набора. По алфавиту; алиасов в search.json нет, поэтому каждая база — видимая иконка.
 */
export function enrichmentBases(
  search: SearchFile,
  suffixes: readonly string[],
): string[] {
  const has = (n: string) => Object.hasOwn(search.icons, n);
  return Object.keys(search.icons)
    .filter((name) => baseName(name, suffixes, has) === name)
    .sort(order);
}

export const isEnriched = (entry: SearchEntry | undefined): boolean =>
  entry !== undefined && entry.ru !== undefined && entry.en !== undefined;

/** search.json с описаниями из results у имён, которые есть в файле; остальное без изменений. */
export function applyEnrichment(
  search: SearchFile,
  results: ReadonlyMap<string, Enrichment>,
): SearchFile {
  const icons: Record<string, SearchEntry> = {};
  for (const [name, entry] of Object.entries(search.icons)) {
    const r = results.get(name);
    if (!r) {
      icons[name] = { ...entry };
      continue;
    }
    const next: SearchEntry = {
      fingerprint: entry.fingerprint,
      tags: entry.tags,
      ru: r.ru,
      en: r.en,
    };
    if (r.promptVersion !== undefined) next.promptVersion = r.promptVersion;
    icons[name] = next;
  }
  return { prefix: search.prefix, icons };
}

export interface CarryResult {
  search: SearchFile;
  /** Базовые иконки, к которым описания перешли с диска. */
  kept: string[];
  /** Имена с диска, чьи описания не перешли: рисунок изменился, иконки нет или она не базовая. */
  dropped: string[];
  stop: string[];
}

/**
 * Переносит описания из search.json на диске (previous) в свежий search.json сборки: только базовым
 * иконкам с тем же отпечатком, переименования — по карте старое → новое имя. Файл на диске не по
 * схеме или от другого набора — «СТОП»: молча потерять оплаченные описания нельзя.
 */
export function carryEnrichment(
  fresh: SearchFile,
  previous: unknown,
  renamed: ReadonlyMap<string, string>,
  suffixes: readonly string[],
): CarryResult {
  const none = { search: fresh, kept: [], dropped: [] };
  if (previous === undefined) return { ...none, stop: [] };
  const issues = validate("search", previous);
  if (issues.length > 0) {
    return {
      ...none,
      stop: [
        `search.json на диске не проходит схему: ${issues
          .slice(0, 3)
          .map((i) => `${i.path} — ${i.message}`)
          .join("; ")}`,
      ],
    };
  }
  const before = previous as SearchFile;
  if (before.prefix !== fresh.prefix) {
    return {
      ...none,
      stop: [
        `search.json на диске — от набора «${before.prefix}», а не «${fresh.prefix}»`,
      ],
    };
  }
  const bases = new Set(enrichmentBases(fresh, suffixes));
  const results = new Map<string, Enrichment>();
  const dropped: string[] = [];
  for (const [oldName, entry] of Object.entries(before.icons)) {
    if (entry.ru === undefined || entry.en === undefined) continue;
    const name = renamed.get(oldName) ?? oldName;
    const current = fresh.icons[name];
    if (
      current !== undefined &&
      bases.has(name) &&
      current.fingerprint === entry.fingerprint
    ) {
      const value: Enrichment = { ru: entry.ru, en: entry.en };
      if (entry.promptVersion !== undefined) {
        value.promptVersion = entry.promptVersion;
      }
      results.set(name, value);
    } else {
      dropped.push(oldName);
    }
  }
  return {
    search: applyEnrichment(fresh, results),
    kept: [...results.keys()].sort(order),
    dropped: dropped.sort(order),
    stop: [],
  };
}
