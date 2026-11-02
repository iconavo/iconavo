// Локальный Meilisearch для проверки сайта (шаг 3 фазы 4): pnpm site --check идёт без интернета, а
// превью API без Meilisearch отвечает на /search 503. Здесь — настоящие документы индекса из data/
// (loadSearchDocuments) и поиск по словам по вхождению (matchDocs), без смысла: превью ходит сюда без
// ключа Polza, и его ответы предсказуемы — semantic: "text". Сервер слушает только 127.0.0.1 и сверяет
// Host; понимает ровно POST /multi-search и похожие документы /indexes/icons/similar (адрес /icon,
// шаг 4 фазы 4) с ключом.

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

/**
 * Похожие документы без векторов (шаг 4 фазы 4): соседи по общим словам имени, тегов и синонимов, при
 * равенстве — по месту набора и имени. Как у настоящего: самого документа в ответе нет; документа нет
 * — 404; без вектора (нет описаний, textHash: null) — 400.
 */
export function localSimilar(
  docs: readonly SearchDocument[],
  body: Record<string, unknown>,
): { status: number; body: unknown } {
  const source = docs.find((d) => d.id === body.id);
  if (source === undefined) return { status: 404, body: { message: "id" } };
  if (source.textHash === null) {
    return { status: 400, body: { message: "no vector" } };
  }
  const words = (d: SearchDocument) =>
    new Set(
      [...d.name, ...d.tags, ...d.synonymsEn, ...d.synonymsRu].flatMap((p) =>
        p.split(" "),
      ),
    );
  const mine = words(source);
  const score = (d: SearchDocument) =>
    [...words(d)].filter((w) => mine.has(w)).length;
  const limit = Number(body.limit ?? 20);
  const fields = Array.isArray(body.attributesToRetrieve)
    ? (body.attributesToRetrieve as string[])
    : ["icon"];
  const hits = docs
    .filter((d) => d !== source)
    .map((d) => ({ d, s: score(d) }))
    .sort(
      (a, b) =>
        b.s - a.s ||
        a.d.setOrder - b.d.setOrder ||
        (a.d.icon < b.d.icon ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ d }) => {
      const doc = d as unknown as Record<string, unknown>;
      return Object.fromEntries(
        fields.filter((f) => f in doc).map((f) => [f, doc[f]] as const),
      );
    });
  return { status: 200, body: { hits, id: source.id } };
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
    const similar = req.url === "/indexes/icons/similar";
    if (req.method !== "POST" || (req.url !== "/multi-search" && !similar)) {
      return reply(404, { message: "not found" });
    }
    if (req.headers.authorization !== `Bearer ${key}`) {
      return reply(401, { message: "key" });
    }
    try {
      if (similar) {
        local.calls++;
        const answer = localSimilar(docs, JSON.parse(await bodyOf(req)));
        return reply(answer.status, answer.body);
      }
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
