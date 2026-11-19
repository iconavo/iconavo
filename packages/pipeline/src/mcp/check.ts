// Проверка живого MCP-сервера (ADR-0044, шаг 10 фазы 4): pnpm mcp check. Клиент — официальный SDK
// (@modelcontextprotocol/client), как у настоящих ассистентов, на обоих протоколах: 2025 года (запасной
// путь без состояния) и 2026-07-28. Ключи не нужны. Что проверяется:
// - HTTP: страница /, robots.txt, 405 на GET /mcp (потока событий нет), CORS, отказ пачке сообщений,
//   переход с http (только у живого адреса);
// - список инструментов: описание, схемы входа и ответа, «только чтение»;
// - вызовы search_icons: ответ по схеме (клиент SDK сверяет structuredContent со схемой сам),
//   поиск по смыслу, лицензия и автор у каждой иконки, одна PNG-картинка нужного размера.
// Каждый вызов попадает в отчёт целиком: запрос, текст, картинка и данные — их смотрит владелец.

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MCP_HOST, MCP_ORIGIN, MCP_PATH } from "./config.js";

export type Era = "2025" | "2026-07-28";
export const ERAS: readonly Era[] = ["2025", "2026-07-28"];

export interface McpImage {
  base64: string;
  bytes: number;
  width: number;
  height: number;
}

export interface McpCall {
  era: Era;
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  isError: boolean;
  text: string;
  structured?: unknown;
  images: McpImage[];
  problems: string[];
}

export interface McpCheckRow {
  name: string;
  problems: string[];
}

export interface McpCheckReport {
  base: string;
  build?: string;
  expectBuild?: string;
  rows: McpCheckRow[];
  calls: McpCall[];
}

export interface McpCheckOptions {
  base?: string;
  expectBuild?: string;
  log?: (line: string) => void;
  /** Сколько ждать новую сборку, мс; по умолчанию 3 минуты. */
  waitMs?: number;
  stepMs?: number;
}

const WAIT_MS = 180_000;
const STEP_MS = 15_000;
const TIMEOUT_MS = 60_000;

/** Вызовы search_icons и что должно получиться. */
interface Case {
  args: Record<string, unknown>;
  eras: readonly Era[];
  expect: (r: SearchOut, images: McpImage[]) => string[];
}

interface SearchOut {
  ranking: string;
  count: number;
  preview: boolean;
  results: {
    n: number;
    icon: string;
    set: string;
    style: string | null;
    exact?: boolean;
    license: string;
    author: string;
  }[];
  sets: {
    prefix: string;
    license: { spdx: string };
    author: { name: string };
  }[];
}

const size = (images: McpImage[], width: number, height: number) =>
  images.length !== 1
    ? [`картинок ${images.length} вместо одной`]
    : images[0]?.width !== width || images[0]?.height !== height
      ? [
          `картинка ${images[0]?.width}×${images[0]?.height} вместо ${width}×${height}`,
        ]
      : [];

export const CASES: readonly Case[] = [
  {
    args: { query: "корзина" },
    eras: ERAS,
    expect: (r, images) => [
      ...(r.ranking === "meaning"
        ? []
        : [`ranking ${r.ranking} вместо meaning`]),
      ...(r.count === 12 ? [] : [`иконок ${r.count} вместо 12`]),
      ...size(images, 384, 288),
    ],
  },
  {
    args: { query: "lucide:house", limit: 3 },
    eras: ERAS,
    expect: (r, images) => [
      ...(r.results[0]?.icon === "lucide:house" && r.results[0]?.exact === true
        ? []
        : [`первой не lucide:house с пометкой exact: ${r.results[0]?.icon}`]),
      ...size(images, 384, 96),
    ],
  },
  {
    args: { query: "settings", limit: 24, style: "outline" },
    eras: ["2025"],
    expect: (r, images) => [
      ...(r.count === 24 ? [] : [`иконок ${r.count} вместо 24`]),
      ...(r.results.every((x) => x.style === "outline")
        ? []
        : ["не все иконки в стиле outline"]),
      ...size(images, 576, 384),
    ],
  },
  {
    args: { query: "heart", sets: ["fluent-emoji-flat"], preview: false },
    eras: ["2025"],
    expect: (r, images) => [
      ...(r.results.length > 0 &&
      r.results.every((x) => x.set === "fluent-emoji-flat")
        ? []
        : ["не только fluent-emoji-flat"]),
      ...(images.length === 0 && !r.preview ? [] : ["картинка без просьбы"]),
    ],
  },
];

