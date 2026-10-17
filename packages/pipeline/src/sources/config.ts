import { nameSchema } from "@iconavo-ui/schema";
import { z } from "zod";

/** Относительный путь внутри источника: без `..`, без абсолютных и без обратных слэшей. */
export const relativePath = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !/^[a-zA-Z]:/.test(p) &&
      !p.includes("\\") &&
      !p.includes("\0") &&
      p.split("/").every((s) => s !== "" && s !== "." && s !== ".."),
    "путь должен быть относительным, без «..», пустых частей и обратных слэшей",
  );

const regexString = z.string().refine((p) => {
  try {
    new RegExp(p, "g");
    return true;
  } catch {
    return false;
  }
}, "это не регулярное выражение");

/** Конфиг одного набора: `sources/{id}.ts` (ADR-0012). */
export const sourceConfigSchema = z.strictObject({
  /** Префикс набора, он же имя файла конфига (ADR-0001). */
  id: nameSchema,
  name: z.string().min(1),
  source: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("npm"), package: z.string().min(1) }),
    z.strictObject({
      type: z.literal("git"),
      repo: z
        .url()
        .refine((u) => u.startsWith("https://"), "репозиторий — адрес https"),
    }),
  ]),
  /** Папка с SVG внутри источника. */
  svgPath: relativePath,
  /** Как из имени файла получить имя иконки. */
  naming: z
    .strictObject({
      lowercase: z.boolean().default(true),
      replace: z
        .array(z.strictObject({ pattern: regexString, with: z.string() }))
        .default([]),
    })
    .default({ lowercase: true, replace: [] }),
  /** monochrome — цвета заменяются на currentColor; color — цветной набор. */
  palette: z.enum(["monochrome", "color"]),
  license: z.strictObject({
    spdx: z.string().min(1),
    /** Файл лицензии внутри источника. */
    file: relativePath,
  }),
  /** Файл с тегами авторов внутри источника (используется при импорте метаданных). */
  tagsFile: relativePath.optional(),
});

export type SourceConfigInput = z.input<typeof sourceConfigSchema>;
export type SourceConfig = z.output<typeof sourceConfigSchema>;

/** Служебные файлы, которые нужны помимо SVG. */
export function extraFiles(config: SourceConfig): string[] {
  return [
    ...new Set(
      [config.license.file, config.tagsFile, "package.json"].filter(
        (f): f is string => Boolean(f),
      ),
    ),
  ];
}
