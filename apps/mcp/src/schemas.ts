// Общие части схем инструментов (ADR-0044): имена по ADR-0001, шкала стилей ADR-0052, набор с
// автором и лицензией — в каждом ответе. Схемы создаются один раз на копию функции: сервер MCP
// собирается заново на каждый запрос, а разбор zod-схем — самое дорогое в нём.

import { STYLES } from "@iconavo-ui/search";
import * as z from "zod";

/** Часть имени по ADR-0001: строчные латинские буквы и цифры через дефис. */
export const NAME_PART = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/;

export const SetPrefix = z
  .string()
  .max(64)
  .regex(NAME_PART)
  .describe('Icon set prefix from list_sets, e.g. "lucide"');

export const IconName = z
  .string()
  .max(129)
  .regex(ICON_NAME)
  .describe('Full icon name "set:icon", e.g. "lucide:house"');

export const StyleSchema = z
  .enum(STYLES)
  .describe(
    "Style on Iconavo's common scale: outline — line icons; filled — solid shapes; duotone — two tones; color — multicolor (emoji)",
  );

export const AuthorSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
});

export const LicenseSchema = z.object({
  title: z.string(),
  spdx: z.string().describe('SPDX identifier, e.g. "MIT"'),
  url: z.string().optional(),
});

export const CreditSchema = z.object({
  name: z.string().describe("Original set the icons come from"),
  author: z.string(),
  license: z.string(),
  url: z.string(),
});

/** Набор иконки: кто автор и под какой лицензией — то, что нужно для указания авторства. */
export const SetInfoSchema = z.object({
  prefix: z.string(),
  name: z.string(),
  author: AuthorSchema,
  license: LicenseSchema,
  palette: z
    .boolean()
    .describe("true — multicolor set: color and stroke width do not apply"),
  credits: z
    .array(CreditSchema)
    .optional()
    .describe("Parts of the set made by other authors"),
});

/** Стиль → имя того же рисунка в этом стиле. */
export const StylesSchema = z.object({
  outline: z.string().optional(),
  filled: z.string().optional(),
  duotone: z.string().optional(),
  color: z.string().optional(),
});
