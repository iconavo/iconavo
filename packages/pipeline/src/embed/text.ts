// Текст иконки для эмбеддинга (ADR-0047): один на оба языка — имя, теги, описание и синонимы en,
// затем ru. Название набора и стиль в текст не входят. Хэш берётся от того, что уходит модели:
// поменялось хоть слово — вектор этой иконки считается заново.

import { createHash } from "node:crypto";
import type { SearchEntry } from "@iconavo-ui/schema";
import type { EmbeddingModel } from "./config.js";

const clean = (text: string) => text.trim().replace(/\s+/g, " ");

/** Текст базовой иконки; без описаний на обоих языках — undefined. */
export function iconText(name: string, entry: SearchEntry): string | undefined {
  if (!entry.ru || !entry.en) return undefined;
  const lines = [name.replaceAll("-", " "), entry.tags.join(", ")];
  for (const lang of [entry.en, entry.ru]) {
    lines.push(lang.description, lang.synonyms.join(", "));
  }
  return lines
    .map(clean)
    .filter((line) => line !== "")
    .join("\n");
}

/** Поисковый запрос, как он уходит модели: у Qwen — с инструкцией, «Query:» без пробела, как в карточке. */
export function queryInput(model: EmbeddingModel, query: string): string {
  const q = clean(query);
  return model.queryInstruction === undefined
    ? q
    : `Instruct: ${model.queryInstruction}\nQuery:${q}`;
}

/** Хэш текста: первые 16 символов SHA-256. */
export const textHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);
