// Проверка сайта (фаза 3, шаг 10; ADR-0050): продакшен-сборка на этом компьютере, хосты иконок — превью
// API. Сначала обход по HTTP — коды, заголовки, ссылки, разделы README, — затем каждая страница в Chrome,
// Firefox и WebKit по очереди: иконки в серверном HTML, консоль и нарушения CSP, заголовки страницы,
// ссылка «к содержимому», axe-core в светлой и тёмной теме, ширина телефона. Контрольный запуск
// подкладывает поломки — каждую проверка обязана заметить.

import type { Browser } from "playwright";
import { canaryVerdict } from "../example/check.js";
import { type AxeViolation, axe, axeVerdict, runAxe } from "../sandbox/axe.js";
import {
  BROWSER_TITLES,
  type BrowserName,
  launchBrowser,
} from "../sandbox/browser.js";
import {
  fail,
  pass,
  recordViolations,
  shot,
  type Verdict,
  violations,
  watch,
} from "../sandbox/verdict.js";
import { DESKTOP, PHONE } from "./config.js";
import {
  type CrawledPage,
  headersVerdict,
  linksVerdict,
  robotsMetaVerdict,
  sectionsVerdict,
} from "./crawl.js";

export const CHECKS = [
  ["static", "Все страницы собраны заранее (статические)"],
  ["status", "Страницы отвечают 200, несуществующая — 404"],
  [
    "headers",
    "Заголовки: noindex, защита, метка сборки; CSP — стили только файлами, соединения — только с хостами иконок",
  ],
  [
    "robots",
    'Метка <meta name="robots" content="noindex, nofollow"> — ровно одна',
  ],
  ["sections", "Каждый раздел README — ровно на одной странице"],
  ["links", "Ссылки и якоря ведут на существующие страницы и заголовки"],
  [
    "html",
    "Серверный HTML без JavaScript: иконки нарисованы, атрибутов style нет",
  ],
  [
    "inline",
    "Иконки в строке текста: базовые стили Tailwind не делают их блоками",
  ],
  [
    "console",
    "Консоль и CSP: ни ошибок, ни предупреждений, ни нарушений политики",
  ],
  ["outline", "Один h1, уровни заголовков без пропусков"],
  ["skip", "Ссылка «Skip to content» — первая по Tab и ведёт к main"],
  ["axe", "Доступность (axe-core, WCAG 2.2 A и AA): светлая и тёмная тема"],
  ["phone", "Ширина 375 px: без горизонтальной прокрутки"],
  ["copy", "Кнопка Copy копирует код"],
  ["canary", "Контрольный запуск: каждая подложенная поломка замечена"],
] as const;

export type CheckId = (typeof CHECKS)[number][0];

export interface SiteResult {
  browser: BrowserName;
  failure?: string;
  verdicts: Partial<Record<CheckId, Verdict>>;
  shots: { title: string; png: string }[];
}

export interface SiteCheckOptions {
  base: string;
  /** Хосты иконок, к которым страница может обращаться: превью API. */
  hosts: string[];
  pages: CrawledPage[];
  /** Пути, которые Next.js собрал заранее (prerender-manifest.json). */
  prerendered: string[];
  /** Разделы README, которые должны быть на сайте. */
  sections: string[];
  browsers: readonly BrowserName[];
  log?: (line: string) => void;
}

/** Проверки по HTTP — одни на все браузеры. */
export function httpVerdicts(
  o: SiteCheckOptions,
): Partial<Record<CheckId, Verdict>> {
  const ok = o.pages.filter((p) => p.status === 200);
  const notOk = o.pages.filter(
    (p) => p.status !== 200 && p.path !== "/__missing__",
  );
  const missing = o.pages.find((p) => p.path === "/__missing__");
  const htmlPages = ok.filter((p) => p.path !== "/robots.txt");
  const notStatic = htmlPages.filter((p) => !o.prerendered.includes(p.path));
  const headerProblems = o.pages.flatMap((p) =>
    p.path === "/robots.txt"
      ? []
      : headersVerdict(p, { production: true, hosts: o.hosts }).map(
          (x) => `${p.path}: ${x}`,
        ),
  );
  const robots = htmlPages
    .map((p) => [p.path, robotsMetaVerdict(p.html)] as const)
    .filter(([, v]) => v.ok !== true);
  return {
    static:
      notStatic.length === 0
        ? pass(`${htmlPages.length} страниц — статические`)
        : fail(
            `собраны по запросу: ${notStatic.map((p) => p.path).join(", ")}`,
          ),
    status:
      notOk.length === 0 && missing?.status === 404
        ? pass(`${ok.length} страниц — 200, /__missing__ — 404`)
        : fail(
            [
              ...notOk.map((p) => `${p.path} — ${p.status}`),
              missing?.status === 404
                ? ""
                : `/__missing__ — ${missing?.status}`,
            ]
              .filter(Boolean)
              .join("; "),
          ),
    headers:
      headerProblems.length === 0
        ? pass(`у всех ${o.pages.length - 1} ответов`)
        : fail([...new Set(headerProblems)].slice(0, 5).join("; ")),
    robots:
      robots.length === 0
        ? pass(`на всех ${htmlPages.length} страницах`)
        : fail(robots.map(([path, v]) => `${path}: ${v.note}`).join("; ")),
    sections: sectionsVerdict(o.pages, o.sections),
    links: linksVerdict(o.pages),
  };
}

