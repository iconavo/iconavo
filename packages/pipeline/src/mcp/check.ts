// Проверка живого MCP-сервера (ADR-0044, шаг 10 фазы 4): pnpm mcp check. Клиент — официальный SDK
// (@modelcontextprotocol/client), как у настоящих ассистентов, на обоих протоколах: 2025 года (запасной
// путь без состояния) и 2026-07-28. Ключи не нужны. Что проверяется:
// - HTTP: страница /, robots.txt, 405 на GET /mcp (потока событий нет), CORS, отказ пачке сообщений,
//   переход с http (только у живого адреса);
// - список инструментов: шесть инструментов ADR-0011 и ADR-0045, описание, схемы входа и ответа,
//   «только чтение»;
// - вызовы всех пяти: ответ по схеме (клиент SDK сверяет structuredContent со схемой сам); search_icons —
//   поиск по смыслу и одна PNG-картинка нужного размера; get_icon — код как у генератора сайта, SVG
//   побайтно как у адреса SVG edge API; get_matching_set — like: ph:house-bold даёт только ph:*-bold;
//   get_usage — строки README; list_sets — пять наборов; pick_icon — данные сетки в _meta. Лицензия и
//   автор — в каждом ответе;
// - сетка выбора (MCP Apps, ADR-0045): адрес интерфейса у pick_icon, шаблон и чтение ресурса, версия —
//   отпечаток страницы, код выбора в сетке — как у get_icon.
// Каждый вызов попадает в отчёт целиком: запрос, текст, картинка и данные — их смотрит владелец.

import { createHash } from "node:crypto";
import {
  PICKER_META_KEY,
  parsePickerPayload,
  pickerChoice,
} from "@iconavo-ui/snippets/picker";
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

/** Инструменты ADR-0011 и сетка выбора ADR-0045 — в списке ровно они, в этом порядке. */
export const TOOLS = [
  "search_icons",
  "get_icon",
  "get_matching_set",
  "get_usage",
  "list_sets",
  "pick_icon",
] as const;

// biome-ignore lint/suspicious/noExplicitAny: данные ответа сверяются по полям, схему уже проверил клиент SDK
type Json = any;

/** Вызов инструмента и что должно получиться; out — данные по схеме, meta — служебная часть ответа. */
interface Case {
  tool: (typeof TOOLS)[number];
  args: Record<string, unknown>;
  eras: readonly Era[];
  expect: (
    out: Json,
    images: McpImage[],
    text: string,
    meta: Json,
  ) => string[] | Promise<string[]>;
}

const size = (images: McpImage[], width: number, height: number) =>
  images.length !== 1
    ? [`картинок ${images.length} вместо одной`]
    : images[0]?.width !== width || images[0]?.height !== height
      ? [
          `картинка ${images[0]?.width}×${images[0]?.height} вместо ${width}×${height}`,
        ]
      : [];

const same = (what: string, got: unknown, want: unknown) =>
  got === want
    ? []
    : [`${what}: ${JSON.stringify(got)} вместо ${JSON.stringify(want)}`];

/** Автор и лицензия набора в ответе (ADR-0011). */
const setProblems = (set: Json, what: string): string[] =>
  set?.license?.spdx && set?.author?.name
    ? []
    : [`${what}: нет лицензии или автора набора`];

