// Пакет запросов (Message Batches API): узкий интерфейс клиента, чтобы в тестах подменять его без
// сети, и файл состояния пакета — по нему прерванный запуск продолжается с опроса результатов.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { TokenUsage } from "./cost.js";

export interface BatchRequest {
  custom_id: string;
  params: Anthropic.Messages.MessageCreateParamsNonStreaming;
}

export interface BatchCounts {
  processing: number;
  succeeded: number;
  errored: number;
  canceled: number;
  expired: number;
}

export interface BatchStatus {
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts: BatchCounts;
}

/** Ответ модели: блоки читаются по типу — первыми могут идти блоки thinking. */
export interface BatchMessage {
  content: readonly { type: string; text?: string }[];
  stop_reason: string | null;
  stop_details?: {
    category?: string | null;
    explanation?: string | null;
  } | null;
  usage: TokenUsage;
}

export type BatchResult =
  | { type: "succeeded"; message: BatchMessage }
  | {
      type: "errored";
      error: { error?: { type?: string; message?: string } | null };
    }
  | { type: "canceled" }
  | { type: "expired" };

export interface BatchResponse {
  custom_id: string;
  result: BatchResult;
}

/** Та часть API, которая нужна обогащению; настоящий клиент — в client.ts. */
export interface BatchClient {
  create(requests: readonly BatchRequest[]): Promise<{ id: string }>;
  retrieve(id: string): Promise<BatchStatus>;
  results(id: string): Promise<AsyncIterable<BatchResponse>>;
}

/** Состояние пакета: что отправлено и под какими custom_id. */
export const batchStateSchema = z.strictObject({
  batchId: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.number().int().positive(),
  requests: z.record(
    z.string(),
    z.strictObject({
      name: z.string().min(1),
      /** Отпечаток на момент отправки: изменился — результат не применяется. */
      fingerprint: z.string().min(1),
    }),
  ),
});

export type BatchState = z.infer<typeof batchStateSchema>;

export const STATE_FILE = "batch.json";

/** Состояние или undefined, если файла нет; повреждённый файл — ошибка с подсказкой. */
export async function readState(path: string): Promise<BatchState | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  const parsed = batchStateSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `файл состояния пакета ${path} повреждён — удалите его, если пакет уже не нужен`,
    );
  }
  return parsed.data;
}

export async function writeState(
  path: string,
  state: BatchState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function removeState(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Итог последнего прогона с отправкой — отчёт показывает его, когда отправлять уже нечего. */
export const lastRunSchema = z.strictObject({
  batchId: z.string().min(1),
  promptVersion: z.number().int().positive(),
  sent: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cost: z.strictObject({
    usd: z.number().nonnegative(),
    requests: z.number().int().nonnegative(),
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
  }),
});

export type LastRun = z.infer<typeof lastRunSchema>;

export const LAST_FILE = "last.json";

/** Итог прошлого прогона или undefined: файл только для отчёта, повреждённый — как отсутствующий. */
export async function readLast(path: string): Promise<LastRun | undefined> {
  try {
    const parsed = lastRunSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function writeLast(path: string, last: LastRun): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(last, null, 2)}\n`, "utf8");
}
