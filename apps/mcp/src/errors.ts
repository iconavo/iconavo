// Ошибки инструментов (ADR-0044): те же коды, что у edge API (toApiError), но в виде ответа с isError —
// ассистент читает текст и объясняет человеку, что случилось. Тексты — по-английски, с подсказкой,
// что делать дальше.

import type { CallToolResult } from "@modelcontextprotocol/server";
import { toApiError } from "../../api/src/handler.js";

const HINTS: Readonly<Record<string, string>> = {
  rate_limited: "Wait about a minute and try again.",
  invalid_prefix: "Call list_sets to see the available set prefixes.",
  search_unavailable: "Try again in half a minute.",
  storage_unavailable: "Try again in half a minute.",
};

export function toolError(
  e: unknown,
  log: (message: string) => void,
): CallToolResult {
  const { error } = toApiError(e, log);
  const hint = HINTS[error.code];
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `${error.message}${hint === undefined ? "" : `. ${hint}`} (error ${error.code})`,
      },
    ],
  };
}
