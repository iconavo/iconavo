// pnpm release verify --plan=… [--wait=N] (ADR-0051): «Проверка» workflow «Выпуск пакетов» после
// публикации. В npm под тегом — версия плана; архив — ровно тот, что собрала «Подготовка»; подпись
// provenance — из нашего репозитория, release.yml и main; доверенная публикация, токен — только у первой
// версии пакета; jsDelivr отдаёт скрипт тега с хэшем из README. И чистый проект: пустая папка, npm
// install пакетов из реестра и React, одна копия ядра, подписи npm, а Node рисует иконку с живых хостов
// через loadIcons и renderToString — рисунок сверяется с data/. npm показывает новую версию и её подпись
// после своей проверки, через минуты, поэтому проверка ждёт.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NPM_POLL_MS, NPM_PUBLISH_REF, NPM_REPOSITORY } from "../npm/config.js";
import { firstPublished } from "../npm/decide.js";
import {
  integrityHex,
  type NpmVersionDoc,
  type Packument,
  type Provenance,
  type RegistryClient,
} from "../npm/registry.js";
import type { FetchFn } from "../sources/npm.js";
import { installVerdict, type LsNode } from "../starters/install.js";
import { run } from "../starters/pack.js";
import {
  CLEAN_DIR,
  CLEAN_ICON,
  CLEAN_REACT,
  JSDELIVR_POLL_MS,
  RELEASE_WORKFLOW,
  scriptUrl,
} from "./config.js";
import type { ReleasePlan } from "./prepare.js";
import { sri } from "./text.js";

export type VerifyStatus = "ok" | "failed" | "skipped";

export interface ReleaseVerifyEntry {
  name: string;
  version: string;
  status: VerifyStatus;
  /** Версия под тегом в npm. */
  tagged?: string;
  latest?: string;
  publisher?: "trusted" | "token";
  provenance?: Provenance;
  problems: string[];
  notes: string[];
}

export interface ReleaseVerifyPart {
  status: VerifyStatus;
  problems: string[];
  notes: string[];
}

export interface ReleaseVerifyReport {
  version: string;
  tag: string;
  packages: ReleaseVerifyEntry[];
  jsdelivr: ReleaseVerifyPart & { url: string };
  /** Чистый проект: что поставилось и SVG, нарисованный пакетом из npm. */
  clean: ReleaseVerifyPart & { svg?: string };
}

export interface VerifyReleaseOptions {
  root: string;
  plan: ReleasePlan;
  registry: RegistryClient;
  /** Сколько ждать npm и jsDelivr после публикации. */
  waitMs?: number;
  pollMs?: number;
  jsdelivrPollMs?: number;
  /** Чистый проект — npm install из реестра; в тестах выключен. */
  clean?: boolean;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export const releaseVerifyFailed = (r: ReleaseVerifyReport) =>
  r.packages.some((p) => p.status === "failed") ||
  r.jsdelivr.status === "failed" ||
  r.clean.status === "failed";

const done = (part: ReleaseVerifyPart) => {
  part.status = part.problems.length > 0 ? "failed" : "ok";
};

/** Проверка одной версии в реестре: тег, архив, подпись и кто выложил. */
export function publicationProblems(o: {
  p: Packument;
  doc: NpmVersionDoc;
  prov: Provenance | undefined;
  tag: string;
  /** Этот запуск выпускал пакет: архив — ровно из плана, коммит — коммит плана. */
  planned?: { integrity: string; commit: string | null };
  entry: ReleaseVerifyEntry;
}): void {
  const { p, doc, prov, entry } = o;
  entry.tagged = p.distTags[o.tag];
  entry.latest = p.distTags.latest;
  if (entry.tagged !== doc.version) {
    entry.problems.push(
      `под тегом ${o.tag} — ${entry.tagged ?? "ничего"}, а не ${doc.version}: npm ещё проверяет версию или публикация не прошла — повторите «Проверку» позже`,
    );
  }
  if (o.planned) {
    if (doc.integrity !== o.planned.integrity) {
      entry.problems.push(
        `архив в npm — не тот, что собрала «Подготовка»: ${doc.integrity ?? "—"}, а в плане ${o.planned.integrity}`,
      );
    }
  } else {
    entry.notes.push(
      "вышел раньше этого запуска: его архив «Подготовка» сверила со сборкой файл в файл",
    );
  }
  if (doc.attestationsUrl === undefined) {
    entry.problems.push(`у версии ${doc.version} нет подписи provenance`);
  } else if (prov === undefined) {
    entry.problems.push(
      `подпись provenance версии ${doc.version} не прочитать: npm ещё готовит её — повторите «Проверку» позже`,
    );
  } else {
    entry.provenance = prov;
    if (prov.repository !== NPM_REPOSITORY) {
      entry.problems.push(
        `provenance: репозиторий ${prov.repository ?? "—"}, а не ${NPM_REPOSITORY}`,
      );
    }
    if (prov.workflow !== RELEASE_WORKFLOW) {
      entry.problems.push(
        `provenance: workflow ${prov.workflow ?? "—"}, а не ${RELEASE_WORKFLOW}`,
      );
    }
    if (prov.ref !== NPM_PUBLISH_REF) {
      entry.problems.push(
        `provenance: ветка ${prov.ref ?? "—"}, а не ${NPM_PUBLISH_REF}`,
      );
    }
    if (
      doc.integrity === undefined ||
      prov.sha512 !== integrityHex(doc.integrity)
    ) {
      entry.problems.push(
        "provenance подписывает другой архив: SHA-512 не совпадает с реестром",
      );
    }
    if (o.planned?.commit && prov.commit !== o.planned.commit) {
      entry.problems.push(
        `provenance: коммит ${prov.commit ?? "—"}, а запуск собирал ${o.planned.commit}`,
      );
    }
  }
  entry.publisher = doc.trustedPublisher === undefined ? "token" : "trusted";
  if (entry.publisher === "token") {
    if (firstPublished(p) === doc.version) {
      entry.notes.push(
        "первая версия выложена временным токеном — так и задумано: доверенную публикацию npm включает только у существующего пакета",
      );
    } else {
      entry.problems.push(
        `версия ${doc.version} выложена токеном, а не доверенной публикацией: проверьте на npmjs.com Trusted Publisher и Publishing access`,
      );
    }
  }
  if (entry.latest !== undefined && entry.latest !== doc.version) {
    entry.notes.push(
      `latest → ${entry.latest}: до запуска так и есть, свежая версия — под тегом ${o.tag}`,
    );
  }
}

/** npm ls --all --json: дерево зависимостей, даже если npm вышел с кодом 1. */
async function npmTree(dir: string): Promise<LsNode> {
  const output = await run("npm", ["ls", "--all", "--json"], dir).catch(
    (e: Error) => e.message.slice(e.message.indexOf("\n") + 1),
  );
  return JSON.parse(
    output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1),
  ) as LsNode;
}