/** Размер PNG из заголовка IHDR; не PNG — undefined. */
export function pngSize(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Лицензия и автор у каждой иконки и у каждого набора выдачи (ADR-0011). */
export function licenseProblems(r: SearchOut): string[] {
  const problems: string[] = [];
  const sets = new Map(r.sets.map((s) => [s.prefix, s]));
  for (const x of r.results) {
    if (x.license === "" || x.author === "") {
      problems.push(`у ${x.icon} нет лицензии или автора`);
    }
    const set = sets.get(x.set);
    if (!set || set.license.spdx === "" || set.author.name === "") {
      problems.push(`нет сведений о наборе ${x.set}`);
    }
  }
  return problems;
}

async function get(
  url: string,
  init: RequestInit = {},
): Promise<Response | Error> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return e as Error;
  }
}

async function waitForBuild(
  base: string,
  expect: string,
  o: McpCheckOptions,
): Promise<string | undefined> {
  const deadline = Date.now() + (o.waitMs ?? WAIT_MS);
  let seen: string | undefined;
  for (;;) {
    const res = await get(`${base}/`);
    seen =
      res instanceof Response
        ? (res.headers.get("x-iconavo-build") ?? undefined)
        : undefined;
    if (seen === expect || Date.now() >= deadline) return seen;
    o.log?.(`жду сборку ${expect}, отвечает ${seen ?? "—"}…`);
    await new Promise((resolve) => setTimeout(resolve, o.stepMs ?? STEP_MS));
  }
}

async function httpRows(base: string): Promise<McpCheckRow[]> {
  const rows: McpCheckRow[] = [];
  const row = (name: string, problems: string[]) =>
    rows.push({ name, problems });
  const fail = (e: Error) => [`нет ответа: ${e.message}`];

  const home = await get(`${base}/`);
  if (home instanceof Error) row("Страница /", fail(home));
  else {
    const text = await home.text();
    row("Страница /", [
      ...(home.status === 200 ? [] : [`код ${home.status}`]),
      ...(home.headers.get("content-type") === "text/plain; charset=utf-8"
        ? []
        : [`Content-Type ${home.headers.get("content-type")}`]),
      ...(home.headers.get("x-content-type-options") === "nosniff"
        ? []
        : ["нет nosniff"]),
      ...(/^[0-9a-f]{8}$/.test(home.headers.get("x-iconavo-build") ?? "")
        ? []
        : ["нет метки сборки X-Iconavo-Build"]),
      ...(text.includes(`${MCP_ORIGIN}${MCP_PATH}`)
        ? []
        : ["нет адреса подключения"]),
    ]);
  }

  const robots = await get(`${base}/robots.txt`);
  row(
    "robots.txt",
    robots instanceof Error
      ? fail(robots)
      : (await robots.text()).includes("Disallow: /")
        ? []
        : ["обход не закрыт"],
  );

  const stream = await get(`${base}${MCP_PATH}`, {
    headers: { accept: "text/event-stream" },
  });
  row(
    "GET /mcp — 405",
    stream instanceof Error
      ? fail(stream)
      : stream.status === 405
        ? []
        : [`код ${stream.status}: у сервера без состояния потока событий нет`],
  );

  const preflight = await get(`${base}${MCP_PATH}`, { method: "OPTIONS" });
  row(
    "CORS",
    preflight instanceof Error
      ? fail(preflight)
      : [
          ...(preflight.status === 204 ? [] : [`код ${preflight.status}`]),
          ...(preflight.headers.get("access-control-allow-origin") === "*"
            ? []
            : ["нет Access-Control-Allow-Origin: *"]),
        ],
  );

  const batch = await get(`${base}${MCP_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]),
  });
  if (batch instanceof Error) row("Пачка сообщений — 400", fail(batch));
  else {
    const body = (await batch.json().catch(() => ({}))) as {
      error?: { code?: number };
    };
    row("Пачка сообщений — 400", [
      ...(batch.status === 400 ? [] : [`код ${batch.status}`]),
      ...(body.error?.code === -32600 ? [] : ["нет ошибки JSON-RPC -32600"]),
    ]);
  }

  if (base === MCP_ORIGIN) {
    const http = await get(`http://${MCP_HOST}/`, { redirect: "manual" });
    row(
      "Переход с http",
      http instanceof Error
        ? fail(http)
        : [301, 308].includes(http.status) &&
            http.headers.get("location") === `${MCP_ORIGIN}/`
          ? []
          : [`код ${http.status}, Location ${http.headers.get("location")}`],
    );
  }
  return rows;
}

