// Запрос к модели (ADR-0020, ADR-0046): системный промпт, схема ответа для API и сборка запроса
// пакета. Картинка идёт первой, затем текст: набор, имя иконки и теги автора. Промпт на английском
// с русскими примерами: токены дешевле, а описания модель пишет на обоих языках.

import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CUSTOM_ID_LIMIT, EFFORT, MAX_TOKENS, MODEL } from "./config.js";

export const SYSTEM_PROMPT = `You describe icons for a multilingual icon search engine. You get a PNG of one icon (black drawing on white), the name of its icon set, the icon name and the author's tags.

Return a JSON object with two languages, "ru" (Russian) and "en" (English). For each language:
- "description": one sentence, at most 20 words, saying what is drawn and what the icon usually means in an interface. Describe only what is visible in the picture; use the name and tags to understand the intended meaning. Never mention details that are not in the picture.
- "synonyms": 7 to 10 search words or short phrases that people would type to find this icon: everyday and colloquial words too (Russian examples: «мусорка», «домик», «шестерёнка», «лупа»), related actions and objects. Lowercase, no duplicates, no sentences, and do not repeat the icon name itself.

Brand or product names are allowed only when the icon is a logo of that brand. Output only the JSON object.`;

/**
 * Схема ответа для API. Без min/max: структурированный вывод их не поддерживает, 5–10 синонимов
 * проверяет parse.ts.
 */
export const answerFormat = z.strictObject({
  ru: z.strictObject({
    description: z
      .string()
      .describe(
        "One sentence in Russian: what is drawn and what the icon means.",
      ),
    synonyms: z
      .array(z.string())
      .describe("7 to 10 Russian search words or short phrases, lowercase."),
  }),
  en: z.strictObject({
    description: z
      .string()
      .describe(
        "One sentence in English: what is drawn and what the icon means.",
      ),
    synonyms: z
      .array(z.string())
      .describe("7 to 10 English search words or short phrases, lowercase."),
  }),
});

export interface EnrichInput {
  setName: string;
  name: string;
  tags: readonly string[];
  /** PNG, который видит модель. */
  png: Buffer;
}

/** Имя иконки, если помещается в лимит пакета, иначе — хэш имени. */
export function customId(name: string): string {
  if (name.length <= CUSTOM_ID_LIMIT) return name;
  return `x-${createHash("sha1").update(name).digest("hex").slice(0, 20)}`;
}

export const userText = (input: Omit<EnrichInput, "png">) =>
  `Icon set: ${input.setName}\nIcon name: ${input.name}\nAuthor tags: ${input.tags.length > 0 ? input.tags.join(", ") : "none"}`;

/** Схема ответа как её получает API: JSON Schema из zod. */
export const answerSchema = (): Record<string, unknown> =>
  zodOutputFormat(answerFormat).schema;

/** Параметры одного запроса пакета: без thinking (адаптивное по умолчанию) и без temperature. */
export function buildRequest(
  input: EnrichInput,
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: answerSchema() },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: input.png.toString("base64"),
            },
          },
          { type: "text", text: userText(input) },
        ],
      },
    ],
  };
}
