// Документ индекса (ADR-0027, ADR-0049): карточка — базовая иконка со своими вариантами, оттенки кожи
// Fluent — одна карточка (ADR-0048). Документы собирает робот индекса из data/, функция edge API
// читает из выдачи icon, variants, tones и styles, а сведения об одной иконке — ещё и about.

import type { Style } from "./styles.js";

/** Описание и синонимы на одном языке — как в search.json (ADR-0046). */
export interface SearchAboutText {
  description: string;
  synonyms: string[];
}

/**
 * Сведения базовой иконки для показа (шаг 4 фазы 4): описания и синонимы ru/en и теги — как в
 * search.json, без нормализации, с «ё» и дефисами. Не ищутся: слова для поиска — в name, tags,
 * synonymsEn и synonymsRu. Описаний ещё нет (новая иконка до pnpm enrich) — только теги.
 */
export interface SearchAbout {
  en?: SearchAboutText;
  ru?: SearchAboutText;
  tags: string[];
}

/** Документ Meilisearch. */
export interface SearchDocument {
  /** `{набор}_{имя}`: в id Meilisearch нельзя двоеточие, а в именах и наборах нет `_`. */
  id: string;
  /** Имя карточки `набор:имя`. */
  icon: string;
  set: string;
  /** Цветной набор (info.json → palette). */
  palette: boolean;
  /** SPDX-лицензия набора. */
  license: string;
  /**
   * Все имена карточки — базовое, вариантов, оттенков и алиасов, голые и как `набор:имя`: по ним
   * фильтр находит точное имя.
   */
  names: string[];
  /** Слова для поиска: имя и прежние имена — фразами, дефисы — пробелами. */
  name: string[];
  tags: string[];
  synonymsEn: string[];
  synonymsRu: string[];
  /** Другие видимые имена карточки (варианты стиля) и оттенки — без набора, по алфавиту. */
  variants: string[];
  tones: string[];
  /** Стили карточки по общей шкале (ADR-0052), в её порядке: по ним работает фильтр «Стиль». */
  style: Style[];
  /** Стиль → главное имя карточки в нём, без набора: так выдача показывает карточку в нужном стиле. */
  styles: Partial<Record<Style, string>>;
  /** Описания, синонимы и теги для показа — адрес /icon edge API (шаг 4 фазы 4). */
  about: SearchAbout;
  /** Частей в имени: при равенстве короткое имя выше. */
  parts: number;
  /**
   * Место набора в реестре: при равенстве — порядок наборов, как у прототипа. Место иконки внутри
   * набора не хранится: новая иконка сдвигала бы его у всех следующих и они уходили бы в индекс заново.
   */
  setOrder: number;
  /** Отпечаток документа без вектора: по нему робот видит, что изменилось. */
  hash: string;
  /** Хэш текста для вектора (ADR-0047); без описаний — null, и вектора у карточки нет. */
  textHash: string | null;
}

/** id документа по набору и имени карточки. */
export const documentId = (set: string, name: string): string =>
  `${set}_${name}`;
