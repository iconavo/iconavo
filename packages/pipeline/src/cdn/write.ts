// Запись раздачи на диск (ADR-0022): папка версии набора собирается во временной папке рядом и
// подменяется целиком; файл контрольных сумм пишется последним — он подтверждает, что папка целая.
// Без изменений ничего не трогается: повторная сборка не пишет ни байта.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { renameRetrying, writeFileAtomic } from "../build/write.js";
import { pool } from "../util/pool.js";
import { CHECKSUMS_SUFFIX, VERSIONS_DIR } from "./config.js";
import type { CdnFile } from "./files.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** {out}/v/{версия} */
export const versionDir = (outDir: string, version: string) =>
  join(outDir, VERSIONS_DIR, version);

/** {out}/v/{версия}/{набор} */
export const setDir = (outDir: string, id: string, version: string) =>
  join(versionDir(outDir, version), id);

/** {out}/v/{версия}/{набор}.checksums.json */
export const checksumsPath = (outDir: string, id: string, version: string) =>
  join(versionDir(outDir, version), `${id}${CHECKSUMS_SUFFIX}`);

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Папка версии на диске та же: тот же файл сумм и столько же файлов в папке. Файл сумм пишется
 * последним, поэтому он и есть признак целой папки; сверка каждого файла — дело выгрузки.
 */
export async function sameVersionOnDisk(
  outDir: string,
  id: string,
  version: string,
  checksums: string,
  fileCount: number,
): Promise<boolean> {
  if ((await readText(checksumsPath(outDir, id, version))) !== checksums) {
    return false;
  }
  try {
    const entries = await readdir(setDir(outDir, id, version));
    return entries.length === fileCount;
  } catch {
    return false;
  }
}

/**
 * Пишет файлы версии набора: временная папка рядом → подмена старой папки → файл сумм последним.
 * При ошибке временная папка удаляется, а старая папка остаётся, если до подмены не дошло.
 */
export async function writeSetVersion(
  outDir: string,
  id: string,
  version: string,
  files: readonly CdnFile[],
  checksums: string,
  concurrency: number,
): Promise<void> {
  const dir = versionDir(outDir, version);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${id}-${randomBytes(6).toString("hex")}`);
  await mkdir(tmp);
  let failure: Error | undefined;
  try {
    await pool(files, concurrency, async (f) => {
      if (failure) return;
      try {
        await writeFile(join(tmp, basename(f.path)), f.data);
      } catch (e) {
        failure ??= e instanceof Error ? e : new Error(String(e));
      }
    });
    if (failure) throw failure;
    const target = setDir(outDir, id, version);
    // Сначала файл сумм: он не должен подтверждать папку, которой уже нет.
    await rm(checksumsPath(outDir, id, version), { force: true });
    await rm(target, { recursive: true, force: true });
    await renameRetrying(tmp, target);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
  await writeFileAtomic(checksumsPath(outDir, id, version), checksums);
}

/** Пишет текст, только если на диске другой; true — записано. */
export async function writeIfChanged(
  path: string,
  text: string,
): Promise<boolean> {
  if ((await readText(path)) === text) return false;
  await writeFileAtomic(path, text);
  return true;
}

/**
 * Убирает из v/ всё, чего нет в манифесте: старые версии, забытые временные папки, чужие записи в
 * папках версий. keep — версия → наборы в ней. Неудача удаления — предупреждение, не ошибка.
 */
export async function cleanupStale(
  outDir: string,
  keep: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<{ removed: string[]; warnings: string[] }> {
  const removed: string[] = [];
  const warnings: string[] = [];
  const base = join(outDir, VERSIONS_DIR);
  let versions: string[];
  try {
    versions = await readdir(base);
  } catch {
    return { removed, warnings };
  }
  const remove = async (path: string, label: string) => {
    try {
      await rm(path, { recursive: true, force: true });
      removed.push(label);
    } catch (e) {
      warnings.push(`не удалено ${label}: ${(e as Error).message}`);
    }
  };
  for (const version of versions.sort(order)) {
    const ids = keep.get(version);
    if (!ids) {
      await remove(join(base, version), `${VERSIONS_DIR}/${version}`);
      continue;
    }
    const wanted = new Set<string>();
    for (const id of ids) {
      wanted.add(id);
      wanted.add(`${id}${CHECKSUMS_SUFFIX}`);
    }
    for (const entry of (await readdir(join(base, version))).sort(order)) {
      if (!wanted.has(entry)) {
        await remove(
          join(base, version, entry),
          `${VERSIONS_DIR}/${version}/${entry}`,
        );
      }
    }
  }
  return { removed, warnings };
}
