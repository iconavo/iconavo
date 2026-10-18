import { NAME_PATTERN } from "@iconavo-ui/schema";
import { folderMatcher, type SourceConfig, type SvgFolder } from "./config.js";

/** Имя иконки из пути к SVG: имя файла без `.svg`, затем правила из конфига набора. */
export function iconNameFromFile(
  file: string,
  naming: SvgFolder["naming"],
): string {
  let name = file.split("/").at(-1) ?? file;
  name = name.replace(/\.svg$/i, "");
  for (const rule of naming.replace) {
    name = name.replace(new RegExp(rule.pattern, "g"), rule.with);
  }
  return naming.lowercase ? name.toLowerCase() : name;
}

export interface NameCheck {
  total: number;
  valid: number;
  /** Имена, которые не проходят правило ADR-0001. */
  invalid: { file: string; name: string }[];
  /** Несколько файлов дали одно имя: конвейер должен остановиться (ADR-0001). */
  conflicts: { name: string; files: string[] }[];
}

/** Проверяет имена всех SVG набора; правила имён берутся из папки, в которой лежит файл. */
export function checkNames(files: string[], config: SourceConfig): NameCheck {
  const folderOf = folderMatcher(config);
  const byName = new Map<string, string[]>();
  const invalid: NameCheck["invalid"] = [];
  for (const file of files) {
    const folder = folderOf(file);
    if (!folder)
      throw new Error(`«${file}» не лежит ни в одной папке из svgFolders`);
    const name = iconNameFromFile(file, folder.naming);
    byName.set(name, [...(byName.get(name) ?? []), file]);
    if (!NAME_PATTERN.test(name)) invalid.push({ file, name });
  }
  const conflicts = [...byName]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, files: list }));
  return {
    total: files.length,
    valid: files.length - invalid.length,
    invalid,
    conflicts,
  };
}