async function eraChecks(
  base: string,
  era: Era,
  log?: (line: string) => void,
): Promise<{ rows: McpCheckRow[]; calls: McpCall[] }> {
  const rows: McpCheckRow[] = [];
  const calls: McpCall[] = [];
  const client = new Client(
    { name: "iconavo-check", version: "1" },
    era === "2025"
      ? {}
      : { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}${MCP_PATH}`)),
    );
  } catch (e) {
    rows.push({
      name: `Протокол ${era}: подключение`,
      problems: [(e as Error).message],
    });
    return { rows, calls };
  }
  try {
    const tools = await client.listTools();
    const search = tools.tools.find((t) => t.name === "search_icons");
    rows.push({
      name: `Протокол ${era}: список инструментов`,
      problems:
        search === undefined
          ? ["нет search_icons"]
          : [
              ...((search.description ?? "").length > 100
                ? []
                : ["короткое описание"]),
              ...(search.outputSchema ? [] : ["нет схемы ответа"]),
              ...(search.annotations?.readOnlyHint === true
                ? []
                : ["не помечен «только чтение»"]),
            ],
    });
    for (const c of CASES.filter((x) => x.eras.includes(era))) {
      log?.(`${era}: search_icons ${JSON.stringify(c.args)}`);
      const started = performance.now();
      const call: McpCall = {
        era,
        tool: "search_icons",
        args: c.args,
        ms: 0,
        isError: false,
        text: "",
        images: [],
        problems: [],
      };
      try {
        const result = await client.callTool({
          name: "search_icons",
          arguments: c.args,
        });
        call.ms = Math.round(performance.now() - started);
        call.isError = result.isError === true;
        const content = (result.content ?? []) as {
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
        }[];
        call.text = content
          .filter((x) => x.type === "text")
          .map((x) => x.text ?? "")
          .join("\n");
        for (const block of content.filter((x) => x.type === "image")) {
          const bytes = Buffer.from(block.data ?? "", "base64");
          const dims = pngSize(bytes);
          if (block.mimeType !== "image/png" || dims === undefined) {
            call.problems.push(`картинка не PNG (${block.mimeType})`);
            continue;
          }
          call.images.push({
            base64: block.data ?? "",
            bytes: bytes.length,
            ...dims,
          });
        }
        call.structured = result.structuredContent;
        if (call.isError) {
          call.problems.push(`ошибка инструмента: ${call.text}`);
        } else {
          const out = result.structuredContent as unknown as SearchOut;
          call.problems.push(
            ...c.expect(out, call.images),
            ...licenseProblems(out),
            ...(call.text.includes("Licenses")
              ? []
              : ["в тексте нет лицензий"]),
          );
        }
      } catch (e) {
        call.ms = Math.round(performance.now() - started);
        call.problems.push((e as Error).message);
      }
      calls.push(call);
    }
  } finally {
    await client.close().catch(() => {});
  }
  return { rows, calls };
}

export async function checkMcp(
  o: McpCheckOptions = {},
): Promise<McpCheckReport> {
  const base = o.base ?? MCP_ORIGIN;
  const build =
    o.expectBuild === undefined
      ? undefined
      : await waitForBuild(base, o.expectBuild, o);
  const rows: McpCheckRow[] = [];
  if (o.expectBuild !== undefined) {
    rows.push({
      name: "Сборка",
      problems:
        build === o.expectBuild
          ? []
          : [
              `отвечает ${build ?? "—"} вместо ${o.expectBuild}: «MCP-сервер» ещё не выложил её`,
            ],
    });
  }
  rows.push(...(await httpRows(base)));
  const calls: McpCall[] = [];
  for (const era of ERAS) {
    const r = await eraChecks(base, era, o.log);
    rows.push(...r.rows);
    calls.push(...r.calls);
  }
  return {
    base,
    ...(build === undefined ? {} : { build }),
    ...(o.expectBuild === undefined ? {} : { expectBuild: o.expectBuild }),
    rows,
    calls,
  };
}

export const mcpCheckFailed = (r: McpCheckReport) =>
  r.rows.some((x) => x.problems.length > 0) ||
  r.calls.some((c) => c.problems.length > 0);
