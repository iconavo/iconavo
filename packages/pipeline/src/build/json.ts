// Запись JSON для файлов набора (ADR-0015): ключи по кодам символов на всех уровнях, отступ в два
// пробела, LF и перевод строки в конце. JSON.stringify не подходит: V8 ставит ключи-числа («123»,
// «360») впереди остальных, а у иконок бывают такие имена. Для файлов раздачи (ADR-0022) — тот же
// порядок ключей, но без пробелов и перевода строки: их читают только машины.

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Одинаковые данные — побайтно одинаковый текст, в каком бы порядке ни добавлялись ключи. */
export function canonicalJson(value: Json): string {
  return `${write(value, "")}\n`;
}

/** То же, но компактно: без пробелов и без перевода строки в конце. */
export function compactJson(value: Json): string {
  return write(value, undefined);
}

/** indent — отступ текущего уровня; undefined — компактная запись. */
function write(value: Json, indent: string | undefined): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`число ${value} нельзя записать в JSON`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error(`значение «${String(value)}» нельзя записать в JSON`);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (indent === undefined) {
      return `[${value.map((item) => write(item, undefined)).join(",")}]`;
    }
    const inner = `${indent}  `;
    const items = value.map((item) => `${inner}${write(item, inner)}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const keys = Object.keys(value).sort(order);
  if (keys.length === 0) return "{}";
  if (indent === undefined) {
    const items = keys.map(
      (key) => `${JSON.stringify(key)}:${write(value[key] as Json, undefined)}`,
    );
    return `{${items.join(",")}}`;
  }
  const inner = `${indent}  `;
  const items = keys.map(
    (key) =>
      `${inner}${JSON.stringify(key)}: ${write(value[key] as Json, inner)}`,
  );
  return `{\n${items.join(",\n")}\n${indent}}`;
}
