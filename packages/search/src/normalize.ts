// Нормализация запроса (ADR-0049). Один и тот же текст считают робот индекса (фразы каталога заранее)
// и функция edge API (запрос пользователя), поэтому правило одно — здесь: строчные буквы, ё→е,
// дефисы, подчёркивания и пробелы — один пробел. «Shopping-Cart» и «shopping cart» дают один вектор,
// «Ёлка» и «елка» — одну фразу каталога. Правило «точное имя первым» (ADR-0009, ADR-0048) — тоже здесь.

import { isValidIconName, isValidNamePart } from "@iconavo-ui/core/internal";

const CONTROL = /\p{Cc}/gu;
const SEPARATORS = /[\s_-]+/gu;

/** Текст для вектора и для поиска по словам. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(CONTROL, " ")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(SEPARATORS, " ")
    .trim();
}

/** Запрос как имя иконки: «Shopping Cart» → `shopping-cart`, «Lucide:House» → `lucide:house`. */
export const nameForm = (query: string): string =>
  query
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

/** Имя для правила «точное имя первым»: `имя` или `набор:имя` по ADR-0001; другое — undefined. */
export function exactName(query: string): string | undefined {
  const form = nameForm(query);
  if (form.includes(":")) return isValidIconName(form) ? form : undefined;
  return isValidNamePart(form) ? form : undefined;
}

const SET_PREFIX = /^\s*([a-z0-9-]+):(.*)$/i;

/**
 * Запрос без префикса `набор:`, если такой набор есть: префикс словом не ищется (ADR-0048), а
 * `lucide:house` берёт вектор фразы `house`.
 */
export function stripSetPrefix(
  query: string,
  isSet: (id: string) => boolean,
): string {
  const m = SET_PREFIX.exec(query);
  const set = m?.[1]?.toLowerCase();
  return m && set !== undefined && isSet(set) ? (m[2] ?? "") : query;
}
