// Сведения об одной иконке (шаг 4 фазы 4, ADR-0041): адрес /icon edge API. Его читают боковая панель
// и страница иконки на сайте, потом MCP (шаг 10). Здесь то, что функция и сайт обязаны понимать
// одинаково: запрос карточки и похожих к Meilisearch, разбор ответов, варианты по таблице стилей и
// сам ответ /icon.

import { isValidIconName, isValidNamePart } from "@iconavo-ui/core/internal";
import { EMBEDDER, INDEX_UID } from "./config.js";
import {
  documentId,
  type SearchAbout,
  type SearchAboutText,
} from "./document.js";
import type { MultiSearchQuery } from "./request.js";
import { parseHits, type SearchHit } from "./response.js";
import { DISPLAYED } from "./settings.js";
import { STYLES, type Style, type StyleTable } from "./styles.js";

/** Похожих иконок в ответе /icon. */
export const SIMILAR_LIMIT = 12;

/** Поля документа для /icon: карточка и about. */
export const ICON_FIELDS = DISPLAYED;

/** Адрес похожих документов Meilisearch — их нельзя спросить внутри multi-search. */
export const SIMILAR_PATH = `/indexes/${INDEX_UID}/similar`;

/** Карточка одной иконки из индекса — с описаниями для показа. */
export interface IconHit extends SearchHit {
  about: SearchAbout;
}

/** Варианты карточки в одном стиле общей шкалы: полные имена в порядке таблицы набора. */
export interface StyleVariants {
  style: Style;
  icons: string[];
}

/** Набор иконки в ответе /icon: как в /collections, без витрины и размеров. */
export interface IconSetSummary {
  prefix: string;
  name: string;
  author: { name: string; url?: string };
  license: { title: string; spdx: string; url?: string };
  /** true — цветной набор: цвет у иконок не меняется. */
  palette: boolean;
  /**
   * Части набора от других авторов (ADR-0017), без списков иконок — для указания авторства на весь набор
   * (решение владельца 3 ноября 2026): Feather у Lucide упоминается у любой иконки набора.
   */
  credits?: IconCredit[];
}

/** Часть набора от другого автора, к которой относится иконка (ADR-0017). */
export interface IconCredit {
  name: string;
  author: string;
  license: string;
  url: string;
}

/**
 * Ответ /icon. Все имена — полные, `набор:имя`. alias — запрошено старое имя (оно привело к icon),
 * hidden — иконка убрана автором (ADR-0018). card, style, variants и описания — из индекса поиска;
 * у скрытой или ещё не проиндексированной иконки их нет.
 */
