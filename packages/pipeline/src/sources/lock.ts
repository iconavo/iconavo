import { readFile, writeFile } from "node:fs/promises";
import { nameSchema } from "@iconavo-ui/schema";
import { z } from "zod";

export const lockEntrySchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("npm"),
    version: z.string().min(1),
    integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+=*$/),
  }),
  z.strictObject({
    type: z.literal("git"),
    commit: z
      .string()
      .regex(
        /^[0-9a-f]{40}$/,
        "нужен полный хэш коммита (40 символов), а не ветка",
      ),
  }),
]);

export const lockFileSchema = z.record(nameSchema, lockEntrySchema);

export type LockEntry = z.infer<typeof lockEntrySchema>;
export type LockFile = z.infer<typeof lockFileSchema>;

export async function readLock(path: string): Promise<LockFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  const parsed = lockFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(файл)"} — ${i.message}`)
      .join("; ");
    throw new Error(`sources.lock.json повреждён: ${where}`);
  }
  return parsed.data;
}

/** Записывает lock с отсортированными ключами, чтобы diff в pull request был чистым. */
export async function writeLock(path: string, lock: LockFile): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}
