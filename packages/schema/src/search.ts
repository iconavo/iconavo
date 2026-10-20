import { z } from "zod";
import { nameSchema } from "./name.js";

/** Описание и синонимы на одном языке (ADR-0020): 5–10 синонимов. */
export const languageSchema = z.strictObject({
  description: z.string().min(1),
  synonyms: z.array(z.string().min(1)).min(5).max(10),
});

export type Language = z.infer<typeof languageSchema>;

export const searchEntrySchema = z
  .strictObject({
    /** Отпечаток иконки: первые 12 символов SHA-256 (ADR-0018). */
    fingerprint: z
      .string()
      .regex(/^[0-9a-f]{12}$/, "отпечаток — ровно 12 символов 0-9 и a-f"),
    /** Теги в нижнем регистре, без повторов (ADR-0017). */
    tags: z
      .array(z.string().min(1))
      .refine(
        (tags) => tags.every((t) => t === t.toLowerCase()),
        "теги — только строчными буквами",
      )
      .refine(
        (tags) => new Set(tags).size === tags.length,
        "теги не должны повторяться",
      ),
    /** Результат обогащения ИИ; пока иконка не обогащена, полей нет. */
    ru: languageSchema.optional(),
    en: languageSchema.optional(),
    /** Версия промпта, которым сделано обогащение. */
    promptVersion: z.number().int().positive().optional(),
  })
  .superRefine((entry, ctx) => {
    if (Boolean(entry.ru) !== Boolean(entry.en)) {
      ctx.addIssue({
        code: "custom",
        path: [entry.ru ? "en" : "ru"],
        message: "описание нужно на обоих языках сразу (ru и en)",
      });
    }
  });

/** `search.json` — данные для поиска, в рантайм не идёт. */
export const searchFileSchema = z.strictObject({
  prefix: nameSchema,
  icons: z.record(z.string(), searchEntrySchema),
});

export type SearchEntry = z.infer<typeof searchEntrySchema>;
export type SearchFile = z.infer<typeof searchFileSchema>;
