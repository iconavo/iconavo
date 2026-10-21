import type { ChatClient } from "./client.js";
import type { Verdict } from "./golden.js";
import { candidateLines } from "./prompt.js";

export interface FakeJudgeOptions {
  /** Вердикт по тексту запроса и имени кандидата без набора; по умолчанию — «no». */
  verdict?: (promptText: string, name: string) => Verdict;
  /** Ошибка для вызова номер call (с 1). */
  fail?: (call: number) => Error | undefined;
  /** Подменить текст ответа целиком. */
  answer?: (call: number, numbers: number[]) => string | undefined;
  /** Рублей за вызов; null — Polza не вернула cost_rub. */
  rub?: number | null;
}

/** Подменный судья без сети: отвечает по правилу, запоминает вызовы и картинки в них. */
export function fakeJudgeClient(options: FakeJudgeOptions = {}) {
  const calls: {
    names: string[];
    images: number;
    body: Record<string, unknown>;
  }[] = [];
  const client: ChatClient = {
    async complete(body) {
      const lines = candidateLines(body);
      const content = ((body.messages as { content: unknown[] }[])[0]
        ?.content ?? []) as { type: string; text?: string }[];
      calls.push({
        names: lines.map((l) => l.name),
        images: content.filter((p) => p.type === "image_url").length,
        body,
      });
      const call = calls.length;
      await new Promise((resolve) => setImmediate(resolve));
      const error = options.fail?.(call);
      if (error) throw error;
      const prompt = content[0]?.text ?? "";
      const text =
        options.answer?.(
          call,
          lines.map((l) => l.n),
        ) ??
        JSON.stringify({
          verdicts: lines.map((l) => ({
            n: l.n,
            verdict: options.verdict?.(prompt, l.name) ?? "no",
          })),
        });
      const rub = options.rub === undefined ? 0.05 : options.rub;
      return {
        text,
        promptTokens: 1000 + 100 * lines.length,
        completionTokens: 200,
        ...(rub === null ? {} : { rub }),
        ms: 5,
      };
    },
  };
  return { client, calls };
}
