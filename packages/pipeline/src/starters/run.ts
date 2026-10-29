// Проверка живых примеров целиком (фаза 3, шаг 10; ADR-0050): архивы пакетов этой ветки → рабочая копия
// каждого примера с этими архивами → npm install → сборка → сервер в каждом режиме → браузеры. С --npm —
// пример как есть из lock-файла, пакеты из реестра npm, живые хосты и настоящий jsDelivr: так его
// получит разработчик после публикации (шаг 11).

import { access, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNext, freePort, startNext } from "../example/next.js";
import { SCRIPT_FILE } from "../icon/build.js";
import type { BrowserName } from "../sandbox/browser.js";
import { fail, pass, type Verdict } from "../sandbox/verdict.js";
import {
  type CheckId,
  checkStarterPages,
  MODE_TITLES,
  STARTER_MODES,
  type StarterResult,
  serverLogVerdict,
} from "./check.js";
import {
  STARTER_TITLES,
  STARTERS_DIR,
  type StarterId,
  WORK_DIR,
} from "./config.js";
import {
  copyStarter,
  installVerdict,
  type LsNode,
  useLocalPacks,
} from "./install.js";
import { hostMap } from "./origins.js";
import { type Pack, packPackages, packVerdict, run } from "./pack.js";
import { type RunningServer, startScript, startStatic } from "./servers.js";

export interface StartersCheckOptions {
  root: string;
  ids: readonly StarterId[];
  browsers: readonly BrowserName[];
  /** Превью API этой ветки; с --npm — нет: живые хосты. */
  api?: string;
  log: (line: string) => void;
}

export interface StartersReport {
  /** --npm: пакеты из реестра, иначе — архивы этой ветки. */
  npm: boolean;
  packs: Pack[];
  results: StarterResult[];
}

