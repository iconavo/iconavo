// Запись файла набора через временный файл и переименование: оборванная запись не оставит половину
// файла. Так пишут и сборка (pnpm data), и обогащение (pnpm enrich).

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function writeFileAtomic(
  path: string,
  text: string,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(
    dir,
    `.${basename(path)}-${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await writeFile(tmp, text, "utf8");
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
