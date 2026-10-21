// Разбор ответа /embeddings (ADR-0047): векторы раскладываются по номеру index, а не по порядку в
// ответе; длина и числа проверяются, каждый вектор приводится к длине 1 — тогда похожесть векторов
// равна их скалярному произведению. Любое несоответствие — ошибка с понятной причиной.

import { z } from "zod";

const responseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative().optional(),
      embedding: z.unknown(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative().optional(),
      cost_rub: z.number().nonnegative().nullable().optional(),
      cost: z.number().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export interface ParsedEmbeddings {
  /** Векторы в порядке входных текстов, каждый длины 1. */
  vectors: Float32Array[];
  /** Токены и рубли из usage; нет в ответе — undefined. */
  tokens?: number;
  rub?: number;
}

/**
 * Вектор длины 1 из чисел ответа; норма считается в float64. Нечисло, бесконечность или нулевой
 * вектор — undefined.
 */
export function unitVector(
  values: readonly unknown[],
): Float32Array | undefined {
  let sum = 0;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    sum += v * v;
  }
  const norm = Math.sqrt(sum);
  if (!(norm > 0) || !Number.isFinite(norm)) return undefined;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = (values[i] as number) / norm;
  return out;
}

/** JSON ответа → count векторов длины dims или ошибка. */
export function parseEmbeddings(
  json: unknown,
  count: number,
  dims: number,
): ParsedEmbeddings {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `ответ не по формату: ${issue ? `${issue.path.join(".") || "(ответ)"} — ${issue.message}` : "?"}`,
    );
  }
  const { data, usage } = parsed.data;
  if (data.length !== count) {
    throw new Error(`векторов в ответе ${data.length}, а текстов ${count}`);
  }
  const vectors: (Float32Array | undefined)[] = new Array(count);
  data.forEach((item, position) => {
    const i = item.index ?? position;
    if (i >= count || vectors[i] !== undefined) {
      throw new Error(
        "номера векторов (index) повторяются или выходят за число текстов",
      );
    }
    const e = item.embedding;
    if (typeof e === "string") {
      throw new Error("вектор пришёл строкой (base64), а нужен массив чисел");
    }
    if (!Array.isArray(e)) throw new Error("вектор — не массив чисел");
    if (e.length !== dims) {
      throw new Error(
        `модель вернула ${e.length} чисел вместо ${dims} — проверьте dims в embed/config.ts`,
      );
    }
    const unit = unitVector(e);
    if (!unit) {
      throw new Error("в векторе не числа или вектор нулевой длины");
    }
    vectors[i] = unit;
  });
  const out: ParsedEmbeddings = { vectors: vectors as Float32Array[] };
  if (usage?.prompt_tokens !== undefined) out.tokens = usage.prompt_tokens;
  const rub = usage?.cost_rub ?? usage?.cost;
  if (rub !== undefined && rub !== null) out.rub = rub;
  return out;
}
