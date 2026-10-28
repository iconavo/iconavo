// React 18 в браузере (фаза 3, шаг 9; ADR-0033, ADR-0035). Next.js 16 работает только с React 19,
// поэтому пример для React 18 — без Next.js: rolldown собирает те же страницы примера (app/page.tsx и
// app/client.tsx) дважды — для сервера (renderToString) и для браузера (hydrateRoot) — с заменой react
// и react-dom на React 18.3.1 (пакеты react-18 и react-dom-18 конвейера). Обёртка и вторая страница —
// свои: layout и /more примера — асинхронные серверные компоненты, их React 18 не умеет; next/link —
// обычная ссылка. Разметка та же, что у Next.js, поэтому её проверяют те же функции check.ts.
// Сервер — 127.0.0.1 со сверкой Host; политика строже, чем у примера: скрипты только свои файлы,
// без 'unsafe-inline', и Trusted Types включены — разметку иконок пускает только политика iconavo.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { IconavoIconSet } from "@iconavo-ui/core";
import { esc, htmlPage } from "../report/html.js";
import { allowedHost, type Reply } from "../search/server.js";
import { NAMES_FILE } from "./config.js";
import type { Mode } from "./next.js";

/** Версия React этого примера — для заголовков и отчёта. */
export const REACT18 = "18.3.1";

/** Пакеты React 18 конвейера: папки, на которые сборка заменяет react и react-dom. */
function react18Dirs(): { react: string; dom: string } {
  const require = createRequire(import.meta.url);
  return {
    react: dirname(require.resolve("react-18/package.json")),
    dom: dirname(require.resolve("react-dom-18/package.json")),
  };
}

/** Вторая страница — как app/more/page.tsx, но иконки вложенной обёртки приходят пропсом. */
const MORE = `
import { Icon, IconavoProvider } from "@iconavo-ui/react";
import names from "APP/icons.json";
export function More({ nested }) {
  return (
    <main>
      <h1>Second page</h1>
      <section data-check="nested">
        <h2>From this page's server component</h2>
        <IconavoProvider icons={nested}>
          <div className="row">
            {names.more.map((name) => (
              <Icon key={name} icon={name} width={32} data-name={name} />
            ))}
          </div>
        </IconavoProvider>
      </section>
      <section data-check="browser">
        <h2>Loaded in the browser</h2>
        <div className="row">
          {names.moreBrowser.map((name) => (
            <Icon key={name} icon={name} width={32} data-name={name} />
          ))}
        </div>
      </section>
      <p>
        <a href="/">
          <Icon icon="lucide:arrow-right" flip="horizontal" /> Back
        </a>
      </p>
    </main>
  );
}
`;

/** next/link — обычная ссылка: переход на /more — новая страница с сервера. */
const LINK = `
export default function Link({ href, children, ...rest }) {
  return <a href={href} {...rest}>{children}</a>;
}
`;

/** Сервер: иконки обёрток через loadIcons ядра этой сборки и HTML страницы. */
const SERVER = `
import { renderToString } from "react-dom/server";
import { IconavoProvider, loadIcons } from "@iconavo-ui/react";
import Home from "APP/page.tsx";
import "APP/iconavo.ts";
import names from "APP/icons.json";
import { More } from "virtual:more";
export async function prepare() {
  return { server: await loadIcons(names.server), more: await loadIcons(names.more) };
}
export function render(path, data) {
  const page = path === "/more" ? <More nested={data.more} /> : <Home />;
  return renderToString(<IconavoProvider icons={data.server}>{page}</IconavoProvider>);
}
`;

/** Браузер: те же компоненты, данные обёрток — из блока JSON страницы. */
const CLIENT = `
import { hydrateRoot } from "react-dom/client";
import { IconavoProvider } from "@iconavo-ui/react";
import Home from "APP/page.tsx";
import { More } from "virtual:more";
const data = JSON.parse(document.getElementById("iconavo-data").textContent);
const page = location.pathname === "/more" ? <More nested={data.more} /> : <Home />;
hydrateRoot(document.getElementById("root"), <IconavoProvider icons={data.server}>{page}</IconavoProvider>);
`;

export interface React18Build {
  /** Серверная часть: prepare() — иконки обёрток, render(путь, данные) — разметка. */
  server: {
    prepare(): Promise<{ server: IconavoIconSet[]; more: IconavoIconSet[] }>;
    render(
      path: string,
      data: { server: IconavoIconSet[]; more: IconavoIconSet[] },
    ): string;
  };
  /** Браузерная часть — один ES-модуль. */
  client: string;
}

/**
 * Собрать пример с React 18: режим dev — сборки React для разработки и вход тега development.js, как
 * у next dev; prod — для продакшена. Хосты иконок — превью API, как у примера Next.js.
 */
