// Запись JSON для файлов набора (ADR-0015): ключи по кодам символов на всех уровнях, отступ в два
// пробела, LF и перевод строки в конце. JSON.stringify не подходит: V8 ставит ключи-числа («123»,
// «360») впереди остальных, а у иконок бывают такие имена.

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

function write(value: Json, indent: string): string {
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
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${inner}${write(item, inner)}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const keys = Object.keys(value).sort(order);
  if (keys.length === 0) return "{}";
  const items = keys.map(
    (key) =>
      `${inner}${JSON.stringify(key)}: ${write(value[key] as Json, inner)}`,
  );
  return `{\n${items.join(",\n")}\n${indent}}`;
}
