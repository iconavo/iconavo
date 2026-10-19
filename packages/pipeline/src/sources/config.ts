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

/** Как из имени файла получить имя иконки. Правила применяются по порядку. */
const namingSchema = z
  .strictObject({
    lowercase: z.boolean().default(true),
    replace: z
      .array(z.strictObject({ pattern: regexString, with: z.string() }))
      .default([]),
  })
  .default({ lowercase: true, replace: [] });

const folderSchema = z.strictObject({
  path: relativePath,
  naming: namingSchema,
});

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
  /**
   * Папки с SVG внутри источника. Варианты одного набора (контур и заливка, начертания)
   * лежат в разных папках, и у каждой свои правила имён и суффикс. В пути `*` заменяет
   * ровно одну часть пути (так задана папка Flat у каждого эмодзи в Fluent).
   */
  svgFolders: z.array(folderSchema).min(1),
  /** monochrome — цвета заменяются на currentColor; color — цветной набор. */
  palette: z.enum(["monochrome", "color"]),
  /** Сетка набора после нормализации: 24 для интерфейсных наборов, 32 для Fluent Emoji (ADR-0014). */
  grid: z.number().int().positive(),
  /**
   * Высота холста в источнике, если она не равна сетке: у Material Symbols — 960, у Phosphor — 256.
   * Иконки масштабируются с коэффициентом grid / sourceGrid.
   */
  sourceGrid: z.number().positive().optional(),
  license: z.strictObject({
    spdx: z.string().min(1),
    /** Файл лицензии внутри источника. */
    file: relativePath,
  }),
  /** Файл с тегами авторов внутри источника (используется при импорте метаданных). */
  tagsFile: relativePath.optional(),
  /**
   * json — рядом с каждой иконкой лежит `{имя}.json` с её метаданными (теги, категории, алиасы),
   * как в репозитории Lucide. Такие файлы скачиваются вместе с SVG.
   */
  iconMetadata: z.literal("json").optional(),
  /**
   * Суффиксы вариантов от старшего к младшему, первый — "" (основной вариант). Вариант, нарисованный
   * так же, как более старший вариант той же иконки, становится его алиасом — как у Iconify (ADR-0002).
   */
  variantAliases: z
    .array(
      z
        .string()
        .regex(
          /^(-[a-z0-9]+)*$/,
          "суффикс — части имени через дефис, например -outline-rounded",
        ),
    )
    .min(2)
    .refine(
      (list) => list[0] === "",
      "первым идёт пустой суффикс — основной вариант",
    )
    .refine(
      (list) => new Set(list).size === list.length,
      "суффиксы не должны повторяться",
    )
    .optional(),
});

export type SourceConfigInput = z.input<typeof sourceConfigSchema>;
export type SourceConfig = z.output<typeof sourceConfigSchema>;
export type SvgFolder = SourceConfig["svgFolders"][number];

/** Находит папку набора, в которой лежит файл: папка файла должна совпасть с путём целиком. */
export function folderMatcher(
  config: SourceConfig,
): (file: string) => SvgFolder | undefined {
  const escapePart = (part: string) =>
    part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const folders = config.svgFolders.map((folder) => {
    const parts = folder.path.split("/");
    const source = parts
      .map((p) => (p === "*" ? "[^/]+" : escapePart(p)))
      .join("/");
    return { folder, pattern: new RegExp(`^${source}$`) };
  });
  return (file) => {
    const dir = file.slice(0, Math.max(0, file.lastIndexOf("/")));
    return folders.find((f) => f.pattern.test(dir))?.folder;
  };
}

/** Служебные файлы, которые нужны помимо SVG. */
export function extraFiles(config: SourceConfig): string[] {
  return [
    ...new Set(
      [
        config.license.file,
        config.tagsFile,
        // package.json есть только у пакетов npm
        config.source.type === "npm" ? "package.json" : undefined,
      ].filter((f): f is string => Boolean(f)),
    ),
  ];
}

/** Нужен ли файл с таким путём (относительно корня источника): SVG, метаданные иконок, служебные файлы. */
export function wantedPath(config: SourceConfig): (path: string) => boolean {
  const extras = new Set(extraFiles(config));
  const folderOf = folderMatcher(config);
  const inIcons = (path: string, ext: string) =>
    path.endsWith(ext) && folderOf(path) !== undefined;
  return (path) =>
    extras.has(path) ||
    inIcons(path, ".svg") ||
    (config.iconMetadata === "json" && inIcons(path, ".json"));
}
