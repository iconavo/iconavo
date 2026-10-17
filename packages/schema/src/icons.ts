import { z } from "zod";
import { nameSchema } from "./name.js";

const size = z.number().positive();

// Поля положения и преобразований общие для иконки и алиаса (как в IconifyJSON).
const placement = {
  width: size.optional(),
  height: size.optional(),
  left: z.number().optional(),
  top: z.number().optional(),
  rotate: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
    .optional(),
  hFlip: z.boolean().optional(),
  vFlip: z.boolean().optional(),
  hidden: z.boolean().optional(),
};

// Лишние поля разрешены: файл остаётся совместимым с IconifyJSON (ADR-0003).
export const iconSchema = z.looseObject({
  body: z.string().min(1),
  ...placement,
});

export const aliasSchema = z.looseObject({
  parent: nameSchema,
  ...placement,
});

/** `icons.json` — единственный файл набора, который попадает в рантайм. */
export const iconsFileSchema = z.looseObject({
  prefix: nameSchema,
  icons: z.record(z.string(), iconSchema),
  aliases: z.record(z.string(), aliasSchema).optional(),
  lastModified: z.number().int().nonnegative().optional(),
  width: size.optional(),
  height: size.optional(),
  left: z.number().optional(),
  top: z.number().optional(),
});

export type Icon = z.infer<typeof iconSchema>;
export type Alias = z.infer<typeof aliasSchema>;
export type IconsFile = z.infer<typeof iconsFileSchema>;
