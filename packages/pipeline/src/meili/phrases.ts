// Фразы каталога для векторов заранее (ADR-0040, ADR-0049): имена, теги и синонимы ru/en каждой
// карточки и отдельные слова из них, нормализованные так же, как запрос пользователя. Запрос,
// совпавший с такой фразой, не ждёт модель: функция edge API берёт вектор из бакета по vectorHash.
// Вектор фразы — отдельный объект phrases/gemini-1024/{хэш}.f32: дозапись продолжается после обрыва
// по списку бакета, а лишние фразы не мешают.

import {
  normalizeText,
  QUERY_MAX_LENGTH,
  SEARCH_MODEL,
  STOP_WORDS,
  STORE_KEYS,
  vectorHash,
} from "@iconavo-ui/search";
import type { StorageClient } from "../cdn/storage.js";
import type { Catalog } from "../search/catalog.js";

/** Слово короче — не фраза: «e» из «e-mail» вектор не стоит. */
const MIN_WORD_LENGTH = 2;

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Фразы и слова каталога без повторов, по алфавиту. */
export function catalogPhrases(catalog: Catalog): string[] {
  const out = new Set<string>();
  const add = (phrase: string) => {
    if (
      phrase.length >= MIN_WORD_LENGTH &&
      phrase.length <= QUERY_MAX_LENGTH &&
      !STOP_WORDS.has(phrase)
    ) {
      out.add(phrase);
    }
  };
  for (const doc of catalog.docs) {
    const { name, tags, en, ru } = doc.phrases;
    for (const text of [...name, ...tags, ...en, ...ru]) {
      const phrase = normalizeText(text);
      add(phrase);
      for (const word of phrase.split(" ")) add(word);
    }
  }
  return [...out].sort(order);
}

export interface PhraseEntry {
  phrase: string;
  hash: string;
}

/** Ключи векторов фраз — те же, что посчитает функция edge API для запроса. */
export function phraseEntries(
  phrases: readonly string[],
): Promise<PhraseEntry[]> {
  return Promise.all(
    phrases.map(async (phrase) => ({
      phrase,
      hash: await vectorHash(SEARCH_MODEL.id, phrase),
    })),
  );
}

/** Хэши фраз, векторы которых уже в бакете. */
export async function storedPhraseHashes(
  storage: StorageClient,
): Promise<Set<string>> {
  const prefix = STORE_KEYS.phrasePrefix;
  const out = new Set<string>();
  for (const object of await storage.list(prefix)) {
    const name = object.key.slice(prefix.length);
    if (name.endsWith(".f32") && object.size === SEARCH_MODEL.dims * 4) {
      out.add(name.slice(0, -".f32".length));
    }
  }
  return out;
}
