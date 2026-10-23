// Параметры адреса (ADR-0024). Каждый известный — не больше одного раза, пустой — как отсутствующий;
// неизвестные не читаются и в ключ кэша не входят. Значения проверяются по закрытым правилам: в SVG
// и CSS попадает только то, что прошло проверку, — так ни цвет, ни размер не подменят разметку.

import { isValidNamePart } from "@iconavo-ui/core";
import { MAX_ICONS, MAX_NAME_LENGTH, MAX_VALUE_LENGTH } from "./config.js";
import { ApiError } from "./http.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Значение параметра: повтор — 400, пустое — undefined. */
export function single(
  query: URLSearchParams,
  name: string,
  maxLength = MAX_VALUE_LENGTH,
): string | undefined {
  const values = query.getAll(name);
  if (values.length > 1) {
    throw new ApiError(
      400,
      "duplicate_parameter",
      `Parameter "${name}" is given ${values.length} times`,
    );
  }
  const value = values[0];
  if (value === undefined || value === "") return undefined;
  if (value.length > maxLength) {
    throw new ApiError(
      400,
      "invalid_parameter",
      `Parameter "${name}" is longer than ${maxLength} characters`,
    );
  }
  return value;
}

/** Имя иконки, которое имеет смысл искать в R2: правило ADR-0001 и длина. */
export const searchable = (name: string) =>
  name.length <= MAX_NAME_LENGTH && isValidNamePart(name);

/** Имена пачки и CSS: только через запятую, без повторов, по кодам символов — порядок не важен. */
export function parseNames(query: URLSearchParams): string[] {
  const value = single(query, "icons", Number.POSITIVE_INFINITY);
  const names = [
    ...new Set((value ?? "").split(",").filter((n) => n !== "")),
  ].sort(order);
  if (names.length === 0) {
    throw new ApiError(
      400,
      "icons_required",
      'Parameter "icons" with comma-separated icon names is required',
    );
  }
  if (names.length > MAX_ICONS) {
    throw new ApiError(
      400,
      "too_many_icons",
      `At most ${MAX_ICONS} icons per request, got ${names.length}`,
    );
  }
  return names;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED = /^[a-z]{3,20}$/i;
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:%|deg|turn|rad|grad)?";
// Только обычный пробел: \s пропустил бы управляющие символы, а с ними SVG перестаёт быть XML.
const FUNCTION = new RegExp(
  `^(?:rgba?|hsla?)\\( *${NUMBER}(?: *[, /] *${NUMBER}){2,3} *\\)$`,
  "i",
);

/** Цвет вместо currentColor: hex (# можно опустить), имя цвета, rgb()/rgba()/hsl()/hsla(). */
export function parseColor(value: string): string {
  const hex = HEX.exec(value);
  if (hex) return `#${(hex[1] as string).toLowerCase()}`;
  if (NAMED.test(value) || FUNCTION.test(value)) return value.toLowerCase();
  throw new ApiError(
    400,
    "invalid_color",
    `Color "${value}" is not a hex, named, rgb() or hsl() color`,
  );
}

/** Флажок: 1, true, yes — да; 0, false, no — нет; нет параметра — нет. */
export function parseBool(name: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  throw new ApiError(
    400,
    "invalid_parameter",
    `Parameter "${name}" must be 1 or 0`,
  );
}