export const CASES: readonly Case[] = [
  {
    tool: "search_icons",
    args: { query: "корзина" },
    eras: ERAS,
    expect: (r, images, text) => [
      ...same("ranking", r.ranking, "meaning"),
      ...same("иконок", r.count, 12),
      ...size(images, 384, 288),
      ...licenseProblems(r),
      ...(text.includes("Licenses") ? [] : ["в тексте нет лицензий"]),
    ],
  },
  {
    tool: "search_icons",
    args: { query: "lucide:house", limit: 3 },
    eras: ERAS,
    expect: (r, images) => [
      ...(r.results[0]?.icon === "lucide:house" && r.results[0]?.exact === true
        ? []
        : [`первой не lucide:house с пометкой exact: ${r.results[0]?.icon}`]),
      ...size(images, 384, 96),
      ...licenseProblems(r),
    ],
  },
  {
    tool: "search_icons",
    args: { query: "settings", limit: 24, style: "outline" },
    eras: ["2025"],
    expect: (r, images) => [
      ...same("иконок", r.count, 24),
      ...(r.results.every((x: Json) => x.style === "outline")
        ? []
        : ["не все иконки в стиле outline"]),
      ...size(images, 576, 384),
      ...licenseProblems(r),
    ],
  },
  {
    tool: "search_icons",
    args: { query: "heart", sets: ["fluent-emoji-flat"], preview: false },
    eras: ["2025"],
    expect: (r, images) => [
      ...(r.results.length > 0 &&
      r.results.every((x: Json) => x.set === "fluent-emoji-flat")
        ? []
        : ["не только fluent-emoji-flat"]),
      ...(images.length === 0 && !r.preview ? [] : ["картинка без просьбы"]),
      ...licenseProblems(r),
    ],
  },
  {
    tool: "get_icon",
    args: { icon: "lucide:house" },
    eras: ERAS,
    expect: (r, _, text) => [
      ...same(
        "код",
        r.code,
        '<iconavo-icon icon="lucide:house" width="24"></iconavo-icon>',
      ),
      ...same("установка", r.setup?.install, "npm install @iconavo-ui/icon"),
      ...same("лицензия", r.set?.license?.spdx, "ISC"),
      ...setProblems(r.set, "get_icon"),
      ...(String(r.attribution).startsWith("Icons: Lucide")
        ? []
        : ["нет указания авторства"]),
      ...(text.includes("License — keep this attribution")
        ? []
        : ["в тексте нет лицензии"]),
    ],
  },
  {
    tool: "get_icon",
    args: { icon: "lucide:home" },
    eras: ["2025"],
    expect: (r) => [
      ...same("основное имя", r.icon, "lucide:house"),
      ...same("старое имя", r.requested, "lucide:home"),
    ],
  },
  {
    tool: "get_icon",
    args: {
      icon: "lucide:heart",
      format: "react",
      size: 32,
      color: "#e11d48",
      strokeWidth: 1.5,
    },
    eras: ["2025"],
    expect: (r) =>
      same(
        "код React",
        r.code,
        'import { Icon } from "@iconavo-ui/react";\n\n<Icon icon="lucide:heart" width={32} color="#e11d48" strokeWidth={1.5} />',
      ),
  },
  {
    tool: "get_icon",
    args: { icon: "lucide:house", format: "css", strokeWidth: 1.5 },
    eras: ["2025"],
    expect: (r) => [
      ...(String(r.code).startsWith(
        ".lucide--house {\n  display: inline-block;",
      )
        ? []
        : ["CSS без класса lucide--house"]),
      ...(String(r.code).endsWith('\n\n<span class="lucide--house"></span>')
        ? []
        : ["CSS без элемента с классом"]),
      ...(String(r.code).includes("stroke-width='1.5'")
        ? []
        : ["толщина не в рисунке маски"]),
      ...same("установка", r.setup, undefined),
      ...setProblems(r.set, "набор"),
    ],
  },
  {
    tool: "get_icon",
    args: { icon: "lucide:heart", format: "svg", color: "#e11d48" },
    eras: ["2025"],
    expect: async (r) => {
      const [comment, svg] = String(r.code).split("\n");
      const res = await get(String(r.svgUrl));
      const api = res instanceof Response ? await res.text() : res.message;
      return [
        ...(comment?.startsWith("<!-- lucide:heart. Icons: Lucide")
          ? []
          : ["нет комментария об авторстве"]),
        ...(svg === api ? [] : ["SVG не совпадает с адресом SVG edge API"]),
      ];
    },
  },
  {
    tool: "get_matching_set",
    args: {
      concepts: ["home", "search", "settings", "user"],
      like: "ph:house-bold",
    },
    eras: ERAS,
    expect: (r) => [
      ...same("набор", r.set?.prefix, "ph"),
      ...same("вариант", r.variant, "-bold"),
      ...same("иконок", r.icons?.length, 4),
      ...(r.icons?.every(
        (x: Json) =>
          String(x.icon).startsWith("ph:") && String(x.icon).endsWith("-bold"),
      )
        ? []
        : [
            `не все ph:*-bold: ${r.icons?.map((x: Json) => x.icon).join(", ")}`,
          ]),
      ...setProblems(r.set, "get_matching_set"),
    ],
  },
  {
    tool: "get_matching_set",
    args: { concepts: ["дом", "поиск", "настройки"] },
    eras: ["2025"],
    expect: (r) => [
      ...same("иконок", r.icons?.length, 3),
      ...(r.icons?.every((x: Json) =>
        String(x.icon).startsWith(`${r.set?.prefix}:`),
      )
        ? []
        : ["иконки из разных наборов"]),
      ...setProblems(r.set, "get_matching_set"),
    ],
  },
  {
    tool: "get_usage",
    args: { framework: "react" },
    eras: ["2025"],
    expect: (r) => [
      ...same("установка", r.install, "npm install @iconavo-ui/react"),
      ...(String(r.example).includes("@iconavo-ui/react")
        ? []
        : ["пример без пакета"]),
      ...(String(r.licenses).includes("MIT") ? [] : ["нет лицензий"]),
    ],
  },
  {
    tool: "get_usage",
    args: { framework: "script" },
    eras: ["2025"],
    expect: (r) =>
      String(r.setup).includes('integrity="sha384-')
        ? []
        : ["строка <script> без хэша"],
  },
  {
    tool: "list_sets",
    args: {},
    eras: ERAS,
    expect: (r) => [
      ...same(
        "наборы",
        (r.sets ?? [])
          .map((x: Json) => x.prefix)
          .sort()
          .join(","),
        "fluent-emoji-flat,lucide,material-symbols,ph,tabler",
      ),
      ...(r.sets ?? []).flatMap((x: Json) => [
        ...setProblems(x, x.prefix),
        ...(x.commercialUse
          ? []
          : [`${x.prefix}: не для коммерческих проектов`]),
      ]),
    ],
  },
  {
    tool: "pick_icon",
    args: { query: "поделиться" },
    eras: ERAS,
    expect: (r, images, text, meta) => {
      const payload = parsePickerPayload(meta?.[PICKER_META_KEY]);
      return [
        ...same("иконок", r.count, 12),
        ...size(images, 384, 288),
        ...licenseProblems(r),
        ...(text.includes("ask the user for a number")
          ? []
          : ["в тексте нет подсказки для клиентов без сетки"]),
        ...(payload === undefined
          ? ["нет данных сетки в _meta"]
          : [
              ...same("карточек в сетке", payload.cards.length, 12),
              ...payload.cards.flatMap((c) =>
                Object.values(c.styles).every(
                  (name) => payload.icons[name] !== undefined,
                )
                  ? []
                  : [`у ${c.icon} нет рисунка стиля`],
              ),
              ...payload.sets.flatMap((x) => setProblems(x, x.prefix)),
            ]),
      ];
    },
  },
];

