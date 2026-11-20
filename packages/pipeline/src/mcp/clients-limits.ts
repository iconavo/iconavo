// Лимиты MCP-сервера глазами ассистента (шаг 12 фазы 4, ADR-0044): с этого компьютера — быстрые вызовы
// get_matching_set, пока не придёт rate_limited (у этого инструмента счётчик стоит до кэша; повторы
// поиска из кэша лимит не считают). Пока счётчик полон, Claude Code ищет иконку — он должен получить
// ошибку и понятно объяснить человеку, что подождать. Через полторы минуты поиск снова работает.
// Счётчик Cloudflare приблизительный и свой у каждого дата-центра: ждём ошибку за ~150 вызовов, а не
// ровно на 61-м.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { fail, pass, type Verdict } from "../sandbox/verdict.js";
import { runClaude, type Transcript } from "./clients.js";
import { MCP_ORIGIN, MCP_PATH } from "./config.js";

/** Больше вызовов без ошибки — лимит не сработал. */
const MAX_CALLS = 150;
/** Пауза между вызовами, пока Claude Code думает: счётчик держится полным. */
const HOLD_MS = 500;
/** Окно лимита — минута; ждём с запасом. */
const RECOVERY_MS = 90_000;
export const LIMIT_PROMPT = "Найди иконку корзины для интернет-магазина";

export interface LimitsReport {
  /** На каком вызове пришёл rate_limited. */
  trippedAt?: number;
  errorText?: string;
  verdicts: { trip: Verdict; assistant: Verdict; recovery: Verdict };
  answer: string;
}

const textOf = (result: unknown): string => {
  const content = (result as { content?: { type: string; text?: string }[] })
    .content;
  return (content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
};

async function matching(
  client: Client,
): Promise<{ limited: boolean; text: string }> {
  try {
    const result = await client.callTool({
      name: "get_matching_set",
      arguments: { concepts: ["home", "search"] },
    });
    const text = textOf(result);
    return {
      limited: result.isError === true && /rate_limited/.test(text),
      text,
    };
  } catch (e) {
    return { limited: false, text: (e as Error).message };
  }
}

/** Ассистент получил ошибку лимита и объяснил человеку, что подождать. */
export function assistantVerdict(t: Transcript): Verdict {
  const got = t.results.some((r) => r.isError && /rate_limited/.test(r.text));
  if (!got) return { ok: null, note: "ассистент не попал на лимит" };
  const text = t.texts.join("\n");
  return /подожд|минут|лимит|позже|limit|wait|minute|later/i.test(text)
    ? pass("получил rate_limited и объяснил, что подождать")
    : fail("получил rate_limited, но человеку не объяснил");
}

export async function checkLimits(o: {
  model: string;
  log?: (line: string) => void;
}): Promise<LimitsReport> {
  const client = new Client({ name: "iconavo-limits", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${MCP_ORIGIN}${MCP_PATH}`)),
  );
  const dir = join(tmpdir(), "iconavo-mcp-clients", `limits-${Date.now()}`);
  try {
    let trippedAt: number | undefined;
    let errorText: string | undefined;
    for (let i = 1; i <= MAX_CALLS; i++) {
      const r = await matching(client);
      if (r.limited) {
        trippedAt = i;
        errorText = r.text;
        break;
      }
      if (i % 20 === 0) o.log?.(`вызовов: ${i}, лимит ещё не сработал`);
    }
    const trip =
      trippedAt === undefined
        ? fail(`за ${MAX_CALLS} вызовов rate_limited не пришёл`)
        : /Wait about a minute/.test(errorText ?? "")
          ? pass(
              `rate_limited на ${trippedAt}-м вызове, с подсказкой подождать`,
            )
          : fail(
              `rate_limited на ${trippedAt}-м вызове, но без подсказки: ${errorText}`,
            );
    o.log?.(trip.note);
    let assistant: Verdict = {
      ok: null,
      note: "не проверялось: лимит не сработал",
    };
    let answer = "";
    let lastCall = Date.now();
    if (trippedAt !== undefined) {
      await mkdir(dir, { recursive: true });
      const mcpConfig = join(dir, "mcp.json");
      await writeFile(
        mcpConfig,
        JSON.stringify({
          mcpServers: {
            iconavo: { type: "http", url: `${MCP_ORIGIN}${MCP_PATH}` },
          },
        }),
        "utf8",
      );
      let holding = true;
      const hold = (async () => {
        while (holding) {
          await matching(client);
          lastCall = Date.now();
          await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
        }
      })();
      o.log?.(`Claude Code: «${LIMIT_PROMPT}» при полном счётчике…`);
      const t = await runClaude({
        cwd: dir,
        prompt: LIMIT_PROMPT,
        model: o.model,
        mcpConfig,
        timeoutMs: 5 * 60_000,
      });
      holding = false;
      await hold;
      assistant = assistantVerdict(t);
      answer = t.ends.at(-1)?.text ?? t.texts.at(-1) ?? "";
      o.log?.(assistant.note);
    }
    const wait = RECOVERY_MS - (Date.now() - lastCall);
    if (wait > 0) {
      o.log?.(`жду ${Math.ceil(wait / 1000)} с, пока счётчик опустеет…`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const after = await client
      .callTool({
        name: "search_icons",
        arguments: { query: "shopping cart", preview: false },
      })
      .catch((e: Error) => ({
        isError: true,
        content: [{ type: "text", text: e.message }],
      }));
    const recovery =
      after.isError === true
        ? fail(
            `после паузы поиск всё ещё с ошибкой: ${textOf(after).slice(0, 160)}`,
          )
        : pass("через полторы минуты поиск снова работает");
    o.log?.(recovery.note);
    return {
      ...(trippedAt === undefined ? {} : { trippedAt }),
      ...(errorText === undefined ? {} : { errorText }),
      verdicts: { trip, assistant, recovery },
      answer,
    };
  } finally {
    await client.close().catch(() => {});
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 500,
    }).catch(() => {});
  }
}
