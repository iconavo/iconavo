import { z } from "zod";
import { nameSchema } from "./name.js";

/** Ключ карты суффиксов, как у Iconify: пустая строка (базовый вариант) или `-bold`, `-outline-rounded`. */
const suffixKey = z
  .string()
  .regex(
    /^(-[a-z0-9]+)*$/,
    "суффикс — пустая строка или строчные части через дефис, например -bold",
  );

/**
 * Общая шкала стилей (ADR-0052) в порядке показа: контур, заливка, двухцветные, цветные. Тот же список
 * — STYLES в общем модуле поиска (@iconavo-ui/search); что они совпадают, проверяет тест конвейера.
 */
export const STYLE_IDS = ["outline", "filled", "duotone", "color"] as const;

/**
 * Таблица стилей набора: каждый суффикс карты (или "" у набора без вариантов) — ровно в одном стиле.
 * Сообщения — для metadata.json и для конфига набора, путь задаёт вызывающий.
 */
export function styleTableIssues(
  styles: Partial<Record<string, readonly string[]>>,
  suffixes: readonly string[] | undefined,
): string[] {
  const listed = Object.values(styles).flatMap((list) => list ?? []);
  const expected = suffixes ?? [""];
  const issues: string[] = [];
  const twice = [...new Set(listed.filter((s, i) => listed.indexOf(s) !== i))];
  if (twice.length > 0) {
    issues.push(
      `суффикс в нескольких стилях: ${twice.map((s) => `«${s}»`).join(", ")}`,
    );
  }
  const missing = expected.filter((s) => !listed.includes(s));
  if (missing.length > 0) {
    issues.push(
      `суффикс без стиля: ${missing.map((s) => `«${s}»`).join(", ")}`,
    );
  }
  const extra = [...new Set(listed.filter((s) => !expected.includes(s)))];
  if (extra.length > 0) {
    issues.push(
      `в стилях суффикс, которого нет в карте вариантов: ${extra.map((s) => `«${s}»`).join(", ")}`,
    );
  }
  return issues;
}

/** Стиль → суффиксы его вариантов в порядке показа; "" — основной вариант (ADR-0052). */
export const styleTableSchema = z.partialRecord(
  z.enum(STYLE_IDS),
  z.array(suffixKey).min(1),
);

/**
 * Часть набора другого автора под своей лицензией (ADR-0017): у Lucide — иконки из Feather, MIT.
 * Имена — нынешние, без повторов, по кодам символов.
 */
export const creditSchema = z.strictObject({
  name: z.string().min(1),
  author: z.string().min(1),
  url: z.url(),
  /** SPDX лицензии этой части. */
  license: z.string().min(1),
  icons: z
    .array(nameSchema)
    .min(1)
    .refine(
      (list) => new Set(list).size === list.length,
      "иконки не должны повторяться",
    ),
});

/**
 * `metadata.json` — категории, карта суффиксов вариантов (ADR-0002), стили (ADR-0052) и части от
 * других авторов (ADR-0017), в рантайм не идёт.
 */
export const metadataFileSchema = z
  .strictObject({
    /** Категория (название для людей) → иконки в ней. */
    categories: z.record(z.string().min(1), z.array(nameSchema)).optional(),
    /** Суффикс имени → название стиля, например «-bold» → «Bold». */
    suffixes: z.record(suffixKey, z.string().min(1)).optional(),
    /** Стиль общей шкалы → суффиксы его вариантов в порядке показа (ADR-0052). */
    styles: styleTableSchema.optional(),
    /** Части набора от других авторов: чьи иконки и под какой лицензией (ADR-0017). */
    credits: z.array(creditSchema).min(1).optional(),
  })
  .superRefine((file, ctx) => {
    if (file.styles === undefined) return;
    const suffixes =
      file.suffixes === undefined ? undefined : Object.keys(file.suffixes);
    for (const message of styleTableIssues(file.styles, suffixes)) {
      ctx.addIssue({ code: "custom", path: ["styles"], message });
    }
  });

export type Credit = z.infer<typeof creditSchema>;
export type MetadataFile = z.infer<typeof metadataFileSchema>;