export interface IconDetails {
  icon: string;
  alias?: string;
  hidden?: true;
  set: IconSetSummary;
  /** Карточка иконки — её база (ADR-0002). */
  card: string | null;
  /** Стиль иконки по общей шкале (ADR-0052). */
  style: Style | null;
  /** Стили карточки по шкале, внутри — варианты в порядке таблицы набора. */
  variants: StyleVariants[];
  /** Оттенки кожи Fluent Emoji в порядке TONE_SUFFIXES. */
  tones: string[];
  /** Толщина линии меняет рисунок (hasStrokeWidth ядра, ADR-0041). */
  strokes: boolean;
  description: { en: string; ru: string } | null;
  synonyms: { en: string[]; ru: string[] } | null;
  tags: string[];
  credits?: IconCredit[];
  /** Ближайшие по смыслу карточки других имён — в стиле этой иконки, если он у них есть. */
  similar: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

/** `набор:имя` → [набор, имя]. */
export function splitIconName(name: string): [string, string] {
  const at = name.indexOf(":");
  return [name.slice(0, at), name.slice(at + 1)];
}

/** Запрос карточки по любому её имени — базе, варианту, оттенку или алиасу (поле names). */
export function iconQuery(name: string): MultiSearchQuery {
  if (!isValidIconName(name)) throw new Error(`неверное имя иконки: ${name}`);
  return {
    indexUid: INDEX_UID,
    q: "",
    filter: [`names = "${name}"`],
    limit: 1,
    attributesToRetrieve: [...ICON_FIELDS],
  };
}

function aboutText(value: unknown, what: string): SearchAboutText | undefined {
  if (value === undefined) return undefined;
  if (
    !isObject(value) ||
    typeof value.description !== "string" ||
    !isStrings(value.synonyms)
  ) {
    throw new Error(`${what}: описание не по форме`);
  }
  return { description: value.description, synonyms: [...value.synonyms] };
}

/** about документа; нет поля (индекс до шага 4 фазы 4) — пусто. */
export function parseAbout(value: unknown, what: string): SearchAbout {
  if (value === undefined) return { tags: [] };
  if (!isObject(value) || !isStrings(value.tags)) {
    throw new Error(`${what}: about не по форме`);
  }
  const out: SearchAbout = { tags: [...value.tags] };
  const en = aboutText(value.en, what);
  const ru = aboutText(value.ru, what);
  if (en !== undefined) out.en = en;
  if (ru !== undefined) out.ru = ru;
  return out;
}

/** Карточка из ответа iconQuery; не нашлась — undefined, ответ не по форме — исключение. */
export function parseIconResult(result: unknown): IconHit | undefined {
  const [hit] = parseHits(result);
  if (hit === undefined) return undefined;
  const raw = (result as { hits: unknown[] }).hits[0] as Record<
    string,
    unknown
  >;
  return { ...hit, about: parseAbout(raw.about, hit.icon) };
}

/** Тело POST SIMILAR_PATH: соседи документа по его вектору — только имя и стили. */
export function similarBody(card: string): {
  id: string;
  embedder: string;
  limit: number;
  attributesToRetrieve: string[];
} {
  const [set, name] = splitIconName(card);
  return {
    id: documentId(set, name),
    embedder: EMBEDDER,
    limit: SIMILAR_LIMIT,
    attributesToRetrieve: ["icon", "styles"],
  };
}

/** Ответ похожих: карточки, без самого документа — его Meilisearch не отдаёт. */
export function parseSimilar(json: unknown): SearchHit[] {
  return parseHits(json);
}

/**
 * Варианты карточки по стилям (ADR-0052): стили — в порядке шкалы, внутри — в порядке таблицы набора.
 * Видимые имена карточки и главное имя стиля, даже если оно алиас: у Material Symbols «контур» `add`
 * — алиас `add-outline`, Google рисует их одинаково. Остальные алиасы-двойники (`home-sharp`) не
 * показываются: тот же рисунок под другим именем. Без таблицы стилей — пусто.
 */
export function cardVariants(
  hit: SearchHit,
  table: StyleTable | undefined,
): StyleVariants[] {
  const [set, base] = splitIconName(hit.icon);
  const visible = new Set([base, ...hit.variants]);
  const out: StyleVariants[] = [];
  for (const style of STYLES) {
    const list = table?.[style];
    if (list === undefined) continue;
    const names: string[] = [];
    for (const suffix of list) {
      const name = `${base}${suffix}`;
      if (
        (visible.has(name) || hit.styles[style] === name) &&
        !names.includes(name)
      ) {
        names.push(name);
      }
    }
    if (names.length > 0) {
      out.push({ style, icons: names.map((n) => `${set}:${n}`) });
    }
  }
  return out;
}

/** Стиль имени по вариантам карточки; имени там нет — null. */
export function styleOf(
  icon: string,
  variants: readonly StyleVariants[],
): Style | null {
  return variants.find((v) => v.icons.includes(icon))?.style ?? null;
}

/** Имя карточки в стиле style, если он у неё есть, иначе её база. */
export function shownInStyle(hit: SearchHit, style: Style | null): string {
  const [set] = splitIconName(hit.icon);
  const name = style === null ? undefined : hit.styles[style];
  return name !== undefined && isValidNamePart(name)
    ? `${set}:${name}`
    : hit.icon;
}
