// Сервер песочницы ядра (фаза 3, шаги 2–4): слушает только 127.0.0.1 и сверяет Host, как страница
// поиска. Отдаёт две страницы — загрузку и сеть (/) и рендер (/render), их скрипты
// (dist/sandbox/client.js и render-client.js) и файлы ядра из packages/core/dist — по имени из
// строчных букв и дефисов, так что за пределы папки не выйти.

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { esc, htmlPage } from "../report/html.js";
import { allowedHost, type Reply } from "../search/server.js";
import { LIVE_API, LOCAL_API } from "./config.js";
import { renderSandboxPage, sandboxData } from "./page.js";
import { renderData, renderVariantsPage } from "./render-page.js";

export interface SandboxContext {
  port: number;
  /** Папка packages/core/dist. */
  coreDir: string;
  /** Скрипт страницы — dist/sandbox/client.js конвейера. */
  clientFile: string;
  /** Скрипт страницы рендера — dist/sandbox/render-client.js конвейера. */
  renderFile: string;
  /** Видимые имена каждого набора, по кодам символов. */
  names: Record<string, string[]>;
}

const JS = "text/javascript; charset=utf-8";
const CORE_FILE = /^\/core\/([a-z]+(?:-[a-z]+)*)\.js$/;

const text = (status: number, message: string): Reply => ({
  status,
  type: "text/html; charset=utf-8",
  body: htmlPage(message, "", `<p>${esc(message)}</p>`),
});

/** Хост API из ?api=: живой edge API или превью на этом компьютере; другое — null. */
export function apiHost(value: string | null): string | null {
  if (value === null || value === "") return LIVE_API;
  return value === LIVE_API || LOCAL_API.test(value) ? value : null;
}

async function file(path: string, missing: string): Promise<Reply> {
  try {
    return { status: 200, type: JS, body: await readFile(path) };
  } catch {
    return text(404, missing);
  }
}

export async function reply(
  ctx: SandboxContext,
  method: string | undefined,
  url: string | undefined,
  host: string | undefined,
): Promise<Reply> {
  if (!allowedHost(host, ctx.port)) {
    return text(403, "Песочница открывается только по адресу 127.0.0.1");
  }
  if (method !== "GET" && method !== "HEAD") return text(405, "Только GET");
  const parsed = new URL(url ?? "/", `http://127.0.0.1:${ctx.port}`);
  if (parsed.pathname === "/" || parsed.pathname === "/render") {
    const api = apiHost(parsed.searchParams.get("api"));
    if (api === null) {
      return text(
        400,
        `Хост API — только ${LIVE_API} или http://127.0.0.1:порт (pnpm api preview)`,
      );
    }
    return {
      status: 200,
      type: "text/html; charset=utf-8",
      body:
        parsed.pathname === "/"
          ? renderSandboxPage(sandboxData(api, ctx.names))
          : renderVariantsPage(renderData(api)),
    };
  }
  if (parsed.pathname === "/sandbox.js" || parsed.pathname === "/render.js") {
    return file(
      parsed.pathname === "/sandbox.js" ? ctx.clientFile : ctx.renderFile,
      "Нет скрипта песочницы — запустите pnpm sandbox",
    );
  }
  const core = CORE_FILE.exec(parsed.pathname);
  if (core) {
    return file(
      join(ctx.coreDir, `${core[1]}.js`),
      "Нет такого файла ядра — запустите pnpm sandbox: он собирает ядро",
    );
  }
  return text(404, "Нет такой страницы");
}

/** Видимые имена набора из data/{id}/icons.json: без скрытых и без алиасов, по кодам символов. */
export async function visibleNames(
  dataDir: string,
  id: string,
): Promise<string[]> {
  const file = JSON.parse(
    await readFile(join(dataDir, id, "icons.json"), "utf8"),
  ) as { icons: Record<string, { hidden?: boolean }> };
  return Object.keys(file.icons)
    .filter((name) => file.icons[name]?.hidden !== true)
    .sort();
}

export function startSandbox(
  ctx: SandboxContext,
  log: (line: string) => void = () => {},
): Promise<Server> {
  const server = createServer((req, res) => {
    reply(ctx, req.method, req.url, req.headers.host)
      .catch((e: Error): Reply => text(500, `Ошибка: ${e.message}`))
      .then((r) => {
        // Браузер не хранит файлы песочницы: после пересборки ядра видно новое.
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
