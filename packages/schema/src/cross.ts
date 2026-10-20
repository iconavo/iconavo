import { NAME_MESSAGE, NAME_PATTERN } from "./name.js";

export interface Issue {
  /** Путь к полю, например `icons.Arrow_Left` или `aliases.arrow-back.parent`. */
  path: string;
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Проверки, которые схема одного поля не выражает: имена-ключи, родители алиасов, циклы.
 * Работает по сырым данным и не зависит от результата разбора zod, поэтому ошибки
 * находятся и тогда, когда рядом есть другие.
 */
export function checkNamesAndAliases(data: unknown): Issue[] {
  if (!isRecord(data)) return [];
  const issues: Issue[] = [];
  const icons = isRecord(data.icons) ? data.icons : {};
  const aliases = isRecord(data.aliases) ? data.aliases : {};

  for (const [section, names] of [
    ["icons", icons],
    ["aliases", aliases],
  ] as const) {
    for (const name of Object.keys(names)) {
      if (!NAME_PATTERN.test(name)) {
        issues.push({ path: `${section}.${name}`, message: NAME_MESSAGE });
      }
    }
  }

  for (const name of Object.keys(aliases)) {
    if (Object.hasOwn(icons, name)) {
      issues.push({
        path: `aliases.${name}`,
        message: "алиас совпадает с именем иконки",
      });
    }
  }

  for (const [name, alias] of Object.entries(aliases)) {
    const parent = isRecord(alias) ? alias.parent : undefined;
    if (typeof parent !== "string") continue; // нет parent — это ошибка схемы
    if (!Object.hasOwn(icons, parent) && !Object.hasOwn(aliases, parent)) {
      issues.push({
        path: `aliases.${name}.parent`,
        message: `родитель «${parent}» не найден среди иконок и алиасов`,
      });
      continue;
    }
    // Идём по цепочке родителей: если вернулись в уже виденное имя — цикл.
    const seen = new Set([name]);
    let current: unknown = parent;
    while (typeof current === "string" && Object.hasOwn(aliases, current)) {
      if (seen.has(current)) {
        issues.push({
          path: `aliases.${name}.parent`,
          message: "алиасы ссылаются друг на друга по кругу",
        });
        break;
      }
      seen.add(current);
      const next = aliases[current];
      current = isRecord(next) ? next.parent : undefined;
    }
  }
  return issues;
}
