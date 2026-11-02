// Карточки вариантов (ADR-0002, ADR-0048, ADR-0052): базовая иконка со своими вариантами стиля,
// оттенки кожи Fluent — в карточке базового эмодзи. Одно правило на робота индекса, прототип поиска и
// страницы наборов сайта: одна и та же иконка везде попадает в одну и ту же карточку.

import {
  STYLES,
  type Style,
  type StyleTable,
  styleCandidates,
} from "./styles.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Оттенки кожи Fluent Emoji (решение владельца 21 октября 2026): иконка с основой и всеми пятью
 * оттенками — одна карточка. Только при всех пяти: `police-car-light` и светофоры — не оттенки.
 */
export const TONE_SUFFIXES: readonly string[] = [
  "-light",
  "-medium-light",
  "-medium",
  "-medium-dark",
  "-dark",
];

/**
 * Основа имени варианта (ADR-0002): самое короткое имя, которое получается, если снять суффикс
 * варианта, и которое само есть в наборе. У `done-outline-rounded` это `done-outline`, если иконки
 * `done` нет. Ни один суффикс не подошёл — имя и есть основа.
 */
export function baseName(
  name: string,
  suffixes: readonly string[],
  has: (name: string) => boolean,
): string {
  let base = name;
  for (const suffix of suffixes) {
    if (suffix === "" || !name.endsWith(suffix)) continue;
    const candidate = name.slice(0, -suffix.length);
    if (candidate.length < base.length && has(candidate)) base = candidate;
  }
  return base;
}

/** Карточка: базовая иконка, её варианты, оттенки и главное имя каждого стиля. */
export interface Card {
  base: string;
  /** Другие видимые имена карточки — варианты стиля, по кодам символов. */
  variants: string[];
  /** Оттенки кожи в порядке TONE_SUFFIXES. */
  tones: string[];
  /** Стиль → главное имя карточки в нём (бывает и алиасом); стили — в порядке шкалы. */
  styles: Partial<Record<Style, string>>;
}

export interface CardsInput {
  /** Видимые имена набора. */
  names: Iterable<string>;
  /** Алиасы: имя → родитель. */
  aliases?: Iterable<readonly [string, string]>;
  /** Суффиксы вариантов — ключи карты suffixes; "" — основной вариант. */
  suffixes: readonly string[];
  /** Таблица стилей набора; нет — у карточек нет стилей. */
  styles?: StyleTable;
}

export interface CardSet {
  /** Карточки по кодам символов имени базовой иконки. */
  cards: Card[];
  /** Видимое имя или алиас видимой иконки → имя карточки. */
  cardOf: Map<string, string>;
}

/**
 * Карточки набора. Основа — baseName по видимым именам; оттенки — только при всех пяти; алиас — в
 * карточке своего родителя. Главное имя стиля — первое из styleCandidates, которое принадлежит
 * карточке: у Material Symbols «контур» `add` — алиас `add-outline`, Google рисует их одинаково.
 */
export function groupCards(input: CardsInput): CardSet {
  const names = [...new Set(input.names)].sort(order);
  const visible = new Set(names);
  const has = (n: string) => visible.has(n);
  const baseOf = new Map(
    names.map((n) => [n, baseName(n, input.suffixes, has)] as const),
  );
  const bases = names.filter((n) => baseOf.get(n) === n);
  const baseSet = new Set(bases);

  const toneOf = new Map<string, string>();
  for (const b of bases) {
    const tones = TONE_SUFFIXES.map((s) => `${b}${s}`);
    if (tones.every((t) => baseSet.has(t))) {
      for (const t of tones) toneOf.set(t, b);
    }
  }

  const cardOf = new Map<string, string>();
  const variants = new Map<string, string[]>();
  for (const n of names) {
    const base = baseOf.get(n) ?? n;
    const card = toneOf.get(base) ?? base;
    cardOf.set(n, card);
    if (n !== card && !toneOf.has(n)) {
      const list = variants.get(card) ?? [];
      list.push(n);
      variants.set(card, list);
    }
  }
  for (const [alias, parent] of input.aliases ?? []) {
    const card = cardOf.get(parent);
    if (card !== undefined && !visible.has(alias)) cardOf.set(alias, card);
  }

  const cards: Card[] = [];
  for (const base of bases) {
    if (toneOf.has(base)) continue;
    const styles: Partial<Record<Style, string>> = {};
    for (const style of STYLES) {
      const list = input.styles?.[style];
      if (list === undefined) continue;
      const hit = styleCandidates(list)
        .map((s) => `${base}${s}`)
        .find((n) => cardOf.get(n) === base);
      if (hit !== undefined) styles[style] = hit;
    }
    cards.push({
      base,
      variants: variants.get(base) ?? [],
      tones: TONE_SUFFIXES.map((s) => `${base}${s}`).filter((t) =>
        toneOf.has(t),
      ),
      styles,
    });
  }
  return { cards, cardOf };
}
