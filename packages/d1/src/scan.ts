// Пределы D1 по тексту запроса — для базы тестов и превью (sqlite.ts). Настоящего разборщика SQLite
// здесь нет: только слова, строки, имена в кавычках, параметры, скобки и комментарии. Этого хватает,
// чтобы найти то, что D1 отклонит, а node:sqlite пропустит: части составной выборки, номера параметров,
// длину запроса, шаблоны LIKE и GLOB, аргументы функций, столбцы CREATE TABLE, операторы транзакций.

import { D1_LIMITS } from "./index.js";

export type Token =
  | { kind: "word"; text: string; upper: string }
  /** Строка в одинарных кавычках — уже без кавычек. */
  | { kind: "string"; text: string }
  /** Имя в двойных кавычках, обратных или квадратных скобках. */
  | { kind: "quoted"; text: string }
  /** Параметр: ?, ?NNN, :имя, @имя, $имя — номер по правилам SQLite. */
  | { kind: "param"; index: number }
  | { kind: "number"; text: string }
  | { kind: "punct"; text: string };

const SPACE = /\s+/y;
const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;
const NAME = /[A-Za-z0-9_$]+/y;
const DIGITS = /\d+/y;
const NUMBER = /0x[0-9a-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iy;

/** Совпадение липкого выражения с позиции at или пустая строка. */
function sticky(re: RegExp, sql: string, at: number): string {
  re.lastIndex = at;
  return re.exec(sql)?.[0] ?? "";
}

/** Конец строки в кавычках: удвоенная кавычка внутри — сама кавычка. */
function quoteEnd(sql: string, start: number): number {
  const quote = sql[start];
  for (let i = start + 1; i < sql.length; i++) {
    if (sql[i] !== quote) continue;
    if (sql[i + 1] !== quote) return i + 1;
    i++;
  }
  return sql.length;
}

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const named = new Map<string, number>();
  let largest = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql.charAt(i);
    const next = sql.charAt(i + 1);
    const space = sticky(SPACE, sql, i);
    if (space !== "") {
      i += space.length;
    } else if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (c === "'") {
      const end = quoteEnd(sql, i);
      tokens.push({
        kind: "string",
        text: sql.slice(i + 1, end - 1).replaceAll("''", "'"),
      });
      i = end;
    } else if (c === '"' || c === "`") {
      const end = quoteEnd(sql, i);
      tokens.push({ kind: "quoted", text: sql.slice(i + 1, end - 1) });
      i = end;
    } else if (c === "[") {
      const end = sql.indexOf("]", i);
      const stop = end < 0 ? sql.length : end + 1;
      tokens.push({ kind: "quoted", text: sql.slice(i + 1, stop - 1) });
      i = stop;
    } else if (c === "?") {
      // ?NNN — номер NNN; просто ? — на один больше самого большого номера до него.
      const digits = sticky(DIGITS, sql, i + 1);
      const index = digits === "" ? largest + 1 : Number(digits);
      largest = Math.max(largest, index);
      tokens.push({ kind: "param", index });
      i += 1 + digits.length;
    } else if ((c === ":" || c === "@" || c === "$") && NAME.test(next)) {
      // Одно имя — один номер, сколько бы раз оно ни встретилось.
      const name = sticky(NAME, sql, i + 1);
      let index = named.get(name);
      if (index === undefined) {
        index = largest + 1;
        largest = index;
        named.set(name, index);
      }
      tokens.push({ kind: "param", index });
      i += 1 + name.length;
    } else if (/[A-Za-z_]/.test(c)) {
      const word = sticky(WORD, sql, i);
      tokens.push({ kind: "word", text: word, upper: word.toUpperCase() });
      i += word.length;
    } else if (/\d/.test(c) || (c === "." && /\d/.test(next))) {
      const number = sticky(NUMBER, sql, i) || c;
      tokens.push({ kind: "number", text: number });
      i += number.length;
    } else {
      tokens.push({ kind: "punct", text: c });
      i++;
    }
  }
  return tokens;
}

const isPunct = (t: Token | undefined, text: string): boolean =>
  t?.kind === "punct" && t.text === text;

const isWord = (t: Token | undefined, ...words: string[]): boolean =>
  t?.kind === "word" && words.includes(t.upper);

/** Части самой длинной составной выборки: у каждых скобок свой счёт, как у SQLite. */
export function compoundTerms(tokens: readonly Token[]): number {
  const open = [1];
  let most = 1;
  for (const t of tokens) {
    if (isWord(t, "UNION", "INTERSECT", "EXCEPT")) {
      open[open.length - 1] = (open.at(-1) ?? 1) + 1;
    } else if (isPunct(t, "(")) {
      open.push(1);
    } else if (isPunct(t, ")") && open.length > 1) {
      most = Math.max(most, open.pop() ?? 1);
    }
  }
  return Math.max(most, ...open);
}

/** Самый большой номер параметра в запросе. */
export function paramCount(tokens: readonly Token[]): number {
  let most = 0;
  for (const t of tokens)
    if (t.kind === "param") most = Math.max(most, t.index);
  return most;
}

/** Шаблон LIKE или GLOB: строка в запросе или номер параметра. */
export type Pattern = { literal: string } | { param: number };

/**
 * Шаблоны LIKE и GLOB — первая строка или параметр после слова, в том числе внутри скобок и функций
 * вроде lower(?): так шаблон пишет и Better Auth (`LOWER(col) LIKE LOWER(?)`).
 */
