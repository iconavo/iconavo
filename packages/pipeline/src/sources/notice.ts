// Файл NOTICE набора (ADR-0017): первый из NOTICE_FILES, который есть и не пустой. Одно правило у чтения
// лицензии и у отчёта загрузки: раньше отчёт называл первый существующий, даже пустой, а лицензия брала
// следующий (ревизия фазы 5, Д-22).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NOTICE_FILES } from "./config.js";

/** Найденный NOTICE: имя файла и его текст как есть; нет ни одного непустого — undefined. */
export async function findNotice(
  dir: string,
): Promise<{ file: string; text: string } | undefined> {
  for (const file of NOTICE_FILES) {
    let text: string;
    try {
      text = await readFile(join(dir, file), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    if (text.trim() !== "") return { file, text };
  }
  return undefined;
}
