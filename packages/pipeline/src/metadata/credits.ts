// Части набора от других авторов (ADR-0017): список иконок — из LICENSE набора, как его пишет автор.
// У Lucide это иконки из Feather: строка «The following Lucide icons are derived from the Feather
// project:», а за ней — имена через запятую. Имена там старые, поэтому они переводятся в нынешние
// по алиасам набора. Текст лицензии меняется только после подтверждения владельцем, так что новый
// список тоже приходит через «подтверждаю».

import { type Credit, NAME_PATTERN } from "@iconavo-ui/schema";
import type { SourceConfig } from "../sources/config.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface CreditsRead {
  credits: Credit[];
  stop: string[];
}

/** Первая непустая строка после фразы-якоря; нет фразы или списка после неё — undefined. */
export function listAfter(text: string, anchor: string): string | undefined {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === anchor.trim());
  if (at < 0) return undefined;
  return lines
    .slice(at + 1)
    .find((line) => line.trim() !== "")
    ?.trim();
}

/**
 * Части набора по полю credits конфига. resolve переводит имя иконки или алиаса в нынешнее имя
 * иконки, незнакомое имя — undefined.
 */
export function readCredits(
  config: SourceConfig,
  licenseText: string,
  resolve: (name: string) => string | undefined,
): CreditsRead {
  const credits: Credit[] = [];
  const stop: string[] = [];
  const fix = `поправьте credits в sources/${config.id}.ts`;
  for (const c of config.credits ?? []) {
    const line = listAfter(licenseText, c.list);
    if (line === undefined) {
      stop.push(
        `${c.name}: в LICENSE нет строки «${c.list}» со списком иконок после неё — ${fix}`,
      );
      continue;
    }
    const names = line
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n !== "");
    const odd = names.filter((n) => !NAME_PATTERN.test(n));
    if (names.length === 0 || odd.length > 0) {
      stop.push(
        `${c.name}: список иконок в LICENSE не разобран${odd.length > 0 ? `: ${odd.slice(0, 5).join(", ")}` : ""} — ${fix}`,
      );
      continue;
    }
    const icons = new Set<string>();
    const unknown: string[] = [];
    for (const name of names) {
      const current = resolve(name);
      if (current === undefined) unknown.push(name);
      else icons.add(current);
    }
    if (unknown.length > 0) {
      stop.push(
        `${c.name}: в наборе нет иконок из списка LICENSE: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? ` и ещё ${unknown.length - 10}` : ""}`,
      );
      continue;
    }
    credits.push({
      name: c.name,
      author: c.author,
      url: c.url,
      license: c.license,
      icons: [...icons].sort(order),
    });
  }
  return { credits, stop };
}
