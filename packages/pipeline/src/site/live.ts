// Проверка живого сайта iconavo.dev (ADR-0050): после выкладки — та ли сборка отвечает, все страницы,
// коды и переходы, заголовки и noindex, языки (фаза 4, шаг 1), иконки в HTML, ссылки, переход с www и с
// http, robots.txt. Только HTTP, ключи не нужны; запускает workflow «Сайт» после «Выкладки» и
// pnpm site --live.

import { fail, pass, type Verdict } from "../sandbox/verdict.js";
import {
  CRAWL_EXTRAS,
  DEFAULT_ICON_HOSTS,
  LIVE_WAIT_MS,
  MISSING_PATHS,
  REDIRECT_STATUS,
  REDIRECTS,
} from "./config.js";
import {
  type CrawledPage,
  crawl,
  headersVerdict,
  htmlPages,
  langVerdict,
  linksVerdict,
  robotsMetaVerdict,
  searchFormVerdict,
  sectionsVerdict,
  statusVerdict,
  switchVerdict,
} from "./crawl.js";

export interface LiveRow {
  what: string;
  verdict: Verdict;
}

/** Переход: ответ 301 или 308 ровно на этот адрес. */
async function redirectVerdict(from: string, to: string): Promise<Verdict> {
  try {
    const response = await fetch(from, { redirect: "manual" });
    const location = response.headers.get("location") ?? "";
    return [301, 308].includes(response.status) &&
      new URL(location, from).href === to
      ? pass(`${response.status} → ${to}`)
      : fail(`${response.status} → ${location || "без адреса"}, а нужно ${to}`);
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** Ждать, пока /docs ответит этой сборкой: Vercel переключает домен не сразу. */
async function waitForBuild(base: string, build: string): Promise<string> {
  const deadline = Date.now() + LIVE_WAIT_MS;
  let seen = "";
  for (;;) {
    try {
      const response = await fetch(`${base}/docs`, { cache: "no-store" });
      await response.arrayBuffer();
      seen = response.headers.get("x-iconavo-build") ?? "";
      if (seen === build) return seen;
    } catch {
      // Сеть моргнула — следующая попытка.
    }
    if (Date.now() > deadline) return seen;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

export async function checkLiveSite(o: {
  base: string;
  expectBuild?: string;
  sections: string[];
  log?: (line: string) => void;
}): Promise<LiveRow[]> {
  const rows: LiveRow[] = [];
  if (o.expectBuild) {
    o.log?.(`Жду сборку ${o.expectBuild} на ${o.base}/docs…`);
    const seen = await waitForBuild(o.base, o.expectBuild);
    rows.push({
      what: "Сборка",
      verdict:
        seen === o.expectBuild
          ? pass(`отвечает ${seen}`)
          : fail(
              `за ${LIVE_WAIT_MS / 1000} с — ${seen || "без метки"}, а ждали ${o.expectBuild}`,
            ),
    });
  }
  o.log?.("Обхожу страницы…");
  const pages: CrawledPage[] = await crawl(o.base, CRAWL_EXTRAS);
  const html = htmlPages(pages);
  rows.push({
    what: "Страницы",
    verdict: statusVerdict(pages, {
      missing: MISSING_PATHS,
      redirects: REDIRECTS,
      redirect: REDIRECT_STATUS,
    }),
  });
  // Переходы — без заголовков сайта: их код и адрес проверяет строка «Страницы».
  const headerProblems = pages
    .filter(
      (p) => p.path !== "/robots.txt" && (p.status < 300 || p.status >= 400),
    )
    .flatMap((p) =>
      headersVerdict(p, {
        production: true,
        hosts: DEFAULT_ICON_HOSTS,
        build: o.expectBuild,
      }).map((x) => `${p.path}: ${x}`),
    );
  rows.push({
    what: "Заголовки",
    verdict:
      headerProblems.length === 0
        ? pass(
            "noindex, защита и CSP с хостами иконок по умолчанию — у всех ответов",
          )
        : fail([...new Set(headerProblems)].slice(0, 5).join("; ")),
  });
  const robots = html.filter((p) => robotsMetaVerdict(p.html).ok !== true);
  rows.push({
    what: "Метка robots",
    verdict:
      robots.length === 0
        ? pass(`на всех ${html.length} страницах`)
        : fail(robots.map((p) => p.path).join(", ")),
  });
  const noIcons = html.filter(
    (p) => !/<svg\b[^>]*viewBox="[^"]+"[^>]*>\s*<[a-z]/.test(p.html),
  );
  rows.push({
    what: "Иконки в серверном HTML",
    verdict:
      noIcons.length === 0
        ? pass(`на всех ${html.length} страницах`)
        : fail(
            `без нарисованных иконок: ${noIcons.map((p) => p.path).join(", ")}`,
          ),
  });
  rows.push({ what: "Язык страниц", verdict: langVerdict(pages) });
  rows.push({ what: "Переключатель языка", verdict: switchVerdict(pages) });
  rows.push({ what: "Поиск в шапке", verdict: searchFormVerdict(pages) });
  rows.push({
    what: "Разделы README",
    verdict: sectionsVerdict(pages, o.sections),
  });
  rows.push({ what: "Ссылки и якоря", verdict: linksVerdict(pages) });
  const server = pages.find((p) => p.path === "/")?.headers.server ?? "";
  rows.push({
    what: "Хостинг",
    verdict: /vercel/i.test(server)
      ? pass(`Server: ${server}`)
      : fail(`Server: ${server || "нет"}`),
  });
  const robotsTxt = pages.find((p) => p.path === "/robots.txt");
  rows.push({
    what: "robots.txt",
    verdict:
      robotsTxt &&
      robotsTxt.status === 200 &&
      !/^disallow:\s*\/\s*$/im.test(robotsTxt.html)
        ? pass("обход разрешён — поисковик увидит noindex")
        : fail(
            robotsTxt
              ? `${robotsTxt.status}: ${robotsTxt.html.slice(0, 80)}`
              : "не открыт",
          ),
  });
  const apex = new URL(o.base);
  rows.push({
    what: "www → iconavo.dev",
    verdict: await redirectVerdict(
      `https://www.${apex.host}/docs`,
      `${apex.origin}/docs`,
    ),
  });
  rows.push({
    what: "http → https",
    verdict: await redirectVerdict(
      `http://${apex.host}/docs`,
      `${apex.origin}/docs`,
    ),
  });
  return rows;
}

export const liveFailed = (rows: LiveRow[]) =>
  rows.some((r) => r.verdict.ok === false);
