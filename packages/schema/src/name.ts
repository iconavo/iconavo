import { z } from "zod";

/** Имя по ADR-0001: строчные латинские буквы, цифры и одиночные дефисы, без дефиса в начале и в конце. */
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const NAME_MESSAGE =
  "имя может содержать только a-z, 0-9 и одиночные дефисы (не в начале и не в конце)";

export const nameSchema = z.string().regex(NAME_PATTERN, NAME_MESSAGE);
