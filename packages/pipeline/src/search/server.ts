// Сервер страницы поиска (шаг 12, ADR-0048): только 127.0.0.1, только GET. Заголовок Host
// сверяется с адресом сервера: иначе чужой сайт мог бы через браузер (DNS rebinding) слать запросы
// и тратить деньги Polza на векторы. Отчёты из .cache/reports отдаются по /reports/… — браузерное
// расширение Claude не открывает file://. Колонка «Сервис» (ADR-0049) — ответ Meilisearch теми же
// запросами, что у функции edge API: появляется, когда в .env есть ключи поискового сервиса.

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import {
  exactName,
  exactQuery,
  mainQuery,
  normalizeText,
  pageResults,
  parseMultiSearch,
  SEARCH_MODEL,
  SEMANTIC_RATIO,
  stripSetPrefix,
  truncateUnit,
} from "@iconavo-ui/search";
import type { EmbeddingClient } from "../embed/client.js";
import type { MeiliClient } from "../meili/client.js";
import { searchEmbeddingModel } from "../meili/embed.js";
import { esc, htmlPage } from "../report/html.js";
import type { Catalog } from "./catalog.js";
import { type ModelSearch, PAGE_RESULTS } from "./config.js";
import { type Mode, prepare, rankPrepared, textQuery } from "./hybrid.js";
import { type Column, MODE_NAMES, renderSearchPage } from "./page.js";
import { queryVectors } from "./query-vectors.js";
import { searchText, type TextIndex } from "./text.js";
import { cosines, type ModelVectors } from "./vectors.js";

export interface SearchContext {
  port: number;
  catalog: Catalog;
  text: TextIndex;
  models: readonly ModelVectors[];
  settings: Readonly<Record<string, ModelSearch>>;
  /** Клиент Polza для векторов запросов; нет ключа — только текстовая часть. */
  client?: EmbeddingClient;
  /** Кэш векторов запросов и папка отчётов. */
  queryDir: string;
  reportsDir: string;
  /** Поисковый сервис (ADR-0049); нет ключей — колонки «Сервис» нет. */
  service?: MeiliClient;
}

export interface Reply {
  status: number;
  type: string;
  body: string | Uint8Array;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
};

const MAX_QUERY = 200;

const text = (status: number, message: string): Reply => ({
  status,
  type: "text/html; charset=utf-8",
  body: htmlPage(message, "", `<p>${esc(message)}</p>`),
});

/** Хост запроса — адрес этого сервера: 127.0.0.1 или localhost с тем же портом. */
export const allowedHost = (host: string | undefined, port: number) =>
  host === `127.0.0.1:${port}` || host === `localhost:${port}`;

/** Файл отчёта внутри reportsDir; путь за её пределы — нет. */
async function reportFile(dir: string, path: string): Promise<Reply> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return text(400, "Неверный адрес");
  }
  const file = normalize(join(dir, decoded));
  const rel = relative(dir, file);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return text(404, "Нет такого отчёта");
  }
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) return text(404, "Нет такого отчёта");
  try {
    return { status: 200, type, body: await readFile(file) };
  } catch {
    return text(
      404,
      "Нет такого отчёта — сначала запустите команду, которая его пишет",
    );
  }
}

const formatMs = (ms: number) =>
  ms < 1000
    ? `${Math.round(ms)} мс`
    : `${(ms / 1000).toFixed(1).replace(".", ",")} с`;

/**
 * Колонка «Сервис»: Meilisearch теми же запросами, что строит функция edge API. Вектор — Gemini от
 * нормализованного текста, первые 1024 числа; без вектора — только слова, как ответ «сначала текст».
 */
async function serviceColumn(
  ctx: SearchContext,
  client: MeiliClient,
  query: string,
  mode: Mode,
  set: string | undefined,
): Promise<Column> {
  const started = performance.now();
  const isSet = (id: string) => ctx.catalog.sets.some((s) => s.id === id);
  const q = normalizeText(stripSetPrefix(query, isSet));
  const notes: string[] = [];
  let vector: Float32Array | undefined;
  if (mode !== "text") {
    const qv = await queryVectors(searchEmbeddingModel(), [q], {
      dir: ctx.queryDir,
      ...(ctx.client ? { client: ctx.client } : {}),
    });
    const full = qv.vectors[0];
    if (full) vector = truncateUnit(full, SEARCH_MODEL.dims);
    else notes.push(`нет вектора запроса: ${qv.error ?? "?"} — только слова`);
  }
  const ratio = mode === "vector" ? 1 : SEMANTIC_RATIO;
  const filters = set === undefined ? {} : { sets: [set] };
  const name = exactName(query);
  const body = [
    ...(name === undefined ? [] : [exactQuery(name, filters)]),
    mainQuery({
      q,
      filters,
      ...(name === undefined ? {} : { exclude: name }),
      start: 0,
      limit: PAGE_RESULTS,
      ...(vector ? { vector, semanticRatio: ratio } : {}),
    }),
  ];
  const lists = parseMultiSearch(await client.multiSearch(body), body.length);
  const exact = name === undefined ? [] : (lists[0] ?? []);
  const main = lists[lists.length - 1] ?? [];
  const results = pageResults(exact, main, 0, PAGE_RESULTS).flatMap((r) => {
    const doc = ctx.catalog.byId.get(r.icon);
    return doc === undefined
      ? []
      : [{ doc, score: 0, exact: r.exact === true, text: 0 }];
  });
  return {
    title: "Сервис",
    subtitle: `Meilisearch · ${vector ? `доля смысла ${ratio.toFixed(1).replace(".", ",")}` : "только слова"} · ${formatMs(performance.now() - started)}`,
    notes,
    results,
  };
}

