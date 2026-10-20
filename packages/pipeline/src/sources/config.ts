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

/** Суффикс варианта (ADR-0002): "" — основной вариант, иначе части имени через дефис. */
const suffixSchema = z
  .string()
  .regex(
    /^(-[a-z0-9]+)*$/,
    "суффикс — части имени через дефис, например -outline-rounded",
  );

/**
 * Разрешительные лицензии, с которыми набор можно добавить, и их названия для людей — как у Iconify.
 * Другая лицензия — только отдельным решением (ADR-0017).
 */
export const LICENSE_IDS = ["MIT", "ISC", "Apache-2.0"] as const;
export type LicenseId = (typeof LICENSE_IDS)[number];
export const LICENSE_TITLES: Record<LicenseId, string> = {
  MIT: "MIT",
  ISC: "ISC",
  "Apache-2.0": "Apache 2.0",
};

/** Форматы метаданных автора: откуда брать теги и категории (ADR-0017). */
export const METADATA_FORMATS = [
  "lucide",
  "tabler",
  "phosphor",
  "fluent-emoji",
] as const;
export type MetadataFormat = (typeof METADATA_FORMATS)[number];

/** Файлы метаданных автора каждого формата: шаблоны путей внутри источника (см. pathPattern). */
export const METADATA_FILES: Record<MetadataFormat, readonly string[]> = {
  // {имя}.json рядом с каждой иконкой; названия категорий — в categories/{слаг}.json.
  lucide: ["icons/*.json", "categories/*.json"],
  // Один файл на набор: теги и категория по базовому имени иконки.
  tabler: ["icons.json"],
  // Массив иконок в модуле JavaScript; читается как текст, без запуска.
  phosphor: ["dist/index.mjs"],
  // metadata.json в папке каждого эмодзи — общий для всех оттенков кожи.
  "fluent-emoji": ["assets/*/metadata.json"],
};

/** Файл NOTICE в корне источника, если автор его положил: берётся первый найденный (ADR-0017). */
export const NOTICE_FILES = ["NOTICE", "NOTICE.txt", "NOTICE.md"] as const;

/** Конфиг одного набора: `sources/{id}.ts` (ADR-0012). */
export const sourceConfigSchema = z
  .strictObject({
    /** Префикс набора, он же имя файла конфига (ADR-0001). */
    id: nameSchema,
    name: z.string().min(1),
    /** Автор набора и ссылка на него — как у Iconify (ADR-0017). */
    author: z.strictObject({
      name: z.string().min(1),
      url: z.url().optional(),
    }),
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
     * одну часть пути (так задана папка Flat у каждого эмодзи в Fluent).
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
      spdx: z.enum(
        LICENSE_IDS,
        `лицензия — одна из разрешённых: ${LICENSE_IDS.join(", ")}; другую добавляют только отдельным решением (ADR-0017)`,
      ),
      /** Файл лицензии внутри источника. */
      file: relativePath,
      /**
       * Отпечаток текста, который прочитал и подтвердил владелец: SHA-256 от SPDX, LICENSE и NOTICE
       * (licenseHash). Нет или не совпадает — набор останавливается (ADR-0017). Вписывается только
       * после явного подтверждения человеком.
       */
      confirmed: z
        .string()
        .regex(/^[0-9a-f]{64}$/, "отпечаток лицензии — 64 символа 0-9 и a-f")
        .optional(),
    }),
    /** Формат метаданных автора: теги и категории (ADR-0017). Нет — теги из частей имени. */
    metadata: z.enum(METADATA_FORMATS).optional(),
    /** Варианты набора и их названия для сайта (ADR-0002): "" — основной вариант. */
    suffixes: z.record(suffixSchema, z.string().min(1)).optional(),
    /** Витрина набора вместо автоматической: до шести иконок (ADR-0017). */
    samples: z
      .array(nameSchema)
      .min(1)
      .max(6)
      .refine(
        (list) => new Set(list).size === list.length,
        "иконки витрины не должны повторяться",
      )
      .optional(),
    /**
     * Суффиксы вариантов от старшего к младшему, первый — "" (основной вариант). Вариант, нарисованный
     * так же, как более старший вариант той же иконки, становится его алиасом — как у Iconify (ADR-0002).
     */
    variantAliases: z
      .array(suffixSchema)
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
  })
  .superRefine((config, ctx) => {
    const missing = (config.variantAliases ?? []).filter(
      (suffix) => !Object.hasOwn(config.suffixes ?? {}, suffix),
    );
    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["suffixes"],
        message: `нет названий для суффиксов из variantAliases: ${missing.map((s) => `«${s}»`).join(", ")}`,
      });
    }
  });

export type SourceConfigInput = z.input<typeof sourceConfigSchema>;
export type SourceConfig = z.output<typeof sourceConfigSchema>;
export type SvgFolder = SourceConfig["svgFolders"][number];

/** Шаблон пути: звёздочка — любые символы внутри одной части пути, например `icons/*.json`. */
export function pathPattern(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${source}$`);
}

/** Находит папку набора, в которой лежит файл: папка файла должна совпасть с путём целиком. */
export function folderMatcher(
  config: SourceConfig,
): (file: string) => SvgFolder | undefined {
  const folders = config.svgFolders.map((folder) => ({
    folder,
    pattern: pathPattern(folder.path),
  }));
  return (file) => {
    const dir = file.slice(0, Math.max(0, file.lastIndexOf("/")));
    return folders.find((f) => f.pattern.test(dir))?.folder;
  };
}

/** Служебные файлы, которые нужны помимо SVG (NOTICE — необязательный, его здесь нет). */
export function extraFiles(config: SourceConfig): string[] {
  return [
    config.license.file,
    // package.json есть только у пакетов npm
    ...(config.source.type === "npm" && config.license.file !== "package.json"
      ? ["package.json"]
      : []),
  ];
}

/** Шаблоны файлов метаданных автора, которые нужны набору. */
export const metadataFiles = (config: SourceConfig): readonly string[] =>
  config.metadata ? METADATA_FILES[config.metadata] : [];

/**
 * Нужен ли файл с таким путём (относительно корня источника): SVG из папок набора, служебные файлы,
 * NOTICE и метаданные автора.
 */
export function wantedPath(config: SourceConfig): (path: string) => boolean {
  const extras = new Set<string>([...extraFiles(config), ...NOTICE_FILES]);
  const folderOf = folderMatcher(config);
  const metadata = metadataFiles(config).map(pathPattern);
  return (path) =>
    extras.has(path) ||
    (path.endsWith(".svg") && folderOf(path) !== undefined) ||
    metadata.some((re) => re.test(path));
}

/**
 * Что скачивается из источника — для метки кэша: если правила изменились, набор скачивается заново,
 * даже когда версия та же.
 */
export function downloadRules(config: SourceConfig): string {
  return JSON.stringify({
    folders: config.svgFolders.map((f) => f.path),
    files: [...extraFiles(config), ...NOTICE_FILES],
    metadata: metadataFiles(config),
  });
}
