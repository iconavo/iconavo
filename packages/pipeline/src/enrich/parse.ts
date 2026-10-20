// Разбор ответа модели (ADR-0020): текст по типу блока, JSON по схеме, чистка синонимов и строгая
// проверка languageSchema. Любой отказ — с причиной; такие иконки в search.json не попадают и
// отправляются в следующем запуске снова.

import { languageSchema } from "@iconavo-ui/schema";
import { z } from "zod";
import type { Enrichment } from "./apply.js";
import type { BatchMessage, BatchResult } from "./batch.js";

/** Границы languageSchema: синонимов 5–10. Лишние отбрасываются, нехватка — отказ. */
export const SYNONYMS_MIN = 5;
export const SYNONYMS_MAX = 10;

const rawLanguage = z.strictObject({
  description: z.string(),
  synonyms: z.array(z.string()),
});
const rawAnswer = z.strictObject({ ru: rawLanguage, en: rawLanguage });

export type ParseOutcome =
  | { ok: true; value: Enrichment }
  | { ok: false; reason: string };

const fail = (reason: string): ParseOutcome => ({ ok: false, reason });

/** Пробелы по краям и внутри, строчные буквы, без повторов, пустых и самого имени иконки. */
export function normalizeSynonyms(
  list: readonly string[],
  name: string,
): string[] {
  const own = new Set([name, name.replaceAll("-", " ")]);
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (s === "" || own.has(s) || out.includes(s)) continue;
    out.push(s);
  }
  return out.slice(0, SYNONYMS_MAX);
}

const cleanDescription = (text: string) => text.trim().replace(/\s+/g, " ");

/** Ответ модели → описание и синонимы на двух языках или причина отказа. */
export function parseAnswer(
  message: BatchMessage,
  name: string,
  promptVersion: number,
): ParseOutcome {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    return fail(`отказ модели${category ? ` (${category})` : ""}`);
  }
  if (message.stop_reason === "max_tokens") {
    return fail("ответ обрезан: не хватило max_tokens");
  }
  const text = message.content.find(
    (b) => b.type === "text" && typeof b.text === "string",
  )?.text;
  if (text === undefined) return fail("в ответе нет текста");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("ответ — не JSON");
  }
  const raw = rawAnswer.safeParse(json);
  if (!raw.success) {
    const issue = raw.error.issues[0];
    return fail(
      `ответ не по схеме: ${issue ? `${issue.path.join(".") || "(ответ)"} — ${issue.message}` : "?"}`,
    );
  }
  const value: Enrichment = {
    ru: { description: "", synonyms: [] },
    en: { description: "", synonyms: [] },
    promptVersion,
  };
  for (const lang of ["ru", "en"] as const) {
    const description = cleanDescription(raw.data[lang].description);
    const synonyms = normalizeSynonyms(raw.data[lang].synonyms, name);
    if (description === "") return fail(`${lang}: пустое описание`);
    if (synonyms.length < SYNONYMS_MIN) {
      return fail(
        `${lang}: синонимов ${synonyms.length}, нужно ${SYNONYMS_MIN}–${SYNONYMS_MAX}`,
      );
    }
    const check = languageSchema.safeParse({ description, synonyms });
    if (!check.success) {
      return fail(
        `${lang}: ${check.error.issues[0]?.message ?? "не по схеме"}`,
      );
    }
    value[lang] = check.data;
  }
  return { ok: true, value };
}

/** Результат пакета → описание или причина: ошибки пакета тоже отказ, за них не платят. */
export function resultOutcome(
  result: BatchResult,
  name: string,
  promptVersion: number,
): ParseOutcome {
  switch (result.type) {
    case "succeeded":
      return parseAnswer(result.message, name, promptVersion);
    case "errored": {
      const e = result.error.error;
      return fail(
        `ошибка запроса${e?.type ? ` ${e.type}` : ""}${e?.message ? `: ${e.message}` : ""}`,
      );
    }
    case "canceled":
      return fail("пакет отменён");
    case "expired":
      return fail("пакет истёк за 24 часа — запрос не выполнен");
  }
}
