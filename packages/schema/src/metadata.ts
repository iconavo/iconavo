import { z } from "zod";
import { nameSchema } from "./name.js";

/** Ключ карты суффиксов, как у Iconify: пустая строка (базовый вариант) или `-bold`, `-outline-rounded`. */
const suffixKey = z
  .string()
  .regex(
    /^(-[a-z0-9]+)*$/,
    "суффикс — пустая строка или строчные части через дефис, например -bold",
  );

/** `metadata.json` — категории и карта суффиксов вариантов (ADR-0002), в рантайм не идёт. */
export const metadataFileSchema = z.strictObject({
  /** Категория (название для людей) → иконки в ней. */
  categories: z.record(z.string().min(1), z.array(nameSchema)).optional(),
  /** Суффикс имени → название стиля, например «-bold» → «Bold». */
  suffixes: z.record(suffixKey, z.string().min(1)).optional(),
});

export type MetadataFile = z.infer<typeof metadataFileSchema>;