/** Адрес скрипта тега в HTML-примере — тот же, что в README. */
export const SCRIPT_URL =
  /src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@iconavo-ui\/icon@[^"/]+\/dist\/iconavo-icon\.js)"/;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Сообщение об ошибке без лишнего: первая строка и хвост вывода команды. */
const short = (e: unknown) =>
  (e as Error).message.split("\n").slice(0, 6).join(" ").slice(0, 400);

/** npm ls --all --json рабочей копии: дерево зависимостей. */
async function npmTree(dir: string): Promise<LsNode> {
  // npm ls выходит с кодом 1 и при лишних или неудовлетворённых зависимостях — дерево всё равно нужно.
  const output = await run("npm", ["ls", "--all", "--json"], dir).catch(
    (e: Error) => e.message.slice(e.message.indexOf("\n") + 1),
  );
  const start = output.indexOf("{");
  return JSON.parse(output.slice(start, output.lastIndexOf("}") + 1)) as LsNode;
}

/** Поставить рабочую копию: архивы этой ветки — npm install, --npm — npm ci из lock-файла. */
async function install(
  dir: string,
  packs: Pack[],
  npm: boolean,
): Promise<Verdict> {
  const flags = ["--no-audit", "--no-fund", "--ignore-scripts"];
  try {
    if (npm) {
      if (!(await exists(join(dir, "package-lock.json")))) {
        return fail("нет package-lock.json — pnpm starters --lock");
      }
      await run("npm", ["ci", ...flags], dir);
    } else {
      await useLocalPacks(dir, packs);
      await run("npm", ["install", ...flags], dir);
    }
  } catch (e) {
    return fail(`установка не удалась: ${short(e)}`);
  }
  const manifest = JSON.parse(
    await readFile(join(dir, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
  };
  const wanted = Object.keys(manifest.dependencies ?? {}).filter((n) =>
    n.startsWith("@iconavo-ui/"),
  );
  // Ядро — всегда: у архивов — прямой зависимостью, у --npm — зависимостью пакета React или тега, и
  // его версию задаёт пакет, а не пример.
  const expected = [...new Set([...wanted, "@iconavo-ui/core"])].map((name) => {
    const pack = packs.find((p) => p.name === name);
    return npm
      ? {
          name,
          version: manifest.dependencies?.[name],
          resolved: (r: string) => r.startsWith("https://registry.npmjs.org/"),
        }
      : {
          name,
          version: pack?.version ?? "",
          resolved: (r: string) =>
            pack !== undefined && r.includes(basename(pack.file)),
        };
  });
  const verdict = installVerdict(await npmTree(dir), expected);
  if (!npm || verdict.ok !== true) return verdict;
  try {
    await run("npm", ["audit", "signatures"], dir);
    return pass(`${verdict.note}; подписи npm проверены`);
  } catch (e) {
    return fail(`npm audit signatures: ${short(e)}`);
  }
}

/** Сервер рабочей копии в режиме. */
async function serve(
  id: StarterId,
  mode: "static" | "dev" | "prod",
  dir: string,
  env: Record<string, string>,
): Promise<RunningServer> {
  if (id === "html") return startStatic(dir);
  const port = await freePort();
  if (id === "next") {
    return startNext(mode === "prod" ? "prod" : "dev", port, { dir, env });
  }
  const url = `http://127.0.0.1:${port}`;
  const args = ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  return startScript(
    mode === "prod"
      ? ["run", "preview", "--", ...args]
      : ["run", "dev", "--", ...args],
    { dir, url, env },
  );
}

/** Сборка примера его же скриптом: React — tsc и vite build, Next.js — next build. */
async function build(
  id: StarterId,
  dir: string,
  env: Record<string, string>,
): Promise<Verdict> {
  try {
    if (id === "next") await buildNext({ dir, env });
    else await run("npm", ["run", "build"], dir, env);
    return pass("собран");
  } catch (e) {
    return fail(short(e));
  }
}

/** Есть ли версия пакета в реестре npm. */
export async function inRegistry(
  name: string,
  version: string,
): Promise<boolean> {
  const response = await fetch(
    `https://registry.npmjs.org/${name.replace("/", "%2F")}`,
    { headers: { accept: "application/vnd.npm.install-v1+json" } },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`реестр npm: ${response.status}`);
  const doc = (await response.json()) as { versions?: Record<string, unknown> };
  return version in (doc.versions ?? {});
}

/** Наши пакеты примеров, которых ещё нет в npm, — до публикации беты (шаг 11) их нет. */
export async function unpublished(
  root: string,
  ids: readonly StarterId[],
): Promise<string[]> {
  const missing: string[] = [];
  for (const id of ids) {
    const path = join(root, STARTERS_DIR, id, "package.json");
    if (!(await exists(path))) continue;
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (
        name.startsWith("@iconavo-ui/") &&
        !(await inRegistry(name, version))
      ) {
        missing.push(`${name}@${version}`);
      }
    }
  }
  return [...new Set(missing)];
}

/**
 * lock-файлы примеров после публикации (шаг 11): npm сам решает дерево по реестру в копии примера, а
 * package-lock.json возвращается в папку примера. Все адреса пакетов — реестр npm.
 */
export async function lockStarters(
  root: string,
  ids: readonly StarterId[],
  log: (line: string) => void,
): Promise<string[]> {
  const written: string[] = [];
  for (const id of ids) {
    const source = join(root, STARTERS_DIR, id);
    if (!(await exists(join(source, "package.json")))) continue;
    const dir = join(root, WORK_DIR, "lock", id);
    await copyStarter(source, dir);
    await rm(join(dir, "package-lock.json"), { force: true });
    log(`${STARTER_TITLES[id]}: npm install --package-lock-only…`);
    await run(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      dir,
    );
    const text = await readFile(join(dir, "package-lock.json"), "utf8");
    const lock = JSON.parse(text) as {
      packages?: Record<string, { resolved?: string }>;
    };
    const foreign = Object.entries(lock.packages ?? {}).filter(
      ([path, p]) =>
        path !== "" &&
        p.resolved !== undefined &&
        !p.resolved.startsWith("https://registry.npmjs.org/"),
    );
    if (foreign.length > 0) {
      throw new Error(
        `${id}: пакеты не из реестра npm — ${foreign
          .slice(0, 3)
          .map(([path]) => path)
          .join(", ")}`,
      );
    }
    const target = join(source, "package-lock.json");
    await writeFile(target, text, "utf8");
    written.push(target);
  }
  return written;
}

/**
 * Ручной запуск (pnpm starters <пример>): рабочая копия на архивах этой ветки, режим разработки и окно
 * браузера Playwright. Иконки — с живых хостов, скрипт тега HTML-примера — файл из архива: на jsDelivr
 * его до публикации нет. Закрыли окно — всё остановилось.
 */
export async function openStarter(o: {
  root: string;
  id: StarterId;
  browser: BrowserName;
  log: (line: string) => void;
}): Promise<void> {
  const { launchBrowser } = await import("../sandbox/browser.js");
  const { routeHosts } = await import("./hosts.js");
  const work = join(o.root, WORK_DIR);
  const packs = await packPackages(o.root, join(work, "packages"));
  const dir = join(work, "local", o.id);
  o.log(`${STARTER_TITLES[o.id]}: копия и установка…`);
  await copyStarter(join(o.root, STARTERS_DIR, o.id), dir);
  if (o.id !== "html") {
    const installed = await install(dir, packs, false);
    if (installed.ok === false) throw new Error(installed.note);
  }
  const server = await serve(o.id, o.id === "html" ? "static" : "dev", dir, {});
  const browser = await launchBrowser(o.browser, false);
  const page = await (await browser.newContext({ viewport: null })).newPage();
  const scriptUrl =
    o.id === "html"
      ? SCRIPT_URL.exec(await readFile(join(dir, "index.html"), "utf8"))?.[1]
      : undefined;
  await routeHosts(page, {
    map: null,
    script: scriptUrl
      ? {
          url: scriptUrl,
          body: await readFile(join(o.root, SCRIPT_FILE)),
          delayMs: 0,
        }
      : undefined,
  });
  const stop = () => {
    void server.stop().finally(() => process.exit(0));
  };
  browser.on("disconnected", stop);
  page.on("close", () => {
    void browser.close().finally(stop);
  });
  await page.goto(`${server.url}/`);
  o.log(
    `Открыто окно: ${STARTER_TITLES[o.id]} — ${server.url}/, иконки с живых хостов. Закройте окно, чтобы остановить.`,
  );
}

/** Все примеры, режимы и браузеры. */
export async function checkStarters(
  o: StartersCheckOptions,
): Promise<StartersReport> {
  const npm = o.api === undefined;
  const work = join(o.root, WORK_DIR);
  const packs = npm ? [] : await packPackages(o.root, join(work, "packages"));
  const packed: Verdict = npm
    ? { ok: null, note: "пакеты из реестра npm" }
    : packVerdict(packs);
  const map = npm ? null : hostMap(o.api as string);
  const preload = pathToFileURL(
    join(o.root, "packages", "pipeline", "dist", "starters", "preload.js"),
  ).href;
  const results: StarterResult[] = [];
  for (const id of o.ids) {
    const dir = join(work, npm ? "npm" : "local", id);
    o.log(`${STARTER_TITLES[id]}: копия и установка…`);
    await copyStarter(join(o.root, STARTERS_DIR, id), dir);
    const installed =
      id === "html"
        ? { ok: null, note: "без установки: скрипт тега — с jsDelivr" }
        : await install(dir, packs, npm);
    const page =
      id === "html" ? await readFile(join(dir, "index.html"), "utf8") : "";
    const scriptUrl = SCRIPT_URL.exec(page)?.[1];
    for (const mode of STARTER_MODES[id]) {
      const shared: Partial<Record<CheckId, Verdict>> = {
        pack: packed,
        install: installed,
      };
      // Дальше не пошли: строки, которые уже решены, — в каждом столбце, остальные — «не проверялось».
      const stopHere = (
        extra: Partial<Record<CheckId, Verdict>>,
        failure?: string,
      ) => {
        for (const browser of o.browsers) {
          results.push({
            starter: id,
            mode,
            browser,
            ...(failure ? { failure } : {}),
            verdicts: { ...shared, ...extra },
            shots: [],
          });
        }
      };
      if (installed.ok === false) {
        stopHere({});
        continue;
      }
      if (id === "html" && scriptUrl === undefined) {
        stopHere({ drawn: fail("в index.html нет скрипта тега с jsDelivr") });
        continue;
      }
      // Сервер Next.js ходит за иконками сам — подмена fetch направляет его в превью (preload.ts).
      const logFile = join(work, `${id}-${mode}-server.log`);
      await rm(logFile, { force: true });
      const env: Record<string, string> =
        id === "next" && map !== null
          ? {
              NODE_OPTIONS: `--import=${preload}`,
              ICONAVO_STARTERS_HOSTS: JSON.stringify(map),
              ICONAVO_STARTERS_LOG: logFile,
            }
          : {};
      if (mode === "prod") {
        o.log(`${STARTER_TITLES[id]}: сборка…`);
        shared.build = await build(id, dir, env);
        if (shared.build.ok === false) {
          stopHere({});
          continue;
        }
      }
      o.log(`${STARTER_TITLES[id]}: запуск — ${MODE_TITLES[mode]}…`);
      let server: RunningServer;
      try {
        server = await serve(id, mode, dir, env);
      } catch (e) {
        stopHere({}, `не запустился: ${short(e)}`);
        continue;
      }
      try {
        if (id === "next" && map !== null) {
          const log = await readFile(logFile, "utf8").catch(() => "");
          shared.network = serverLogVerdict(log.split(/\r?\n/).filter(Boolean));
        }
        results.push(
          ...(await checkStarterPages(
            {
              starter: id,
              mode,
              base: server.url,
              map,
              script:
                scriptUrl && !npm
                  ? {
                      url: scriptUrl,
                      body: await readFile(join(o.root, SCRIPT_FILE)),
                    }
                  : undefined,
              liveScript: npm ? scriptUrl : undefined,
              shared,
              log: (line) => o.log(`  ${line}`),
            },
            o.browsers,
          )),
        );
      } finally {
        await server.stop();
      }
    }
  }
  return { npm, packs, results };
}