/** Скрипт чистого проекта: иконка из npm-пакета React, данные — с живых хостов, HTML — в stdout. */
const RENDER = (icon: string) => `import { createElement } from "react";
import server from "react-dom/server";
import { Icon, IconavoProvider, loadIcons } from "@iconavo-ui/react";
import "@iconavo-ui/icon";

const icons = await loadIcons([${JSON.stringify(icon)}]);
const html = server.renderToString(
  createElement(IconavoProvider, { icons }, createElement(Icon, { icon: ${JSON.stringify(icon)} })),
);
process.stdout.write(html);
`;

/** Чистый проект: пакеты этой версии из реестра npm в пустой папке — и иконка на экране. */
async function cleanProject(
  o: VerifyReleaseOptions,
  part: ReleaseVerifyReport["clean"],
): Promise<void> {
  const version = o.plan.version;
  const dir = join(o.root, CLEAN_DIR);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "iconavo-clean-install", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  const wanted = [
    `@iconavo-ui/icon@${version}`,
    `@iconavo-ui/react@${version}`,
    `react@${CLEAN_REACT}`,
    `react-dom@${CLEAN_REACT}`,
  ];
  o.log?.(`Чистый проект: npm install ${wanted.join(" ")}…`);
  try {
    await run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--ignore-scripts", ...wanted],
      dir,
    );
  } catch (e) {
    part.problems.push(
      `npm install не удался: ${(e as Error).message.split("\n").slice(0, 4).join(" ")}`,
    );
    return;
  }
  const fromRegistry = (r: string) =>
    r.startsWith("https://registry.npmjs.org/");
  const installed = installVerdict(
    await npmTree(dir),
    ["@iconavo-ui/core", "@iconavo-ui/icon", "@iconavo-ui/react"].map(
      (name) => ({
        name,
        version,
        resolved: fromRegistry,
      }),
    ),
  );
  if (installed.ok === true) part.notes.push(installed.note);
  else part.problems.push(`установка: ${installed.note}`);
  try {
    await run("npm", ["audit", "signatures"], dir);
    part.notes.push(
      "npm audit signatures: подписи реестра и provenance проверены",
    );
  } catch (e) {
    part.problems.push(
      `npm audit signatures: ${(e as Error).message.split("\n").slice(0, 4).join(" ")}`,
    );
  }
  await writeFile(join(dir, "render.mjs"), RENDER(CLEAN_ICON), "utf8");
  let html: string;
  try {
    html = await run("node", ["render.mjs"], dir);
  } catch (e) {
    part.problems.push(
      `Node не нарисовал иконку: ${(e as Error).message.split("\n").slice(0, 4).join(" ")}`,
    );
    return;
  }
  const [set, name] = CLEAN_ICON.split(":") as [string, string];
  const data = JSON.parse(
    await readFile(join(o.root, "data", set, "icons.json"), "utf8"),
  ) as {
    width?: number;
    height?: number;
    icons: Record<string, { body: string }>;
  };
  const body = data.icons[name]?.body ?? "";
  const svg = /<svg[\s\S]*<\/svg>/.exec(html)?.[0];
  if (svg === undefined) {
    part.problems.push(`в HTML нет <svg>: ${html.slice(0, 200)}`);
  } else if (body === "" || !svg.includes(body)) {
    part.problems.push(
      `${CLEAN_ICON}: рисунок не тот, что в data/ — ${svg.slice(0, 200)}`,
    );
  } else if (
    !svg.includes(`viewBox="0 0 ${data.width ?? 16} ${data.height ?? 16}"`)
  ) {
    part.problems.push(`${CLEAN_ICON}: viewBox не тот — ${svg.slice(0, 200)}`);
  } else {
    part.svg = svg;
    part.notes.push(
      `${CLEAN_ICON} нарисован: loadIcons с живых хостов → IconavoProvider и Icon → renderToString`,
    );
  }
}

