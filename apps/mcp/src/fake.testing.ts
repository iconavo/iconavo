// Помощники тестов MCP-сервера: те же подделки, что у edge API (бакеты, кэш, Meilisearch, Polza,
// лимит частоты), набор demo с оглавлением каталога и запросы JSON-RPC к serve() без сети.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STORE_KEYS } from "@iconavo-ui/search";
import { usageFromReadme } from "@iconavo-ui/snippets/readme";
import {
  type FakeDoc,
  fakeBucket,
  fakeCache,
  type fakeLimiter,
  fakeSearchFetch,
  MEILI_URL,
  manifestText,
  nameFileText,
  VERSION,
  waiter,
} from "../../api/src/fake.testing.js";
import { compactJson } from "../../api/src/json.js";
import { createDeps } from "./context.js";
import { serve } from "./http.js";

export const CATALOG = "aaaaaaaaaaaa";
/** Настоящий README тега: get_usage и строки установки — как в выкладке. */
export const USAGE = usageFromReadme(
  readFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "packages",
      "icon",
      "README.md",
    ),
    "utf8",
  ),
);
export const INDEX = "1234abcd";
/** Заглушка страницы сетки выбора pick_icon: настоящую вшивает pnpm mcp build. */
export const PICKER = {
  html: '<!doctype html><title>picker</title><main id="picker"></main>',
  version: "abcdef12",
};
export const COLOR_VERSION = "89abcdef";
/** Подменная картинка: PNG-подпись и номер отрисовки. */
export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const LINE =
  '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1h4"/></g>';
const FILLED = '<path fill="currentColor" d="M0 0h4v4H0z"/>';
const SWAN =
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path fill="url(#g)" d="M0 0h8v8H0z"/>';

const INFO = {
  name: "Demo",
  total: 4,
  version: "1.2.3",
  author: { name: "Demo Authors", url: "https://example.com/demo" },
  license: {
    title: "ISC License",
    spdx: "ISC",
    url: "https://spdx.org/licenses/ISC.html",
  },
  height: 24,
  palette: false,
};
const LICENSE = {
  text: "ISC License",
  source: "https://example.com/demo",
  revision: "1.2.3",
};
export const FEATHER = {
  name: "Feather",
  author: "Cole Bemis",
  url: "https://github.com/feathericons/feather",
  license: "MIT",
  icons: ["house"],
};

export const DOCS: FakeDoc[] = [
  {
    icon: "demo:house",
    set: "demo",
    names: [
      "demo:home",
      "demo:house",
      "demo:house-fill",
      "home",
      "house",
      "house-fill",
    ],
    words: ["house", "home", "дом"],
    license: "ISC",
    variants: ["house-fill"],
    style: ["outline", "filled"],
    styles: { outline: "house", filled: "house-fill" },
    about: {
      en: { description: "A house", synonyms: ["home", "building"] },
      ru: { description: "Дом", synonyms: ["дом", "здание"] },
      tags: ["home", "building"],
    },
  },
  {
    icon: "demo:heart",
    set: "demo",
    names: ["demo:heart", "demo:heart-fill", "heart", "heart-fill"],
    words: ["heart", "love", "сердце"],
    license: "ISC",
    variants: ["heart-fill"],
    style: ["outline", "filled"],
    styles: { outline: "heart", filled: "heart-fill" },
  },
  {
    icon: "color:swan",
    set: "color",
    names: ["color:swan", "swan"],
    words: ["swan", "house", "лебедь"],
    palette: true,
    license: "MIT",
    style: ["color"],
    styles: { color: "swan" },
  },
];

const file = (set: string, version: string, name: string) =>
  `v/${version}/${set}/${name}.json`;

