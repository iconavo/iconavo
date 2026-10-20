import { z } from "zod";
import { nameSchema } from "./name.js";

/** Версия набора: первые 8 символов SHA-256 от icons.json без lastModified (ADR-0018). */
export const versionSchema = z
  .string()
  .regex(/^[0-9a-f]{8}$/, "версия — 8 символов 0-9 и a-f");

/** Список имён выпуска: пустые списки не пишутся, имена не повторяются. */
const namesSchema = z
  .array(nameSchema)
  .min(1)
  .refine(
    (names) => new Set(names).size === names.length,
    "имена не должны повторяться",
  );

/** Имя → имя: старое → новое у переименований, алиас → родитель у новых алиасов. */
const pairsSchema = z
  .record(nameSchema, nameSchema)
  .refine((pairs) => Object.keys(pairs).length > 0, "пустой список не пишется");

/** Выпуск набора: версия, отличная от прошлой, и что изменилось (ADR-0018). */
export const releaseSchema = z.strictObject({
  version: versionSchema,
  /** Версия прошлого выпуска; у первой записи журнала её нет. */
  previous: versionSchema.optional(),
  /** Дата выпуска по UTC, с точностью до секунды; она же lastModified в icons.json. */
  date: z.iso.datetime(),
  /** Версия пакета npm или коммит git, из которых собран выпуск. */
  revision: z.string().min(1),
  /** Видимых иконок в выпуске: без скрытых и без алиасов. */
  total: z.number().int().nonnegative(),
  /** Новые иконки. */
  added: namesSchema.optional(),
  /** Рисунок изменился (другой отпечаток). */
  changed: namesSchema.optional(),
  /** Были скрыты, а теперь снова есть у автора. */
  restored: namesSchema.optional(),
  /** Автор удалил: иконка осталась с пометкой hidden и работает по имени (ADR-0005). */
  hidden: namesSchema.optional(),
  /** Старое имя → новое: старое стало алиасом. */
  renamed: pairsSchema.optional(),
  /** Новые алиасы уже известных иконок: алиас → родитель. */
  aliases: pairsSchema.optional(),
});

/** `changelog.json` — журнал выпусков набора для сайта и CI, свежие выпуски сверху. В рантайм не идёт. */
export const changelogFileSchema = z
  .strictObject({
    prefix: nameSchema,
    releases: z.array(releaseSchema).min(1),
  })
  .superRefine((file, ctx) => {
    file.releases.forEach((release, i) => {
      const older = file.releases[i + 1];
      if (older === undefined) {
        if (release.previous !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["releases", i, "previous"],
            message: "у первой записи журнала нет прошлой версии",
          });
        }
        return;
      }
      if (release.previous !== older.version) {
        ctx.addIssue({
          code: "custom",
          path: ["releases", i, "previous"],
          message: `прошлая версия должна быть ${older.version} — версия следующего выпуска в списке`,
        });
      }
      if (Date.parse(release.date) <= Date.parse(older.date)) {
        ctx.addIssue({
          code: "custom",
          path: ["releases", i, "date"],
          message:
            "выпуски идут от свежих к старым: дата должна быть позже следующей",
        });
      }
    });
  });

export type Release = z.infer<typeof releaseSchema>;
export type ChangelogFile = z.infer<typeof changelogFileSchema>;
