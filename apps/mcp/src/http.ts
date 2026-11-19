// HTTP-обвязка MCP-сервера (ADR-0044): адрес протокола /mcp, короткая страница на / для людей, CORS
// для клиентов в браузере. Сервер MCP и обработчик SDK собираются на каждый запрос: между запросами
// у функции нет общих обещаний (ADR-0024, 18 ноября 2026) — общие у копии только загрузчики API с
// готовыми значениями.
// Один запрос — одно сообщение JSON-RPC: пачка из многих вызовов съела бы процессор и обращения
// к хранилищам за несколько запросов сразу, поэтому пачки отклоняются, как и тело больше 64 КБ.

import { createMcpHandler } from "@modelcontextprotocol/server";
import { MAX_BODY_BYTES, MCP_PATH, SITE_URL } from "./config.js";
import type { McpDeps } from "./context.js";
import { createServer } from "./server.js";

const EXPOSED = "mcp-session-id, mcp-protocol-version, x-iconavo-build";

const HOME = [
  "Iconavo MCP server: open-source icons for AI assistants, with search by meaning in any language.",
  "",
  "Connect your assistant to https://mcp.iconavo.dev/mcp (Streamable HTTP, no key needed).",
  "Claude Code: claude mcp add --transport http iconavo https://mcp.iconavo.dev/mcp",
  "",
  "Documentation: https://github.com/iconavo/iconavo/tree/main/apps/mcp",
  `Icons: ${SITE_URL}`,
  "",
].join("\n");

function textResponse(
  status: number,
  body: string,
  build: string,
  head: boolean,
  extra: Record<string, string> = {},
): Response {
  return new Response(head ? null : body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-iconavo-build": build,
      ...extra,
    },
  });
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  build: string,
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }),
    {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": EXPOSED,
        "x-content-type-options": "nosniff",
        "x-iconavo-build": build,
      },
    },
  );
}

/** Ответ SDK с нашими заголовками: CORS, метка сборки, без кэша. */
function withHeaders(response: Response, build: string): Response {
  const out = new Response(response.body, response);
  out.headers.set("access-control-allow-origin", "*");
  out.headers.set("access-control-expose-headers", EXPOSED);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("x-iconavo-build", build);
  if (!out.headers.has("cache-control")) {
    out.headers.set("cache-control", "no-store");
  }
  return out;
}

export async function serve(
  request: Request,
  deps: McpDeps,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const url = new URL(request.url);
  const head = request.method === "HEAD";
  if (url.pathname === "/" || url.pathname === "/robots.txt") {
    if (request.method !== "GET" && !head) {
      return textResponse(405, "Method not allowed\n", deps.build, head, {
        allow: "GET, HEAD",
      });
    }
    return url.pathname === "/"
      ? textResponse(200, HOME, deps.build, head)
      : textResponse(200, "User-agent: *\nDisallow: /\n", deps.build, head);
  }
  if (url.pathname !== MCP_PATH) {
    return textResponse(404, `Not found: use ${MCP_PATH}\n`, deps.build, head);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "*, authorization",
        "access-control-max-age": "86400",
        "x-iconavo-build": deps.build,
      },
    });
  }
  // Тело читается здесь и с пределом по мере чтения: без заголовка длины огромное тело не попадёт
  // в память целиком. SDK получает уже прочитанные байты новым запросом, без копии потока.
  let forward = request;
  let parsedBody: unknown;
  if (request.method === "POST") {
    const bytes = await readLimited(request, MAX_BODY_BYTES);
    if (bytes === undefined) {
      return jsonRpcError(
        413,
        -32600,
        `Request body is larger than ${MAX_BODY_BYTES} bytes`,
        deps.build,
      );
    }
    try {
      parsedBody = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // Не JSON — пусть ответит SDK: у него для этого свой код ошибки.
    }
    if (Array.isArray(parsedBody)) {
      return jsonRpcError(
        400,
        -32600,
        "JSON-RPC batches are not supported: send one message per request",
        deps.build,
      );
    }
    forward = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: bytes,
      signal: request.signal,
    });
  }
  const handler = createMcpHandler(
    () => createServer(deps, { request, waitUntil }),
    {
      legacy: "stateless",
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (e) => deps.log(`MCP: ${e.message.slice(0, 300)}`),
    },
  );
  const response = await handler.fetch(
    forward,
    parsedBody === undefined ? undefined : { parsedBody },
  );
  return withHeaders(response, deps.build);
}

/** Тело запроса не длиннее max байт; длиннее — undefined (чтение прерывается сразу). */
async function readLimited(
  request: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (Number(request.headers.get("content-length") ?? "0") > max) {
    return undefined;
  }
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}