export async function buildReact18(o: {
  /** Папка примера examples/next. */
  dir: string;
  mode: Mode;
  /** Превью API; статика — его /_static. */
  api: string;
  /** Куда положить серверную часть: её загружает import(). */
  outDir: string;
}): Promise<React18Build> {
  const { build } = await import("rolldown");
  const app = join(o.dir, "app").replaceAll("\\", "/");
  const { react, dom } = react18Dirs();
  const sources: Record<string, string> = {
    "virtual:server": SERVER,
    "virtual:client": CLIENT,
    "virtual:more": MORE,
    "next/link": LINK,
  };
  const bundle = async (entry: string, platform: "node" | "browser") => {
    const dev = o.mode === "dev";
    const result = await build({
      input: entry,
      cwd: o.dir,
      platform,
      resolve: {
        alias: { react, "react-dom": dom },
        conditionNames: [
          ...(dev ? ["development"] : []),
          ...(platform === "node" ? ["node"] : ["browser"]),
          "import",
          "default",
        ],
      },
      transform: {
        jsx: "react-jsx",
        define: {
          "process.env.NODE_ENV": JSON.stringify(
            dev ? "development" : "production",
          ),
          "process.env.NEXT_PUBLIC_ICONAVO_API": JSON.stringify(o.api),
          "process.env.NEXT_PUBLIC_ICONAVO_CDN": JSON.stringify(
            `${o.api}/_static`,
          ),
        },
      },
      plugins: [
        {
          name: "react18-example",
          resolveId: (id) => (id in sources ? { id: `\0${id}.tsx` } : null),
          load: (id) => {
            const name = id.startsWith("\0") ? id.slice(1, -4) : "";
            return name in sources
              ? (sources[name] as string).replaceAll("APP", app)
              : null;
          },
        },
      ],
      // Пометки "use client" сборщик без React Server Components выбрасывает с замечанием.
      onLog: () => {},
      write: false,
      output: { format: "esm", minify: !dev },
    });
    const [chunk] = result.output;
    if (chunk?.type !== "chunk") throw new Error("React 18: нет сборки");
    return chunk.code;
  };
  await mkdir(o.outDir, { recursive: true });
  const serverFile = join(o.outDir, `react18-${o.mode}-server.mjs`);
  await writeFile(serverFile, await bundle("virtual:server", "node"), "utf8");
  const server = (await import(
    `${pathToFileURL(serverFile).href}?${Date.now()}`
  )) as React18Build["server"];
  return { server, client: await bundle("virtual:client", "browser") };
}

/** Политика страниц: скрипты и стили — только свои файлы, сеть — только хосты иконок, Trusted Types. */
export const react18Csp = (api: string) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src 'self' ${new URL(api).origin}`,
    "img-src 'self' data:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types iconavo",
  ].join("; ");

/** JSON внутри <script>: «<» экранируется, и текст не закроет блок раньше времени. */
const jsonInScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

/** Документ страницы: разметка React 18 с сервера, данные обёрток и скрипт браузера. */
export function react18Page(body: string, data: unknown): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Iconavo with React ${REACT18}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/app.css">
<script type="application/json" id="iconavo-data">${jsonInScript(data)}</script>
<script type="module" src="/client.js"></script>
</head>
<body><div id="root">${body}</div></body>
</html>
`;
}

export interface React18Server {
  url: string;
  stop(): Promise<void>;
}

/** Пример с React 18 на 127.0.0.1:port: страницы / и /more, скрипт браузера и стили примера. */
export async function startReact18(o: {
  dir: string;
  mode: Mode;
  api: string;
  outDir: string;
  port: number;
}): Promise<React18Server> {
  const built = await buildReact18(o);
  const data = await built.server.prepare();
  const css = await readFile(
    join(o.dir, dirname(NAMES_FILE), "globals.css"),
    "utf8",
  );
  const csp = react18Csp(o.api);
  let port = o.port;
  const text = (status: number, message: string): Reply => ({
    status,
    type: "text/html; charset=utf-8",
    body: htmlPage(message, "", `<p>${esc(message)}</p>`),
  });
  const reply = (method: string | undefined, url: string, host?: string) => {
    if (!allowedHost(host, port)) {
      return text(403, "Пример открывается только по адресу 127.0.0.1");
    }
    if (method !== "GET" && method !== "HEAD") return text(405, "Только GET");
    const path = new URL(url, `http://127.0.0.1:${port}`).pathname;
    if (path === "/" || path === "/more") {
      return {
        status: 200,
        type: "text/html; charset=utf-8",
        body: react18Page(built.server.render(path, data), data),
      };
    }
    if (path === "/client.js") {
      return {
        status: 200,
        type: "text/javascript; charset=utf-8",
        body: built.client,
      };
    }
    if (path === "/app.css") {
      return { status: 200, type: "text/css; charset=utf-8", body: css };
    }
    return text(404, "Нет такой страницы");
  };
  const server: Server = createServer((req, res) => {
    let r: Reply;
    try {
      r = reply(req.method, req.url ?? "/", req.headers.host);
    } catch (e) {
      r = text(500, `Ошибка: ${(e as Error).message}`);
    }
    // Страница с ?axe=1 — без политики: в неё вставляет свой скрипт проверка доступности (check.ts).
    const axe = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.has(
      "axe",
    );
    res.writeHead(r.status, {
      "content-type": r.type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(axe ? {} : { "content-security-policy": csp }),
    });
    res.end(req.method === "HEAD" ? undefined : r.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
