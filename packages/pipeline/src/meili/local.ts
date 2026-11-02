// Локальный Meilisearch для проверки сайта (шаг 3 фазы 4): pnpm site --check идёт без интернета, а
// превью API без Meilisearch отвечает на /search 503. Здесь — настоящие документы индекса из data/
// (loadSearchDocuments) и поиск по словам по вхождению (matchDocs), без смысла: превью ходит сюда без
// ключа Polza, и его ответы предсказуемы — semantic: "text". Сервер слушает только 127.0.0.1 и сверяет
// Host; понимает ровно POST /multi-search с ключом.

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { SearchDocument } from "@iconavo-ui/search";
import { allowedHost } from "../search/server.js";
import { matchDocs } from "./match.js";

export interface LocalMeili {
  url: string;
  key: string;
  /** Запросы multi-search — для отчёта и тестов. */
  calls: number;
  close(): Promise<void>;
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Ответ одного запроса multi-search: только поля attributesToRetrieve, окно offset/limit. */
export function localSearch(
  docs: readonly SearchDocument[],
  query: Record<string, unknown>,
): { hits: Record<string, unknown>[] } {
  const filter = Array.isArray(query.filter) ? (query.filter as string[]) : [];
  const found = matchDocs(
    docs as unknown as Record<string, unknown>[],
    String(query.q ?? ""),
    filter,
  );
  const offset = Number(query.offset ?? 0);
  const limit = Number(query.limit ?? 20);
  const fields = Array.isArray(query.attributesToRetrieve)
    ? (query.attributesToRetrieve as string[])
    : ["icon"];
  return {
    hits: found
      .slice(offset, offset + limit)
      .map((d) =>
        Object.fromEntries(
          fields.filter((f) => f in d).map((f) => [f, d[f]] as const),
        ),
      ),
  };
}

export async function startLocalMeili(
  docs: readonly SearchDocument[],
): Promise<LocalMeili> {
  const key = randomBytes(12).toString("hex");
  let port = 0;
  const local: LocalMeili = {
    url: "",
    key,
    calls: 0,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  const server = createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!allowedHost(req.headers.host, port)) {
      return reply(403, { message: "host" });
    }
    if (req.method !== "POST" || req.url !== "/multi-search") {
      return reply(404, { message: "not found" });
    }
    if (req.headers.authorization !== `Bearer ${key}`) {
      return reply(401, { message: "key" });
    }
    try {
      const body = JSON.parse(await bodyOf(req)) as { queries?: unknown };
      if (!Array.isArray(body.queries)) {
        return reply(400, { message: "queries" });
      }
      local.calls++;
      reply(200, {
        results: (body.queries as Record<string, unknown>[]).map((q) =>
          localSearch(docs, q),
        ),
      });
    } catch (e) {
      reply(400, { message: (e as Error).message });
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  port = typeof address === "object" && address !== null ? address.port : 0;
  local.url = `http://127.0.0.1:${port}`;
  return local;
}
