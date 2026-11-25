// Запись файла через временный файл и переименование: оборванная запись не оставит половину
// файла. Так пишут сборка (pnpm data), обогащение (pnpm enrich) и векторы (pnpm embed).

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Коды, с которыми Windows не даёт заменить файл, пока его держит другая программа. */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 5;

/**
 * Переименование с повтором: в Windows только что записанный файл может ненадолго держать
 * антивирус. Пауза 100, 200, 400, 800 мс.
 */
export async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (attempt >= RENAME_ATTEMPTS || !BUSY.has(code)) throw e;
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * 2 ** (attempt - 1)),
      );
    }
  }
}

/** Строка пишется в UTF-8, байты — как есть. */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(
    dir,
    `.${basename(path)}-${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await writeFile(tmp, data);
    await renameRetrying(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/**
 * Несколько файлов одной группой — например, файлы набора в `data/{набор}/`: сначала все пишутся во
 * временные рядом, затем подменяют прежние подряд. Сбой при записи не трогает прежние файлы, и набор не
 * остаётся смесью новых и старых (ревизия фазы 5, Д-12).
 */
export async function writeFilesAtomic(
  files: readonly { path: string; data: string | Uint8Array }[],
): Promise<void> {
  const staged: { tmp: string; path: string }[] = [];
  try {
    for (const { path, data } of files) {
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });
      const tmp = join(
        dir,
        `.${basename(path)}-${randomBytes(6).toString("hex")}.tmp`,
      );
      staged.push({ tmp, path });
      await writeFile(tmp, data);
    }
  } catch (e) {
    await Promise.all(staged.map((s) => rm(s.tmp, { force: true })));
    throw e;
  }
  for (const { tmp, path } of staged) await renameRetrying(tmp, path);
}
