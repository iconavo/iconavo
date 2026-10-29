// Сервер песочницы пакета (фаза 3, шаги 2–5 и 9): слушает только 127.0.0.1 и сверяет Host, как
// страница поиска. Отдаёт пять страниц — загрузку и сеть (/), рендер (/render), тег (/tag), 5000 иконок
// (/many) и сбои сети (/net), их скрипты (dist/sandbox/*-client.js), файлы ядра из packages/core/dist и
// пакета тега из packages/icon/dist — по имени из строчных букв и дефисов, так что за пределы папки не
// выйти. Скрипт тега по ?delay=N приходит на N мс позже: так страница 5000 иконок показывает место до
// его загрузки.

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { esc, htmlPage } from "../report/html.js";
import { allowedHost, type Reply } from "../search/server.js";
import { LIVE_API, LOCAL_API, MAX_SCRIPT_DELAY_MS } from "./config.js";
import { manyData, manySets, renderManyPage } from "./many-page.js";
import { netData, renderNetPage } from "./net-page.js";
import { renderSandboxPage, sandboxData } from "./page.js";
import { renderData, renderVariantsPage } from "./render-page.js";
import { renderTagPage, tagData } from "./tag-page.js";

export interface SandboxContext {
  port: number;
  /** Папка packages/core/dist. */
  coreDir: string;
  /** Папка packages/icon/dist: вывод tsc и скрипт для страниц без сборщика. */
  iconDir: string;
  /** Скрипт страницы — dist/sandbox/client.js конвейера. */
  clientFile: string;
  /** Скрипт страницы рендера — dist/sandbox/render-client.js конвейера. */
  renderFile: string;
  /** Скрипт страницы тега — dist/sandbox/tag-client.js конвейера. */
  tagFile: string;
  /** Скрипт страницы 5000 иконок — dist/sandbox/many-client.js конвейера. */
  manyFile: string;
  /** Скрипт страницы сбоев сети — dist/sandbox/net-client.js конвейера. */
  netFile: string;
  /** Видимые имена каждого набора, по кодам символов. */
  names: Record<string, string[]>;
}

const JS = "text/javascript; charset=utf-8";
const HTML = "text/html; charset=utf-8";
const PACKAGE_FILE = /^\/(core|icon)\/([a-z]+(?:-[a-z]+)*)\.js$/;

const text = (status: number, message: string): Reply => ({
  status,
  type: HTML,
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

/** Задержка скрипта тега из ?delay= — целые мс до MAX_SCRIPT_DELAY_MS; другое — без задержки. */
export function scriptDelay(value: string | null): number {
  const ms = /^[0-9]{1,5}$/.test(value ?? "") ? Number(value) : 0;
  return Math.min(ms, MAX_SCRIPT_DELAY_MS);
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
  const page = parsed.pathname;
  if (
    page === "/" ||
    page === "/render" ||
    page === "/tag" ||
    page === "/many" ||
    page === "/net"
  ) {
    const api = apiHost(parsed.searchParams.get("api"));
    if (api === null) {
      return text(
        400,
        `Хост API — только ${LIVE_API} или http://127.0.0.1:порт (pnpm api preview)`,
      );
    }
    // Второй хост статики страницы сбоев — тоже только превью на этом компьютере.
    const cdn2 = parsed.searchParams.get("cdn2");
    if (page === "/net" && cdn2 !== null && !LOCAL_API.test(cdn2)) {
      return text(400, "Второй хост статики — только http://127.0.0.1:порт");
    }
    const body =
      page === "/"
        ? renderSandboxPage(sandboxData(api, ctx.names))
        : page === "/render"
          ? renderVariantsPage(renderData(api))
          : page === "/tag"
            ? renderTagPage(tagData(api))
            : page === "/net"
              ? renderNetPage(netData(api, cdn2))
              : renderManyPage(
                  manyData(api, parsed.searchParams.get("slow-script") === "1"),
                  manySets(ctx.names),
                );
    return { status: 200, type: HTML, body };
  }
  const scripts: Record<string, string> = {
    "/sandbox.js": ctx.clientFile,
    "/render.js": ctx.renderFile,
    "/tag.js": ctx.tagFile,
    "/many.js": ctx.manyFile,
    "/net.js": ctx.netFile,
  };
  const script = scripts[page];
  if (script) {
    return file(script, "Нет скрипта песочницы — запустите pnpm sandbox");
  }
  const own = PACKAGE_FILE.exec(page);
  if (own) {
    const icon = own[1] === "icon";
    const ms = icon ? scriptDelay(parsed.searchParams.get("delay")) : 0;
    if (ms > 0) await sleep(ms);
    return file(
      join(icon ? ctx.iconDir : ctx.coreDir, `${own[2]}.js`),
      "Нет такого файла пакета — запустите pnpm sandbox: он собирает ядро и тег",
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
