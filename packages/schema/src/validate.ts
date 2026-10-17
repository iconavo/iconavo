import type { z } from "zod";
import { checkNamesAndAliases, type Issue } from "./cross.js";
import { iconsFileSchema } from "./icons.js";
import { infoFileSchema } from "./info.js";
import { metadataFileSchema } from "./metadata.js";
import "./locale.js";
import { searchFileSchema } from "./search.js";

export type FileKind = "icons" | "info" | "metadata" | "search";

export const FILE_KINDS: readonly FileKind[] = [
  "icons",
  "info",
  "metadata",
  "search",
];

const schemas: Record<FileKind, z.ZodType> = {
  icons: iconsFileSchema,
  info: infoFileSchema,
  metadata: metadataFileSchema,
  search: searchFileSchema,
};

const pathOf = (path: ReadonlyArray<PropertyKey>) => path.map(String).join(".");

/** Проверяет содержимое файла набора и возвращает список ошибок (пустой — файл правильный). */
export function validate(kind: FileKind, data: unknown): Issue[] {
  const issues: Issue[] = [];
  const parsed = schemas[kind].safeParse(data);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ path: pathOf(i.path) || "(файл)", message: i.message });
    }
  }
  if (kind === "icons") issues.push(...checkNamesAndAliases(data));
  // Одну и ту же ошибку не показываем дважды.
  const unique = new Map(issues.map((i) => [`${i.path}|${i.message}`, i]));
  return [...unique.values()];
}