export async function verifyRelease(
  o: VerifyReleaseOptions,
): Promise<ReleaseVerifyReport> {
  const plan = o.plan;
  const waitMs = o.waitMs ?? 0;
  const sleep =
    o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const fetchFn = o.fetch ?? fetch;
  // Срок один на весь запуск: пакеты вышли вместе, и npm проверяет их одновременно.
  const deadline = now() + waitMs;
  const report: ReleaseVerifyReport = {
    version: plan.version,
    tag: plan.tag,
    packages: [],
    jsdelivr: {
      status: "skipped",
      url: scriptUrl(plan.version),
      problems: [],
      notes: [],
    },
    clean: { status: "skipped", problems: [], notes: [] },
  };

  for (const planned of plan.packages) {
    const entry: ReleaseVerifyEntry = {
      name: planned.name,
      version: plan.version,
      status: "failed",
      problems: [],
      notes: [],
    };
    report.packages.push(entry);
    try {
      let p: Packument | undefined;
      let doc: NpmVersionDoc | undefined;
      let prov: Provenance | undefined;
      for (;;) {
        p = await o.registry.packument(planned.name);
        doc = p?.versions.get(plan.version);
        prov = undefined;
        const arrived =
          doc !== undefined && p?.distTags[plan.tag] === plan.version;
        if (arrived && doc?.attestationsUrl !== undefined) {
          prov = await o.registry.provenance(doc);
        }
        if (arrived && prov !== undefined) break;
        const left = deadline - now();
        if (left <= 0) break;
        log(
          `${planned.name}: жду, пока реестр покажет ${plan.version} и её подпись…`,
        );
        await sleep(Math.min(o.pollMs ?? NPM_POLL_MS, left));
      }
      if (p === undefined || doc === undefined) {
        entry.problems.push(
          `${plan.version} нет в npm: npm ещё проверяет новую версию (это занимает минуты) или публикация не прошла — повторите «Проверку» позже`,
        );
      } else {
        publicationProblems({
          p,
          doc,
          prov,
          tag: plan.tag,
          ...(planned.publish
            ? { planned: { integrity: planned.integrity, commit: plan.commit } }
            : {}),
          entry,
        });
      }
    } catch (e) {
      entry.problems.push((e as Error).message);
    }
    entry.status = entry.problems.length > 0 ? "failed" : "ok";
  }

  // jsDelivr берёт новую версию из npm по первому запросу и не сразу: 404 — подождать и спросить снова.
  const js = report.jsdelivr;
  for (;;) {
    try {
      const res = await fetchFn(js.url, {
        headers: { "cache-control": "no-cache" },
      });
      if (res.status === 200) {
        const body = new Uint8Array(await res.arrayBuffer());
        const got = sri(body);
        if (got !== plan.script.integrity) {
          js.problems.push(
            `jsDelivr отдаёт скрипт с хэшем ${got}, а в README — ${plan.script.integrity}`,
          );
        } else js.notes.push(`скрипт с хэшем из README, ${body.length} Б`);
        if (res.headers.get("access-control-allow-origin") !== "*") {
          js.problems.push(
            `jsDelivr без Access-Control-Allow-Origin: * — модульный скрипт с другого сайта не загрузится`,
          );
        }
        break;
      }
      if (res.status !== 404) {
        js.problems.push(`jsDelivr ответил ${res.status}`);
        break;
      }
    } catch (e) {
      js.notes.push(`сбой сети: ${(e as Error).message}`);
    }
    const left = deadline - now();
    if (left <= 0) {
      js.problems.push(
        "jsDelivr не отдаёт скрипт этой версии: он берёт её из npm не сразу — повторите «Проверку» позже; если не поможет — purge.jsdelivr.net",
      );
      break;
    }
    log("jsDelivr: жду скрипт новой версии…");
    await sleep(Math.min(o.jsdelivrPollMs ?? JSDELIVR_POLL_MS, left));
  }
  done(js);

  if (o.clean !== false) {
    try {
      await cleanProject(o, report.clean);
    } catch (e) {
      report.clean.problems.push((e as Error).message);
    }
    done(report.clean);
  }
  return report;
}