function bucketFiles(): Record<string, string> {
  return {
    "manifest.json": manifestText(
      { demo: VERSION, color: COLOR_VERSION },
      CATALOG,
    ),
    [`catalog/${CATALOG}.json`]: compactJson({
      changelog: "dddddddddddd",
      sets: {
        demo: {
          collection: "bbbbbbbbbbbb",
          info: INFO,
          license: LICENSE,
          content: "c0ffee000001",
          styles: { outline: [""], filled: ["-fill"] },
          credits: [FEATHER],
        },
        color: {
          collection: "cccccccccccc",
          info: {
            ...INFO,
            name: "Color",
            author: { name: "Color Authors" },
            license: { title: "MIT License", spdx: "MIT" },
            palette: true,
          },
          license: LICENSE,
          content: "c0ffee000002",
          styles: { color: [""] },
        },
      },
    }),
    [file("demo", VERSION, "house")]: nameFileText("demo", {
      house: { body: LINE },
    }),
    [file("demo", VERSION, "house-fill")]: nameFileText("demo", {
      "house-fill": { body: FILLED },
    }),
    [file("demo", VERSION, "heart")]: nameFileText("demo", {
      heart: { body: LINE },
    }),
    [file("demo", VERSION, "heart-fill")]: nameFileText("demo", {
      "heart-fill": { body: FILLED },
    }),
    [file("demo", VERSION, "home")]: nameFileText(
      "demo",
      { house: { body: LINE } },
      { home: { parent: "house" } },
    ),
    [file("color", COLOR_VERSION, "swan")]: nameFileText(
      "color",
      { swan: { body: SWAN, width: 32, height: 16 } },
      undefined,
      32,
    ),
  };
}

export interface McpSetupOptions {
  meiliStatus?: number;
  limiter?: ReturnType<typeof fakeLimiter>;
  iconLimiter?: ReturnType<typeof fakeLimiter>;
  polza?: (text: string) => Promise<number[]>;
}

/** Ответ MCP: JSON или поток SSE с одним сообщением (запасной путь протокола 2025 года). */
export async function rpcBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length));
    return JSON.parse(data.at(-1) ?? "{}");
  }
  return JSON.parse(text);
}

export function mcpSetup(o: McpSetupOptions = {}) {
  const bucket = fakeBucket(bucketFiles());
  const searchBucket = fakeBucket({
    [STORE_KEYS.index]: JSON.stringify({ version: INDEX }),
  });
  const cache = fakeCache();
  const logs: string[] = [];
  const rendered: string[] = [];
  const net = fakeSearchFetch({
    docs: DOCS,
    ...(o.meiliStatus === undefined ? {} : { meiliStatus: o.meiliStatus }),
    ...(o.polza ? { polza: o.polza } : {}),
  });
  const deps = createDeps(
    {
      CDN: bucket,
      SEARCH: searchBucket,
      ...(o.limiter ? { MCP_SEARCH_LIMIT: o.limiter } : {}),
      ...(o.iconLimiter ? { MCP_ICON_LIMIT: o.iconLimiter } : {}),
      MEILISEARCH_URL: MEILI_URL,
      MEILISEARCH_SEARCH_KEY: "search-key",
      POLZA_API_KEY: "polza-key",
    },
    {
      cache,
      build: "test",
      now: () => 0,
      log: (message) => logs.push(message),
      fetch: net.fn,
      usage: USAGE,
      picker: PICKER,
      render: (svg) => {
        rendered.push(svg);
        return new Uint8Array([...PNG_SIGNATURE, rendered.length]);
      },
    },
  );
  const w = waiter();
  const request = (path: string, init?: RequestInit) =>
    serve(
      new Request(`https://mcp.iconavo.dev${path}`, init),
      deps,
      w.waitUntil,
    );
  let id = 0;
  /** Сообщение JSON-RPC по протоколу 2025 года (запасной путь без состояния). */
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    id += 1;
    const res = await request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        "cf-connecting-ip": "203.0.113.7",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return { res, body: await rpcBody(res) };
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const { body } = await rpc("tools/call", { name, arguments: args });
    return body.result as {
      isError?: boolean;
      content: {
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }[];
      structuredContent?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };
  };
  return {
    deps,
    request,
    rpc,
    call,
    flush: () => w.flush(),
    logs,
    rendered,
    net,
    cache,
    bucket,
  };
}