/**
 * Иконки страницы: нарисованы ли и не стали ли блоками. В строке текста — только иконки, чей родитель
 * не flex и не grid: их элементы браузер и так делает блоками, так устроен CSS. Выполняется в браузере.
 */
function iconFacts() {
  const svgs = [...document.querySelectorAll("body svg")];
  const inText = (svg: Element) =>
    !/flex|grid/.test(
      svg.parentElement ? getComputedStyle(svg.parentElement).display : "",
    );
  return {
    total: svgs.length,
    drawn: svgs.filter(
      (s) => s.hasAttribute("viewBox") && s.childNodes.length > 0,
    ).length,
    blocks: svgs.filter(
      (s) => inText(s) && getComputedStyle(s).display === "block",
    ).length,
    styled: document.querySelectorAll("body [style]").length,
  };
}

/** Заголовки страницы: один h1, уровни без пропусков. Выполняется в браузере. */
function outlineFacts(): string[] {
  const problems: string[] = [];
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const h1 = headings.filter((h) => h.tagName === "H1").length;
  if (h1 !== 1) problems.push(`h1: ${h1}`);
  let level = 0;
  for (const h of headings) {
    const next = Number(h.tagName[1]);
    if (level > 0 && next > level + 1) {
      problems.push(
        `после h${level} сразу h${next}: «${h.textContent?.trim()}»`,
      );
    }
    level = next;
  }
  return problems;
}

/** Страницы без JavaScript: серверный HTML. */
async function checkServerHtml(
  browser: Browser,
  o: SiteCheckOptions,
  result: SiteResult,
) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: DESKTOP,
  });
  const page = await context.newPage();
  const problems: string[] = [];
  let icons = 0;
  for (const p of o.pages.filter(
    (p) => p.status === 200 && p.path !== "/robots.txt",
  )) {
    await page.goto(`${o.base}${p.path}`, { waitUntil: "load" });
    const facts = await page.evaluate(iconFacts);
    icons += facts.drawn;
    if (facts.total === 0) problems.push(`${p.path}: иконок нет`);
    if (facts.drawn < facts.total)
      problems.push(`${p.path}: нарисовано ${facts.drawn} из ${facts.total}`);
    if (facts.styled > 0)
      problems.push(`${p.path}: атрибутов style — ${facts.styled}`);
  }
  result.verdicts.html =
    problems.length === 0
      ? pass(`${icons} иконок нарисованы ещё на сервере`)
      : fail(problems.join("; "));
  await context.close();
}

