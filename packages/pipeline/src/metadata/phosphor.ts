// Метаданные Phosphor (ADR-0017). В пакете @phosphor-icons/core нет JSON: список иконок лежит
// массивом в модуле dist/index.mjs. Модуль не запускается — это чужой код. Текст массива переводится
// в JSON (имена полей — в кавычки, ссылки на перечисления — их строками) и разбирается JSON.parse.
// Любая незнакомая конструкция — ошибка: значит, автор поменял формат, и набор нужно остановить.

import { z } from "zod";

export interface PhosphorEntry {
  name: string;
  /** Категории как у автора: arrows, technology & development и т. п. */
  categories: string[];
  /** Теги как у автора, со служебными *new* и *updated*. */
  tags: unknown[];
}

const entrySchema = z.looseObject({
  name: z.string().min(1),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.unknown()).default([]),
});

const IDENT = "[A-Za-z_$][\\w$]*";
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Локальные имена экспортов из последней строки `export { a as FigmaCategory, n as icons }`. */
function exportsOf(text: string): Map<string, string> {
  const blocks = [...text.matchAll(/export\s*\{([^}]*)\}/g)];
  const last = blocks.at(-1);
  if (!last) throw new Error("в модуле нет строки export");
  const out = new Map<string, string>();
  for (const part of (last[1] ?? "").split(",")) {
    if (part.trim() === "") continue;
    const m = new RegExp(`^\\s*(${IDENT})(?:\\s+as\\s+(${IDENT}))?\\s*$`).exec(
      part,
    );
    if (!m) throw new Error(`непонятный экспорт «${part.trim()}»`);
    const local = m[1] as string;
    out.set(m[2] ?? local, local);
  }
  return out;
}

/**
 * Строковые перечисления, которые сборщик записал функцией: `e = ((i) => (i.ARROWS = "arrows", …))(e || {})`,
 * обычно с пометкой @__PURE__ перед скобкой. Результат: имя переменной → ключ → строка.
 */
function enumsOf(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const re = new RegExp(
    `(${IDENT})\\s*=\\s*(?:\\/\\*[^*]*\\*\\/\\s*)?\\(\\(\\s*(${IDENT})\\s*\\)\\s*=>\\s*\\(([\\s\\S]*?)\\)\\)\\(\\s*\\1\\s*\\|\\|\\s*\\{\\}\\s*\\)`,
    "g",
  );
  for (const m of text.matchAll(re)) {
    const variable = m[1] as string;
    const param = escapeRe(m[2] as string);
    const values = new Map<string, string>();
    const pair = new RegExp(
      `\\b${param}\\.(${IDENT})\\s*=\\s*"([^"\\\\]*)"`,
      "g",
    );
    for (const p of (m[3] ?? "").matchAll(pair)) {
      values.set(p[1] as string, p[2] as string);
    }
    out.set(variable, values);
  }
  return out;
}

const SPACE = /\s+/y;
const PUNCT = /[[\]{},:]/y;
const STRING = /"(?:[^"\\\n]|\\.)*"/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w$.])/y;
const NAME = new RegExp(IDENT, "y");
const AFTER_NAME = /\s*([:.])/y;

/** Текст массива, начиная с «[» в позиции start, — в JSON. */
function arrayToJson(
  text: string,
  start: number,
  enums: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string {
  const out: string[] = [];
  let depth = 0;
  let pos = start;
  const at = (re: RegExp): string | undefined => {
    re.lastIndex = pos;
    return re.exec(text)?.[0];
  };
  while (pos < text.length) {
    let token = at(SPACE);
    if (token !== undefined) {
      pos += token.length;
      continue;
    }
    token = at(PUNCT);
    if (token !== undefined) {
      pos += 1;
      if (token === "]" || token === "}") {
        // Висячая запятая допустима в JavaScript, но не в JSON.
        if (out.at(-1) === ",") out.pop();
        out.push(token);
        depth--;
        if (depth === 0) return out.join("");
      } else {
        if (token === "[" || token === "{") depth++;
        out.push(token);
      }
      continue;
    }
    token = at(STRING) ?? at(NUMBER);
    if (token !== undefined) {
      pos += token.length;
      out.push(token);
      continue;
    }
    token = at(NAME);
    if (token === undefined) {
      throw new Error(`неожиданный символ «${text[pos]}» в списке иконок`);
    }
    pos += token.length;
    AFTER_NAME.lastIndex = pos;
    const next = AFTER_NAME.exec(text);
    if (next?.[1] === ":") {
      // Имя поля объекта.
      out.push(JSON.stringify(token));
      continue;
    }
    if (next?.[1] === ".") {
      // Ссылка на значение перечисления: e.ARROWS.
      pos = AFTER_NAME.lastIndex;
      const key = at(NAME);
      const value = key === undefined ? undefined : enums.get(token)?.get(key);
      if (key === undefined || value === undefined) {
        throw new Error(`неизвестное значение ${token}.${key ?? "?"}`);
      }
      pos += key.length;
      out.push(JSON.stringify(value));
      continue;
    }
    if (token === "true" || token === "false" || token === "null") {
      out.push(token);
      continue;
    }
    throw new Error(`неожиданное «${token}» в списке иконок`);
  }
  throw new Error("список иконок не закрыт");
}

/** Иконки Phosphor из текста dist/index.mjs. Код модуля не выполняется. */
export function parsePhosphorModule(text: string): PhosphorEntry[] {
  const variable = exportsOf(text).get("icons");
  if (variable === undefined) throw new Error("модуль не экспортирует icons");
  const declaration = new RegExp(
    `(?:const|let|var)\\s+${escapeRe(variable)}\\s*=\\s*\\[`,
  ).exec(text);
  if (!declaration) throw new Error(`нет массива ${variable}`);
  const json = arrayToJson(
    text,
    declaration.index + declaration[0].length - 1,
    enumsOf(text),
  );
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `список иконок не переводится в JSON: ${(e as Error).message}`,
    );
  }
  const parsed = z.array(entrySchema).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `список иконок не по формату: ${issue?.path.join(".") ?? ""} — ${issue?.message ?? ""}`,
    );
  }
  return parsed.data.map((e) => ({
    name: e.name,
    categories: e.categories,
    tags: e.tags,
  }));
}