/**
 * Сетка выбора (MCP Apps, ADR-0045): адрес интерфейса у pick_icon, шаблон и чтение ресурса, версия —
 * отпечаток страницы; код, который сетка отдаст ассистенту, — как у get_icon.
 */
async function pickerProblems(client: Client, uri: unknown): Promise<string[]> {
  const problems: string[] = [];
  if (typeof uri !== "string" || !/^ui:\/\/picker\/[0-9a-f]{8}$/.test(uri)) {
    return [`у pick_icon адрес интерфейса ${JSON.stringify(uri)}`];
  }
  const templates = await client.listResourceTemplates();
  if (
    !templates.resourceTemplates.some(
      (t) => t.uriTemplate === "ui://picker/{version}",
    )
  ) {
    problems.push("нет шаблона ui://picker/{version}");
  }
  const read = await client.readResource({ uri });
  const content = read.contents[0] as Json;
  const html = typeof content?.text === "string" ? content.text : "";
  problems.push(
    ...same("MIME", content?.mimeType, "text/html;profile=mcp-app"),
    ...same("рамка клиента", content?._meta?.ui?.prefersBorder, true),
    ...(html.startsWith("<!doctype html>") ? [] : ["ресурс — не страница"]),
    ...same(
      "версия",
      uri.slice("ui://picker/".length),
      createHash("sha256").update(html).digest("hex").slice(0, 8),
    ),
  );
  const picked = await client.callTool({
    name: "pick_icon",
    arguments: { query: "share", format: "react", color: "#e11d48" },
  });
  const payload = parsePickerPayload((picked._meta as Json)?.[PICKER_META_KEY]);
  const card = payload?.cards[0];
  const choice =
    payload === undefined || card === undefined
      ? undefined
      : pickerChoice(payload, card, {
          format: "react",
          color: payload.color,
        });
  if (choice === undefined) return [...problems, "выбор в сетке не считается"];
  const icon = await client.callTool({
    name: "get_icon",
    arguments: { icon: choice.icon, format: "react", color: "#e11d48" },
  });
  return [
    ...problems,
    ...same("код выбора", choice.code, (icon.structuredContent as Json)?.code),
  ];
}

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
export function licenseProblems(r: Json): string[] {
  const problems: string[] = [];
  const sets = new Map<string, Json>(
    (r.sets ?? []).map((s: Json) => [s.prefix, s]),
  );
  for (const x of r.results ?? []) {
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
    const names = tools.tools.map((t) => t.name);
    rows.push({
      name: `Протокол ${era}: список инструментов`,
      problems: [
        ...(names.join(",") === TOOLS.join(",")
          ? []
          : [`инструменты ${names.join(", ")} вместо ${TOOLS.join(", ")}`]),
        ...tools.tools.flatMap((t) => [
          ...((t.description ?? "").length > 100
            ? []
            : [`${t.name}: короткое описание`]),
          ...(t.outputSchema ? [] : [`${t.name}: нет схемы ответа`]),
          ...(t.annotations?.readOnlyHint === true
            ? []
            : [`${t.name}: не помечен «только чтение»`]),
        ]),
      ],
    });
    try {
      rows.push({
        name: `Протокол ${era}: сетка выбора`,
        problems: await pickerProblems(
          client,
          (
            tools.tools.find((t) => t.name === "pick_icon")?._meta?.ui as
              | Json
              | undefined
          )?.resourceUri,
        ),
      });
    } catch (e) {
      rows.push({
        name: `Протокол ${era}: сетка выбора`,
        problems: [(e as Error).message],
      });
    }
    for (const c of CASES.filter((x) => x.eras.includes(era))) {
      log?.(`${era}: ${c.tool} ${JSON.stringify(c.args)}`);
      const started = performance.now();
      const call: McpCall = {
        era,
        tool: c.tool,
        args: c.args,
        ms: 0,
        isError: false,
        text: "",
        images: [],
        problems: [],
      };
      try {
        const result = await client.callTool({
          name: c.tool,
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
          call.problems.push(
            ...(await c.expect(
              result.structuredContent,
              call.images,
              call.text,
              result._meta,
            )),
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
