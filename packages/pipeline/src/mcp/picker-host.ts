// Страница просмотра сетки выбора (шаг 11 фазы 4, ADR-0045): pnpm mcp picker на 127.0.0.1. Сервер отдаёт
// страницу-хост (AppBridge SDK, как у клиента MCP Apps), сам вид — /view.html со строгой политикой
// спецификации MCP Apps заголовком (рамка без сети, только встроенные скрипты и стили) и сценарии из data/.
// Слушает только 127.0.0.1 и сверяет Host.

import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { allowedHost } from "../api/local.js";
import { esc } from "../report/html.js";
import {
  buildPicker,
  bundleBrowser,
  type PickerBuild,
} from "./picker-build.js";
import type { PickerScenario } from "./picker-fixtures.js";

/** Скрипт страницы-хоста — исходник: rolldown собирает его вместе с AppBridge SDK. */
export const HOST_ENTRY = "packages/pipeline/src/mcp/picker-host-client.ts";

/**
 * Политика рамки по умолчанию из спецификации MCP Apps (2026-01-26) — так вид живёт у клиента, если
 * ресурс не просит доменов: встроенные скрипты и стили, картинки data:, никакой сети.
 */
export const VIEW_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'; object-src 'none'";

/** Политика самой страницы-хоста: свои скрипт и рамки. */
const HOST_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

const HOST_STYLE = `
:root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
body { margin: 0; padding: 2rem; background: #fafaf7; color: #1f1f1f; line-height: 1.5; }
header { max-width: 60rem; margin-bottom: 2rem; }
h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
.scenario { margin-bottom: 3rem; }
.scenario-title { font-size: 1rem; margin: 0 0 .75rem; }
.chat { display: inline-block; padding: 1.5rem; border-radius: 1rem; }
.chat-light { background: #f0efe9; }
.chat-dark { background: #262624; }
.frame { border: 1px solid #c9c7bf; border-radius: .75rem; overflow: hidden; }
.chat-dark .frame { border-color: #4a4945; }
iframe { display: block; width: 100%; height: 30rem; border: 0; }
.log { max-width: 60rem; }
.log-title { font-size: .875rem; margin: 1rem 0 .25rem; color: #555; }
.log-body { margin: 0; padding: .75rem 1rem; background: #fff; border: 1px solid #e2e0d8; border-radius: .5rem; white-space: pre-wrap; font-size: .8125rem; }
`;

function hostPage(build: PickerBuild, count: number): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Сетка выбора в чате — просмотр</title>
<link rel="icon" href="data:,">
<style>${HOST_STYLE}</style>
</head>
<body>
<header>
<h1>Сетка выбора иконки в чате</h1>
<p>Так сетка выглядит в клиенте с MCP Apps: ${count} сценариев на настоящих иконках из data/. Щёлкайте карточки, меняйте цвет, толщину линии и формат кода, нажимайте Select — под рамкой видно, что получил ассистент. Фон вокруг рамки изображает чат; рамку рисует клиент.</p>
<p>Сборка сетки ${esc(build.version)}: ${Math.round(build.bytes / 1024)} КБ, в gzip ${Math.round(build.gzipBytes / 1024)} КБ. Один сценарий — <code>?only=share-en-light</code>, без задержки ответа — <code>?delay=0</code>.</p>
</header>
<div id="scenarios"></div>
<script type="module" src="/host.js"></script>
</body>
</html>
`;
}

export interface PickerHost {
  port: number;
  build: PickerBuild;
  close(): Promise<void>;
}

/**
 * Поломки контрольного запуска проверки (?canary=…): каждую обязана заметить своя строка проверки.
 * nometa — клиент не передал сетке данные; notokens — в странице нет токенов сайта; external — картинка с
 * чужого адреса (рамка обязана её не пустить); unlabeled — кнопка без подписи; nolines — линейные
 * карточки не нарисованы (их ловит сверка толщины линии по ожидаемым карточкам).
 */
export const CANARIES = [
  "nometa",
  "notokens",
  "external",
  "unlabeled",
  "nolines",
] as const;
export type Canary = (typeof CANARIES)[number];

const isCanary = (value: string | null): value is Canary =>
  (CANARIES as readonly (string | null)[]).includes(value);

/** Страница сетки с подложенной поломкой. */
export function canaryHtml(html: string, canary: Canary | undefined): string {
  switch (canary) {
    case "notokens":
      return html.replace(/:root \{\n {2}--color-bg-page:[\s\S]*?\n\}\n/, "");
    case "external":
      return html.replace(
        "</body>",
        '<img src="https://example.com/iconavo-canary.png" alt="">\n</body>',
      );
    case "unlabeled":
      return html.replace(
        "</body>",
        '<button type="button" class="canary"></button>\n</body>',
      );
    case "nolines":
      // Карточка с линиями (у рисунка есть stroke-width) убирается, как только появилась.
      return html.replace(
        "</body>",
        `<script>new MutationObserver(() => { for (const card of document.querySelectorAll(".card[data-n]")) { if (card.querySelector("[stroke-width]")) card.remove(); } }).observe(document.documentElement, { childList: true, subtree: true });</script>\n</body>`,
      );
    default:
      return html;
  }
}

/**
 * Сборка, которую показывает хост: своя или живая с сервера (--base). Размеры — той страницы, что
 * показана, и в gzip тоже, а не локальной сборки (ревизия фазы 5, И-22).
 */
export function servedBuild(
  built: PickerBuild,
  page: { html: string; version: string } | undefined,
): PickerBuild {
  return page === undefined
    ? built
    : {
        html: page.html,
        version: page.version,
        bytes: Buffer.byteLength(page.html, "utf8"),
        gzipBytes: gzipSync(page.html).length,
        scriptBytes: 0,
      };
}

export async function startPickerHost(options: {
  root: string;
  port: number;
  scenarios: readonly PickerScenario[];
  /** Своя страница сетки — живая с сервера; нет — свежая сборка. */
  page?: { html: string; version: string };
}): Promise<PickerHost> {
  const [built, script] = await Promise.all([
    buildPicker(options.root),
    bundleBrowser(options.root, HOST_ENTRY),
  ]);
  const build = servedBuild(built, options.page);
  const page = hostPage(build, options.scenarios.length);
  const scenarios = JSON.stringify(options.scenarios);
  // Без данных сетки в _meta — как у клиента, который их не передал.
  const bare = JSON.stringify(
    options.scenarios.map((s) => ({
      ...s,
      result: { ...s.result, _meta: {} },
    })),
  );
  let port = options.port;
  const server: Server = createServer((req, res) => {
    const send = (status: number, type: string, body: string, csp?: string) => {
      res.writeHead(status, {
        "content-type": `${type}; charset=utf-8`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(csp === undefined ? {} : { "content-security-policy": csp }),
      });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (!allowedHost(req.headers.host, port)) {
      send(403, "text/plain", "Неизвестный Host");
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const value = url.searchParams.get("canary");
    const canary = isCanary(value) ? value : undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(405, "text/plain", "Только GET");
    } else if (path === "/") {
      send(200, "text/html", page, HOST_CSP);
    } else if (path === "/view.html") {
      send(200, "text/html", canaryHtml(build.html, canary), VIEW_CSP);
    } else if (path === "/host.js") {
      send(200, "text/javascript", script);
    } else if (path === "/scenarios.json") {
      send(200, "application/json", canary === "nometa" ? bare : scenarios);
    } else {
      send(404, "text/plain", "Нет такой страницы");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address !== null && typeof address === "object") port = address.port;
  return {
    port,
    build,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