export function likePatterns(tokens: readonly Token[]): Pattern[] {
  const found: Pattern[] = [];
  tokens.forEach((t, i) => {
    if (!isWord(t, "LIKE", "GLOB")) return;
    let j = i + 1;
    while (j < tokens.length) {
      const u = tokens[j];
      if (isPunct(u, "(")) {
        j++;
      } else if (u?.kind === "word" && isPunct(tokens[j + 1], "(")) {
        j += 2;
      } else {
        break;
      }
    }
    const u = tokens[j];
    if (u?.kind === "param") found.push({ param: u.index });
    if (u?.kind === "string") found.push({ literal: u.text });
  });
  return found;
}

/** Слова SQL, после которых скобки — не вызов функции. */
const NOT_FUNCTIONS = new Set([
  "ALL",
  "AND",
  "AS",
  "ASC",
  "BEGIN",
  "BETWEEN",
  "BY",
  "CASE",
  "CHECK",
  "COLLATE",
  "CONFLICT",
  "CONSTRAINT",
  "CREATE",
  "DEFAULT",
  "DELETE",
  "DESC",
  "DISTINCT",
  "DO",
  "ELSE",
  "END",
  "ESCAPE",
  "EXCEPT",
  "EXISTS",
  "FILTER",
  "FOREIGN",
  "FROM",
  "GLOB",
  "GROUP",
  "HAVING",
  "IF",
  "IN",
  "INDEX",
  "INSERT",
  "INTERSECT",
  "INTO",
  "IS",
  "JOIN",
  "KEY",
  "LIKE",
  "LIMIT",
  "MATCH",
  "MATERIALIZED",
  "NOT",
  "NOTHING",
  "NULL",
  "OFFSET",
  "ON",
  "OR",
  "ORDER",
  "OVER",
  "PARTITION",
  "PRIMARY",
  "RECURSIVE",
  "REFERENCES",
  "REGEXP",
  "RETURNING",
  "ROWS",
  "SELECT",
  "SET",
  "TABLE",
  "THEN",
  "TRIGGER",
  "UNION",
  "UNIQUE",
  "UPDATE",
  "USING",
  "VALUES",
  "VIEW",
  "WHEN",
  "WHERE",
  "WINDOW",
  "WITH",
  "WITHOUT",
]);

/** Слова, после которых идёт имя таблицы со списком столбцов, а не функция: INSERT INTO t (a, b). */
const BEFORE_TABLE = new Set([
  "EXISTS",
  "INDEX",
  "INTO",
  "ON",
  "RECURSIVE",
  "REFERENCES",
  "TABLE",
  "TRIGGER",
  "VIEW",
  "WITH",
]);

/** Части списка в скобках с позиции открывающей скобки: по запятым верхнего уровня. */
function listParts(tokens: readonly Token[], open: number): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) break;
    if (isPunct(t, "(")) {
      depth++;
      if (depth === 1) continue;
    } else if (isPunct(t, ")")) {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1 && isPunct(t, ",")) {
      parts.push([]);
      continue;
    }
    parts.at(-1)?.push(t);
  }
  // f() — ни одной части, а не одна пустая.
  return parts.length === 1 && parts[0]?.length === 0 ? [] : parts;
}

/** Функция с числом аргументов больше предела D1: «max» и т. п.; нет — undefined. */
export function tooManyArgs(tokens: readonly Token[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t?.kind !== "word" || NOT_FUNCTIONS.has(t.upper)) continue;
    if (!isPunct(tokens[i + 1], "(")) continue;
    const before = tokens[i - 1];
    if (before?.kind === "word" && BEFORE_TABLE.has(before.upper)) continue;
    if (listParts(tokens, i + 1).length > D1_LIMITS.functionArgs) {
      return t.text;
    }
  }
  return undefined;
}

/** Таблица CREATE TABLE со столбцами сверх предела D1: имя и число; нет — undefined. */
export function tooManyColumns(
  tokens: readonly Token[],
): { table: string; columns: number } | undefined {
  if (!isWord(tokens[0], "CREATE")) return undefined;
  const table = tokens.findIndex((t, i) => i < 3 && isWord(t, "TABLE"));
  if (table < 0) return undefined;
  const open = tokens.findIndex((t, i) => i > table && isPunct(t, "("));
  const as = tokens.findIndex((t, i) => i > table && isWord(t, "AS"));
  if (open < 0 || (as >= 0 && as < open)) return undefined;
  const name = tokens[open - 1];
  const columns = listParts(tokens, open).filter(
    (part) =>
      !isWord(part[0], "CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"),
  ).length;
  if (columns <= D1_LIMITS.columns) return undefined;
  return {
    table:
      name?.kind === "word" || name?.kind === "quoted" ? name.text : "table",
    columns,
  };
}

/** Оператор транзакции: в D1 его нет, транзакция — пачка batch(). */
export const isTransaction = (tokens: readonly Token[]): boolean =>
  isWord(
    tokens[0],
    "BEGIN",
    "COMMIT",
    "END",
    "ROLLBACK",
    "SAVEPOINT",
    "RELEASE",
  );

/** Пишет ли запрос: INSERT, UPDATE, DELETE, REPLACE — его изменения есть в ответе. */
export const isWrite = (tokens: readonly Token[]): boolean =>
  isWord(tokens[0], "INSERT", "UPDATE", "DELETE", "REPLACE");

/** Запросы через точку с запятой верхнего уровня — для exec(). */
export function statements(tokens: readonly Token[]): Token[][] {
  const out: Token[][] = [[]];
  for (const t of tokens) {
    if (isPunct(t, ";")) out.push([]);
    else out.at(-1)?.push(t);
  }
  return out.filter((s) => s.length > 0);
}
