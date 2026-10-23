// Компактный JSON с ключами по кодам символов на всех уровнях — копия писателя конвейера
// (packages/pipeline/src/build/json.ts). JSON.stringify не подходит: V8 ставит ключи-числа («123»,
// «360») впереди остальных, а у иконок бывают такие имена. Одинаковые данные — побайтно одинаковый
// ответ, в каком бы порядке ни пришли имена.

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function compactJson(value: Json): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`число ${value} нельзя записать в JSON`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(compactJson).join(",")}]`;
  const items = Object.keys(value)
    .sort(order)
    .map((key) => `${JSON.stringify(key)}:${compactJson(value[key] as Json)}`);
  return `{${items.join(",")}}`;
}
