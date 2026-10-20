// Теги иконок (ADR-0017): теги автора — строчными, без повторов и служебных пометок; если тегов
// автора нет — части имени без суффикса варианта.

import { baseName } from "../build/aliases.js";

/** Служебные пометки вроде «*new*» и «*updated*» у Phosphor — не теги. */
const SERVICE = /^\*.*\*$/;

/**
 * Теги автора: числа становятся строками, пробелы схлопываются, буквы — строчные; пустые, служебные
 * и повторы убираются, порядок автора сохраняется. Всё, что не строка и не число, пропускается.
 */
export function authorTags(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const tag = String(value).trim().replace(/\s+/g, " ").toLowerCase();
    if (tag === "" || SERVICE.test(tag) || out.includes(tag)) continue;
    out.push(tag);
  }
  return out;
}

/**
 * Теги из частей имени: основа имени без суффикса варианта, разделённая по дефисам. Так
 * `arrow-back-ios-new-outline-rounded` даёт arrow, back, ios, new.
 */
export function nameTags(
  name: string,
  suffixes: readonly string[],
  has: (name: string) => boolean,
): string[] {
  return authorTags(baseName(name, suffixes, has).split("-"));
}