/** Каждая страница в браузере: консоль, CSP, иконки в строке, заголовки, axe, телефон. */
async function checkPages(
  browser: Browser,
  name: BrowserName,
  o: SiteCheckOptions,
  result: SiteResult,
) {
  const v = result.verdicts;
  const paths = o.pages
    .filter((p) => p.status === 200 && p.path !== "/robots.txt")
    .map((p) => p.path);
  const consoleProblems: string[] = [];
  const outline: string[] = [];
  const inline: string[] = [];
  const axePages: { path: string; violations: AxeViolation[] }[] = [];
  const phone: string[] = [];
  const source = await axe();
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: DESKTOP,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    const seen = watch(page);
    await recordViolations(page);
    for (const path of paths) {
      await page.goto(`${o.base}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(300);
      if (scheme === "light") {
        const facts = await page.evaluate(iconFacts);
        if (facts.blocks > 0) inline.push(`${path}: блоком — ${facts.blocks}`);
        outline.push(
          ...(await page.evaluate(outlineFacts)).map((x) => `${path}: ${x}`),
        );
        consoleProblems.push(
          ...(await violations(page)).map((x) => `${path}: CSP ${x}`),
        );
      }
      await runAxe(
        page,
        source,
        `${path} (${scheme === "light" ? "светлая" : "тёмная"})`,
        axePages,
      );
      if (path === "/docs" || path === "/") {
        result.shots.push({
          title: `${path} — ${scheme === "light" ? "светлая" : "тёмная"} тема`,
          png: await shot(page, seen),
        });
      }
    }
    consoleProblems.push(
      ...[...new Set(seen.warnings)].map((w) => `предупреждение: ${w}`),
      ...[...new Set(seen.errors)].map((e) => `ошибка: ${e}`),
    );
    await context.close();
  }
  v.inline =
    inline.length === 0
      ? pass("ни одна иконка не стала блоком")
      : fail(inline.join("; "));
  v.outline =
    outline.length === 0
      ? pass(`${paths.length} страниц`)
      : fail(outline.slice(0, 5).join("; "));
  v.console =
    consoleProblems.length === 0
      ? pass("ни ошибок, ни предупреждений, ни нарушений")
      : fail(consoleProblems.slice(0, 5).join("; "));
  v.axe = axeVerdict(axePages);

  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  const seen = watch(page);
  for (const path of paths) {
    await page.goto(`${o.base}${path}`, { waitUntil: "load" });
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    if (width > PHONE.width) phone.push(`${path}: ${width} px`);
    if (path === "/docs") {
      result.shots.push({
        title: "/docs — телефон, 375 px",
        png: await shot(page, seen),
      });
    }
  }
  v.phone =
    phone.length === 0
      ? pass(`${paths.length} страниц помещаются в 375 px`)
      : fail(phone.join("; "));

  // «Skip to content» — первая остановка Tab, ведёт к main#content. WebKit, как Safari, по Tab ходит
  // только по полям форм, а ссылки — по Option+Tab, которого у Playwright нет: там — первый в порядке
  // фокуса элемент страницы.
  await page.goto(`${o.base}/docs`, { waitUntil: "load" });
  if (name !== "webkit") await page.keyboard.press("Tab");
  const skip = await page.evaluate((byTab) => {
    const first = byTab
      ? document.activeElement
      : document.querySelector(
          "a[href], button, summary, input, select, textarea, [tabindex]:not([tabindex='-1'])",
        );
    return {
      text: first?.textContent?.trim() ?? "",
      href: first?.getAttribute("href") ?? "",
      target: document.querySelector("main#content") !== null,
    };
  }, name !== "webkit");
  const how =
    name === "webkit"
      ? "первая в порядке фокуса (WebKit по Tab ходит только по полям форм)"
      : "первая по Tab";
  v.skip =
    skip.text === "Skip to content" && skip.href === "#content" && skip.target
      ? pass(`${how}, ведёт к main#content`)
      : fail(
          `${how} — «${skip.text}» (${skip.href}), main#content ${skip.target ? "есть" : "нет"}`,
        );
  await context.close();

  if (name === "chrome") {
    const copyContext = await browser.newContext({ viewport: DESKTOP });
    await copyContext.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: o.base,
    });
    const copyPage = await copyContext.newPage();
    await copyPage.goto(`${o.base}/docs`, { waitUntil: "load" });
    const expected = await copyPage
      .locator("figure.code pre")
      .first()
      .innerText();
    await copyPage.locator("figure.code button.copy").first().click();
    await copyPage.waitForTimeout(300);
    // Буфер Windows хранит переводы строк как \r\n.
    const copied = (
      await copyPage.evaluate(() => navigator.clipboard.readText())
    ).replace(/\r\n/g, "\n");
    const label = await copyPage
      .locator("figure.code button.copy")
      .first()
      .innerText();
    v.copy =
      copied === expected.replace(/\r\n/g, "\n") && label.includes("Copied")
        ? pass("код в буфере, на кнопке — «Copied»")
        : fail(
            `в буфере ${copied === expected ? "тот же код" : "другое"}, на кнопке «${label}»`,
          );
    await copyContext.close();
  } else {
    v.copy = { ok: null, note: "только Chrome — доступ к буферу" };
  }
}

/**
 * Контрольный запуск: поломки, которые проверки обязаны заметить, — кнопка без подписи (axe), атрибут
 * style (CSP), слишком широкий блок (телефон), убранная метка robots, битая ссылка и испорченный
 * заголовок до гидратации.
 */
