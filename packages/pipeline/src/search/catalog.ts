// Каталог прототипа поиска (шаг 12, ADR-0048): документ — базовая иконка со своими вариантами
// (ADR-0002, ADR-0027). Оттенки кожи Fluent сворачиваются в карточку базового эмодзи (решение
// владельца 21 октября 2026). Слова документа: имя и прежние имена, теги автора, синонимы ru/en;
// описания идут только в векторы. Слова вариантов (bold, outline…) не индексируются.

import { baseName } from "../build/aliases.js";
import { iconText, textHash } from "../embed/text.js";
import { enrichmentBases } from "../enrich/apply.js";
import { type LoadedSet, loadSet } from "../enrich/run.js";
import type { NormalizedIcon } from "../normalize/normalize.js";
import type { SourceConfig } from "../sources/config.js";
import { TONE_SUFFIXES } from "./config.js";
import { type DocWords, words } from "./text.js";

export interface SearchDoc {
  /** «набор:имя» базовой иконки. */
  id: string;
  set: string;
  name: string;
  icon: NormalizedIcon;
  /** Отпечаток базовой иконки (ADR-0018): разметка эталона сверяется с ним. */
  fingerprint: string;
  /** Хэш текста для эмбеддинга (ADR-0047): не совпал с векторами — вектор устарел. Без описаний — нет. */
  textHash?: string;
  /** Сам текст для эмбеддинга: по нему робот индекса считает недостающие векторы (ADR-0049). */
  text?: string;
  /**
   * Фразы для поиска по словам в сервисе (ADR-0049): имя и прежние имена, теги автора, синонимы en
   * и ru — как в файлах набора, фразами, а не отдельными словами.
   */
  phrases: {
    name: string[];
    tags: readonly string[];
    en: readonly string[];
    ru: readonly string[];
  };
  /** Другие видимые имена карточки — варианты стиля (ADR-0002), по алфавиту. */
  variants: string[];
  /** Оттенки кожи, свёрнутые в карточку. */
  tones: string[];
  /** Слова по полям, без повторов. */
  words: DocWords;
}

export interface Catalog {
  docs: SearchDoc[];
  /** «набор:имя» карточки → номер документа. */
  byId: Map<string, number>;
  /**
   * Любое имя набора — базовой иконки, варианта, оттенка, алиаса — как «набор:имя» → номер
   * документа. По нему работает правило «точное имя наверху».
   */
  names: Map<string, number>;
  /** Голое имя → документы всех наборов с таким именем. */
  bareNames: Map<string, number[]>;
  /** Частей в имени карточки: при равных оценках короткое имя (calendar) идёт раньше длинного. */
  parts: Uint8Array;
  sets: { id: string; name: string }[];
}

