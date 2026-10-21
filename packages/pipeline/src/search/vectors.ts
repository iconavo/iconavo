// Смысловая часть прототипа поиска (шаг 12, ADR-0048): векторы карточек из .cache/embeddings
// (ADR-0047) и косинус с вектором запроса. Укороченный вектор — первые L чисел, снова приведённые к
// длине 1: все три модели так умеют (ADR-0047). Все длины считаются за один проход по числам.

import type { EmbeddingModel } from "../embed/config.js";
import { readStore } from "../embed/store.js";
import type { Catalog } from "./catalog.js";

export interface ModelVectors {
  model: EmbeddingModel;
  /** Длины по возрастанию; последняя — полная длина модели. */
  lengths: number[];
  /** Номер документа → есть ли у карточки вектор. */
  present: Uint8Array;
  /** Векторы карточек по номерам документов, полной длины; у карточек без вектора — нули. */
  data: Float32Array;
  /** Для каждой длины — норма первых L чисел вектора каждой карточки. */
  norms: Float32Array[];
  /** Карточек без вектора и с вектором по старому тексту — тогда нужен pnpm embed. */
  absent: number;
  stale: number;
  notes: string[];
}

/** Длины по возрастанию без повторов, не длиннее модели; полная длина — всегда последняя. */
export function vectorLengths(
  model: EmbeddingModel,
  wanted: readonly number[] = [],
): number[] {
  const set = new Set(wanted.filter((l) => l > 0 && l < model.dims));
  return [...set].sort((a, b) => a - b).concat(model.dims);
}

/** Норма первых L чисел для каждой длины — за один проход. */
function partialNorms(
  vector: Float32Array,
  offset: number,
  lengths: readonly number[],
): number[] {
  const out: number[] = [];
  let sum = 0;
  let j = 0;
  for (const length of lengths) {
    for (; j < length; j++) {
      const x = vector[offset + j] as number;
      sum += x * x;
    }
    out.push(Math.sqrt(sum));
  }
  return out;
}

/**
 * Векторы модели для всех карточек каталога. Наборы без векторов, устаревшие векторы — в заметках:
 * поиск работает и так, но замер тогда неточен.
 */
export async function loadModelVectors(
  catalog: Catalog,
  model: EmbeddingModel,
  storeDir: string,
  wantedLengths: readonly number[] = [],
): Promise<ModelVectors> {
  const dims = model.dims;
  const lengths = vectorLengths(model, wantedLengths);
  const count = catalog.docs.length;
  const mv: ModelVectors = {
    model,
    lengths,
    present: new Uint8Array(count),
    data: new Float32Array(count * dims),
    norms: lengths.map(() => new Float32Array(count)),
    absent: 0,
    stale: 0,
    notes: [],
  };
  for (const { id } of catalog.sets) {
    const read = await readStore(storeDir, model, id);
    const docs = catalog.docs
      .map((doc, i) => ({ doc, i }))
      .filter((d) => d.doc.set === id);
    if (read.kind !== "ok") {
      mv.absent += docs.length;
      mv.notes.push(
        read.kind === "missing"
          ? `${id}: нет векторов — запустите pnpm embed ${id} --model=${model.key}`
          : `${id}: ${read.reason} — запустите pnpm embed ${id} --model=${model.key}`,
      );
      continue;
    }
    const { index, vectors } = read.store;
    const rows = new Map(index.rows.map((r, i) => [r.name, i]));
    for (const { doc, i } of docs) {
      const row = rows.get(doc.name);
      if (row === undefined) {
        mv.absent++;
        continue;
      }
      if (index.rows[row]?.textHash !== doc.textHash) mv.stale++;
      mv.data.set(vectors.subarray(row * dims, (row + 1) * dims), i * dims);
      mv.present[i] = 1;
      partialNorms(mv.data, i * dims, lengths).forEach((n, k) => {
        (mv.norms[k] as Float32Array)[i] = n;
      });
    }
  }
  if (mv.absent > 0 || mv.stale > 0) {
    mv.notes.push(
      `векторов нет у ${mv.absent} карточек, устарели у ${mv.stale} — запустите pnpm embed --model=${model.key}`,
    );
  }
  return mv;
}

/**
 * Косинус запроса с каждой карточкой на каждой длине: результат[номер длины][номер документа].
 * Запрос — полной длины; у карточки без вектора — NaN.
 */
export function cosines(mv: ModelVectors, query: Float32Array): Float32Array[] {
  const dims = mv.model.dims;
  if (query.length !== dims) {
    throw new Error(
      `вектор запроса длины ${query.length}, а у модели ${mv.model.key} — ${dims}`,
    );
  }
  const qNorms = partialNorms(query, 0, mv.lengths);
  const count = mv.present.length;
  const out = mv.lengths.map(() => new Float32Array(count).fill(Number.NaN));
  const data = mv.data;
  for (let doc = 0; doc < count; doc++) {
    if (mv.present[doc] !== 1) continue;
    const offset = doc * dims;
    let dot = 0;
    let j = 0;
    for (let k = 0; k < mv.lengths.length; k++) {
      const length = mv.lengths[k] as number;
      for (; j < length; j++) {
        dot += (query[j] as number) * (data[offset + j] as number);
      }
      const denominator =
        (qNorms[k] as number) * ((mv.norms[k] as Float32Array)[doc] as number);
      (out[k] as Float32Array)[doc] = denominator > 0 ? dot / denominator : 0;
    }
  }
  return out;
}

/** Место на диске под векторы каталога такой длины: float32 — 4 байта на число. */
export const catalogBytes = (docs: number, length: number) => docs * length * 4;