async function checkCanary(
  browser: Browser,
  o: SiteCheckOptions,
  result: SiteResult,
) {
  const missed: string[] = [];
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await recordViolations(page);
  await page.goto(`${o.base}/docs`, { waitUntil: "load" });
  // Поломки — по очереди: нарушение CSP Firefox сообщает и в чужой вызов — в вставку скрипта axe.
  const insert = (html: string) =>
    page.evaluate((h) => {
      document.querySelector("main")?.insertAdjacentHTML("beforeend", h);
    }, html);
  await insert('<button type="button"></button>');
  const axePages: { path: string; violations: AxeViolation[] }[] = [];
  await runAxe(page, await axe(), "/docs", axePages);
  if (axeVerdict(axePages).ok !== false) missed.push("кнопка без подписи");
  await insert('<p style="color: red">styled</p>');
  await page.waitForTimeout(300);
  const blocked = (await violations(page)).some((x) => x.includes("style-src"));
  if (!blocked) missed.push("атрибут style");
  // Широкий блок — строка без пробелов в <pre>, без атрибутов стиля.
  await insert(`<pre>${"x".repeat(400)}</pre>`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  if (wide <= PHONE.width) missed.push("слишком широкий блок");
  // Иконка в строке текста без inline-block: базовые стили Tailwind делают её блоком.
  const blocksBefore = (await page.evaluate(iconFacts)).blocks;
  await page.evaluate(() => {
    document
      .querySelector("main")
      ?.insertAdjacentHTML(
        "beforeend",
        '<p>Text <svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg> text</p>',
      );
  });
  if ((await page.evaluate(iconFacts)).blocks <= blocksBefore) {
    missed.push("иконка-блок в строке");
  }
  const html = await page.content();
  const noRobots = html.replace(/<meta\b[^>]*name="robots"[^>]*>/g, "");
  if (robotsMetaVerdict(noRobots).ok !== false)
    missed.push("убранная метка robots");
  const broken = linksVerdict([
    ...o.pages,
    {
      path: "/__canary__",
      status: 200,
      headers: {},
      html: '<a href="/docs/__canary__">x</a><a href="/docs#__canary__">y</a>',
    },
  ]);
  if (broken.ok !== false) missed.push("битая ссылка");
  await context.close();

  const spoiled = await browser.newContext({ viewport: DESKTOP });
  const spoiledPage = await spoiled.newPage();
  const seen = watch(spoiledPage);
  await spoiledPage.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const h1 = document.querySelector("h1");
      if (h1?.textContent && !h1.textContent.endsWith(" (spoiled)")) {
        h1.textContent = `${h1.textContent} (spoiled)`;
        observer.disconnect();
      }
    });
    observer.observe(document, { subtree: true, childList: true });
  });
  await spoiledPage.goto(`${o.base}/docs`, { waitUntil: "load" });
  await spoiledPage.waitForTimeout(3000);
  if (canaryVerdict([...seen.errors, ...seen.warnings]).ok !== true) {
    missed.push("испорченный заголовок до гидратации");
  }
  await spoiled.close();
  result.verdicts.canary =
    missed.length === 0
      ? pass(
          "замечены все семь: кнопка без подписи, style, ширина, иконка-блок, robots, битая ссылка, гидратация",
        )
      : fail(`проверка слепая: не замечено — ${missed.join(", ")}`);
}

export async function checkSite(o: SiteCheckOptions): Promise<SiteResult[]> {
  const shared = httpVerdicts(o);
  const results: SiteResult[] = [];
  for (const name of o.browsers) {
    const result: SiteResult = {
      browser: name,
      verdicts: { ...shared },
      shots: [],
    };
    let browser: Browser | undefined;
    try {
      browser = await launchBrowser(name, true);
      o.log?.(`${BROWSER_TITLES[name]}: серверный HTML…`);
      await checkServerHtml(browser, o, result);
      o.log?.(`${BROWSER_TITLES[name]}: страницы, axe, телефон…`);
      await checkPages(browser, name, o, result);
      o.log?.(`${BROWSER_TITLES[name]}: контрольный запуск…`);
      await checkCanary(browser, o, result);
    } catch (e) {
      result.failure = (e as Error).message.split("\n")[0];
    } finally {
      await browser?.close();
    }
    results.push(result);
  }
  return results;
}

/** Провал: браузер не прошёл до конца или хоть одна проверка — «нет». */
export const siteCheckFailed = (results: SiteResult[]) =>
  results.length === 0 ||
  results.some(
    (r) =>
      r.failure !== undefined ||
      Object.values(r.verdicts).some((v) => v.ok === false),
  );