/** Ответ страницы поиска на запрос: колонка текста и колонка каждой модели. */
export async function searchReply(
  ctx: SearchContext,
  params: URLSearchParams,
): Promise<Reply> {
  const query = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);
  const setParam = params.get("set") ?? "";
  const set = ctx.catalog.sets.some((s) => s.id === setParam)
    ? setParam
    : undefined;
  const modeParam = params.get("mode") ?? "hybrid";
  const mode: Mode = modeParam in MODE_NAMES ? (modeParam as Mode) : "hybrid";
  const base = {
    query,
    mode,
    sets: ctx.catalog.sets,
    ...(set === undefined ? {} : { set }),
  };
  if (query === "") {
    return {
      status: 200,
      type: TYPES[".html"] as string,
      body: renderSearchPage(ctx.catalog, {
        ...base,
        words: [],
        columns: [],
        notes: [],
      }),
    };
  }
  const found = searchText(ctx.text, textQuery(ctx.catalog, query));
  const columns: Column[] = [];
  const notes: string[] = [];
  columns.push({
    title: "Текст",
    subtitle: "имена, теги, синонимы; точное имя — первым",
    results: rankPrepared(
      prepare(ctx.catalog, query, found, undefined, set),
      "text",
      0,
      PAGE_RESULTS,
    ),
  });
  if (mode !== "text") {
    const perModel = await Promise.all(
      ctx.models.map(async (mv) => {
        const started = performance.now();
        const qv = await queryVectors(mv.model, [query], {
          dir: ctx.queryDir,
          ...(ctx.client ? { client: ctx.client } : {}),
        });
        return { mv, qv, ms: performance.now() - started };
      }),
    );
    for (const { mv, qv, ms } of perModel) {
      const settings = ctx.settings[mv.model.key] ?? {
        alpha: 0.5,
        length: mv.model.dims,
      };
      const vector = qv.vectors[0];
      const k = Math.max(0, mv.lengths.indexOf(settings.length));
      const cos = vector ? cosines(mv, vector)[k] : undefined;
      const columnNotes = [...mv.notes];
      if (!vector) {
        columnNotes.push(
          `нет вектора запроса: ${qv.error ?? "?"} — показан только текст`,
        );
      }
      const length = mv.lengths[k] ?? mv.model.dims;
      columns.push({
        title: mv.model.key,
        subtitle: `${MODE_NAMES[mode].toLowerCase()} · доля смысла ${settings.alpha.toFixed(1).replace(".", ",")} · длина ${length} · ${qv.cached > 0 ? "вектор из кэша" : `вектор за ${formatMs(ms)}`}`,
        notes: columnNotes,
        results: rankPrepared(
          prepare(ctx.catalog, query, found, cos, set),
          mode,
          settings.alpha,
          PAGE_RESULTS,
        ),
      });
    }
    if (!ctx.client) {
      notes.push(
        "Нет ключа POLZA_API_KEY: векторы новых запросов не считаются, в колонках моделей — только текстовая часть (ADR-0027).",
      );
    }
  }
  if (ctx.service) {
    try {
      columns.push(await serviceColumn(ctx, ctx.service, query, mode, set));
    } catch (e) {
      notes.push(`Сервис не ответил: ${(e as Error).message}`);
    }
  }
  return {
    status: 200,
    type: TYPES[".html"] as string,
    body: renderSearchPage(ctx.catalog, {
      ...base,
      words: found.words,
      columns,
      notes,
      matches: found.matches,
    }),
  };
}

/** Ответ на запрос браузера: метод, адрес и заголовок Host. */
export async function reply(
  ctx: SearchContext,
  method: string | undefined,
  url: string | undefined,
  host: string | undefined,
): Promise<Reply> {
  if (!allowedHost(host, ctx.port)) {
    return text(403, "Страница открывается только по адресу 127.0.0.1");
  }
  if (method !== "GET" && method !== "HEAD") {
    return text(405, "Только GET");
  }
  const parsed = new URL(url ?? "/", `http://127.0.0.1:${ctx.port}`);
  if (parsed.pathname === "/") return searchReply(ctx, parsed.searchParams);
  if (parsed.pathname.startsWith("/reports/")) {
    return reportFile(
      ctx.reportsDir,
      parsed.pathname.slice("/reports/".length),
    );
  }
  return text(404, "Нет такой страницы");
}

/** Запускает сервер на 127.0.0.1:port; останавливается вместе с процессом (Ctrl+C). */
export function startSearchServer(
  ctx: SearchContext,
  log: (line: string) => void = () => {},
): Promise<Server> {
  const server = createServer((req, res) => {
    reply(ctx, req.method, req.url, req.headers.host)
      .catch((e: Error): Reply => text(500, `Ошибка: ${e.message}`))
      .then((r) => {
        res.writeHead(r.status, {
          "content-type": r.type,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : r.body);
        log(`${req.method} ${req.url} → ${r.status}`);
      });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(ctx.port, "127.0.0.1", () => resolve(server));
  });
}