export interface SetDocs {
  docs: SearchDoc[];
  /** Любое имя набора → имя базовой иконки карточки. */
  names: Map<string, string>;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Слова без повторов, в порядке появления. */
const unique = (list: readonly string[]) => [...new Set(list)];

/**
 * Основа имени без суффикса варианта — самого длинного из подходящих; без суффикса — имя как есть.
 * Так прежнее имя варианта (`activity-bold` у Phosphor) сводится к основе (`activity`).
 */
function stem(name: string, suffixes: readonly string[]): string {
  let best = name;
  for (const s of suffixes) {
    if (s !== "" && name.endsWith(s) && name.length - s.length < best.length) {
      best = name.slice(0, -s.length);
    }
  }
  return best;
}

/** Документы одного набора из его файлов в data/. */
export function setDocs(config: SourceConfig, set: LoadedSet): SetDocs {
  const id = config.id;
  const has = (n: string) => set.icons.has(n);
  const bases = enrichmentBases(set.search, set.suffixes);
  const baseSet = new Set(bases);

  // Оттенки: основа и все пять оттенков — базовые иконки набора.
  const toneOf = new Map<string, string>();
  for (const b of bases) {
    const tones = TONE_SUFFIXES.map((s) => `${b}${s}`);
    if (tones.every((t) => baseSet.has(t))) {
      for (const t of tones) toneOf.set(t, b);
    }
  }
  /** Карточка, в которой показывается видимая иконка. */
  const cardOf = (name: string) => {
    const base = baseName(name, set.suffixes, has);
    return toneOf.get(base) ?? base;
  };

  const names = new Map<string, string>();
  const variants = new Map<string, string[]>();
  for (const name of set.icons.keys()) {
    const card = cardOf(name);
    names.set(name, card);
    if (name !== card && !toneOf.has(name)) {
      const list = variants.get(card) ?? [];
      list.push(name);
      variants.set(card, list);
    }
  }

  // Прежние имена: алиас ведёт к родителю. Алиас-вариант (`add-outline` → `add`) новых слов не
  // добавляет; переименование (`home` → `house`, `activity-bold` → `pulse-bold`) даёт слова имени.
  const renamed = new Map<string, string[]>();
  for (const [alias, parent] of set.aliases) {
    if (!has(parent)) continue;
    const card = cardOf(parent);
    names.set(alias, card);
    const aliasStem = stem(alias, set.suffixes);
    const parentStem = baseName(parent, set.suffixes, has);
    if (aliasStem === parentStem || aliasStem === card) continue;
    const list = renamed.get(card) ?? [];
    list.push(aliasStem);
    renamed.set(card, list);
  }

  const docs: SearchDoc[] = [];
  for (const name of bases) {
    if (toneOf.has(name)) continue;
    const icon = set.icons.get(name);
    const entry = set.search.icons[name];
    if (!icon || !entry) continue;
    const text = iconText(name, entry);
    const synonyms = [
      ...(entry.en?.synonyms ?? []),
      ...(entry.ru?.synonyms ?? []),
    ];
    const doc: SearchDoc = {
      id: `${id}:${name}`,
      set: id,
      name,
      icon,
      fingerprint: entry.fingerprint,
      variants: (variants.get(name) ?? []).sort(order),
      tones: TONE_SUFFIXES.map((s) => `${name}${s}`).filter((t) =>
        toneOf.has(t),
      ),
      phrases: {
        name: unique([name, ...(renamed.get(name) ?? [])]),
        tags: entry.tags,
        en: entry.en?.synonyms ?? [],
        ru: entry.ru?.synonyms ?? [],
      },
      words: {
        name: unique([name, ...(renamed.get(name) ?? [])].flatMap(words)),
        tags: unique(entry.tags.flatMap(words)),
        synonyms: unique(synonyms.flatMap(words)),
      },
    };
    if (text !== undefined) {
      doc.textHash = textHash(text);
      doc.text = text;
    }
    docs.push(doc);
  }
  return { docs, names };
}

/** Каталог из документов наборов; порядок документов — порядок наборов, внутри — по алфавиту. */
export function buildCatalog(
  sets: readonly { config: SourceConfig; docs: SetDocs }[],
): Catalog {
  const catalog: Catalog = {
    docs: [],
    byId: new Map(),
    names: new Map(),
    bareNames: new Map(),
    parts: new Uint8Array(0),
    sets: [],
  };
  for (const { config, docs } of sets) {
    catalog.sets.push({ id: config.id, name: config.name });
    for (const doc of docs.docs) {
      catalog.byId.set(doc.id, catalog.docs.length);
      catalog.docs.push(doc);
    }
    for (const [name, card] of docs.names) {
      const doc = catalog.byId.get(`${config.id}:${card}`);
      if (doc === undefined) continue;
      catalog.names.set(`${config.id}:${name}`, doc);
      const list = catalog.bareNames.get(name) ?? [];
      if (!list.includes(doc)) list.push(doc);
      catalog.bareNames.set(name, list);
    }
  }
  catalog.parts = Uint8Array.from(catalog.docs, (d) =>
    Math.min(255, d.name.split("-").length),
  );
  return catalog;
}

/** Каталог всех наборов, которые читаются; набор без файлов или с ошибкой — в errors. */
export async function loadCatalog(
  configs: readonly SourceConfig[],
  dataDir: string,
): Promise<{ catalog: Catalog; errors: { id: string; message: string }[] }> {
  const sets: { config: SourceConfig; docs: SetDocs }[] = [];
  const errors: { id: string; message: string }[] = [];
  for (const config of configs) {
    try {
      sets.push({
        config,
        docs: setDocs(config, await loadSet(config, dataDir)),
      });
    } catch (e) {
      errors.push({ id: config.id, message: (e as Error).message });
    }
  }
  return { catalog: buildCatalog(sets), errors };
}
