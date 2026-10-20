import { z } from "zod";
import { versionSchema } from "./changelog.js";
import { nameSchema } from "./name.js";

/** Лицензия набора хранится полностью (ADR-0017). */
export const licenseSchema = z.strictObject({
  spdx: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.url().optional(),
  text: z.string().min(1),
  notice: z.string().min(1).optional(),
  /** Ссылка на источник: репозиторий или пакет npm. */
  source: z.url(),
  /** Версия пакета npm или коммит git, с которых взяты иконки. */
  revision: z.string().min(1),
  /** Человек подтвердил лицензию при добавлении набора. */
  confirmed: z.boolean().default(false),
});

/** `info.json` — сведения о наборе для сайта и MCP, в рантайм не идёт. */
export const infoFileSchema = z.looseObject({
  name: z.string().min(1),
  total: z.number().int().nonnegative(),
  author: z.strictObject({
    name: z.string().min(1),
    url: z.url().optional(),
  }),
  license: licenseSchema,
  /** Высота сетки: 24 для интерфейсных наборов, 32 для Fluent Emoji (ADR-0014). */
  height: z.union([z.number().positive(), z.array(z.number().positive())]),
  /** Иконки для витрины набора. */
  samples: z.array(nameSchema).max(6).optional(),
  /** true — набор цветной, цвет не заменяется на currentColor. */
  palette: z.boolean(),
  /** Версия набора: отпечаток списка иконок, 8 символов (ADR-0018). */
  version: versionSchema.optional(),
});

export type License = z.infer<typeof licenseSchema>;
export type InfoFile = z.infer<typeof infoFileSchema>;
