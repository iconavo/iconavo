// Замер MCP-сервера (шаг 10 фазы 4): pnpm mcp bench. Серия поисков search_icons клиентом SDK — две
// половины запросов контрольной части эталона: первая с картинкой-сеткой, вторая без неё. Время
// процессора функция сама не видит (часы в Workers стоят во время вычислений), поэтому замер печатает
// окна времени в UTC: процессор за каждое окно смотрится в панели Cloudflare (Workers & Pages →
// iconavo-mcp → Metrics → CPU Time). Сам замер — время ответа и ошибки. Темп — не больше 50 вызовов в
// минуту: лимит частоты поиска — 60 с адреса.

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MCP_ORIGIN, MCP_PATH } from "./config.js";

export interface McpBenchPass {
  preview: boolean;
  startedAt: string;
  endedAt: string;
  calls: number;
  errors: string[];
  p50: number;
  p95: number;
  imageBytes: number[];
}

export interface McpBenchReport {
  base: string;
  passes: McpBenchPass[];
}

export interface McpBenchOptions {
  base?: string;
  queries: readonly string[];
  log?: (line: string) => void;
  /** Пауза между вызовами, мс; по умолчанию 1,2 с — 50 в минуту. */
  pauseMs?: number;
}

const quantile = (sorted: number[], q: number) =>
  sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);

async function pass(
  client: Client,
  queries: readonly string[],
  preview: boolean,
  o: McpBenchOptions,
): Promise<McpBenchPass> {
  const startedAt = new Date().toISOString();
  const times: number[] = [];
  const errors: string[] = [];
  const imageBytes: number[] = [];
  for (const [i, query] of queries.entries()) {
    const started = performance.now();
    try {
      const result = await client.callTool({
        name: "search_icons",
        arguments: { query, preview },
      });
      times.push(performance.now() - started);
      if (result.isError === true) {
        errors.push(
          `${query}: ${JSON.stringify(result.content).slice(0, 200)}`,
        );
      }
      for (const block of (result.content ?? []) as {
        type: string;
        data?: string;
      }[]) {
        if (block.type === "image") {
          imageBytes.push(Buffer.from(block.data ?? "", "base64").length);
        }
      }
    } catch (e) {
      times.push(performance.now() - started);
      errors.push(`${query}: ${(e as Error).message}`);
    }
    if ((i + 1) % 10 === 0) {
      o.log?.(
        `${preview ? "с картинкой" : "без картинки"}: ${i + 1} из ${queries.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, o.pauseMs ?? 1200));
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    preview,
    startedAt,
    endedAt: new Date().toISOString(),
    calls: queries.length,
    errors,
    p50: Math.round(quantile(sorted, 0.5)),
    p95: Math.round(quantile(sorted, 0.95)),
    imageBytes,
  };
}

export async function benchMcp(o: McpBenchOptions): Promise<McpBenchReport> {
  const base = o.base ?? MCP_ORIGIN;
  const client = new Client({ name: "iconavo-bench", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}${MCP_PATH}`)),
  );
  try {
    const half = Math.ceil(o.queries.length / 2);
    const withImage = await pass(client, o.queries.slice(0, half), true, o);
    const without = await pass(client, o.queries.slice(half), false, o);
    return { base, passes: [withImage, without] };
  } finally {
    await client.close().catch(() => {});
  }
}

export function formatMcpBench(r: McpBenchReport): string[] {
  const lines = [`Замер MCP-сервера ${r.base}:`];
  for (const p of r.passes) {
    const kb =
      p.imageBytes.length === 0
        ? ""
        : `, картинка в среднем ${Math.round(p.imageBytes.reduce((a, b) => a + b, 0) / p.imageBytes.length / 1024)} КБ`;
    lines.push(
      `  ${p.preview ? "с картинкой " : "без картинки"}: ${p.calls} вызовов, ответ P50 ${p.p50} мс, P95 ${p.p95} мс, ошибок ${p.errors.length}${kb}`,
      `    окно для панели Cloudflare (UTC): ${p.startedAt} — ${p.endedAt}`,
    );
    for (const e of p.errors.slice(0, 5)) lines.push(`    ${e}`);
  }
  lines.push(
    "Процессор: Workers & Pages → iconavo-mcp → Metrics → CPU Time за эти окна (P50, P99).",
  );
  return lines;
}
