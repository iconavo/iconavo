// Проверка сайта (фаза 3, шаг 10; ADR-0050): продакшен-сборка на этом компьютере, хосты иконок — превью
// API. Сначала обход по HTTP — коды, заголовки, языки, ссылки, разделы README, — затем каждая страница в
// Chrome, Firefox и WebKit по очереди: иконки в серверном HTML, консоль и нарушения CSP, заголовки
// страницы, ссылка «к содержимому», axe-core в светлой и тёмной теме, ширина телефона, меню темы
// (фаза 4, шаг 1). Контрольный запуск подкладывает поломки — каждую проверка обязана заметить.

import type { Browser, Page } from "playwright";
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
import {
  DESKTOP,
  MISSING_PATHS,
  PHONE,
  REDIRECT_STATUS,
  REDIRECTS,
  SKIP_TEXT,
  THEME_LABEL,
} from "./config.js";
import {
  type CrawledPage,
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

export const CHECKS = [
  ["static", "Все страницы собраны заранее (статические)"],
  [
    "status",
    "Страницы отвечают 200, несуществующие — 404, /ru/docs… — временный переход на /docs…",
  ],
  [
    "headers",
    "Заголовки: noindex, защита, метка сборки; CSP — стили только файлами, соединения — только с хостами иконок",
  ],
  [
    "robots",
    'Метка <meta name="robots" content="noindex, nofollow"> — ровно одна',
  ],
  ["lang", "Язык страницы: <html lang> по адресу — en или ru"],
  ["switch", "Переключатель языка ведёт на ту же страницу на другом языке"],
  ["search", "Поиск в шапке ведёт на страницу поиска своего языка"],
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
  [
    "skip",
    "Ссылка «к содержимому» — первая по Tab и ведёт к main, на английском и русском",
  ],
  ["axe", "Доступность (axe-core, WCAG 2.2 A и AA): светлая и тёмная тема"],
  ["phone", "Ширина 375 px: без горизонтальной прокрутки"],
  [
    "theme",
    "Меню темы с клавиатуры: светлая, тёмная, как в системе; тема — до отрисовки, без <style> и нарушений CSP, axe с открытым меню",
  ],
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
  const html = htmlPages(o.pages);
  const notStatic = html.filter((p) => !o.prerendered.includes(p.path));
  // У переходов из redirects() в next start нет заголовков сайта — их проверяет statusVerdict.
  const answers = o.pages.filter(
    (p) => p.path !== "/robots.txt" && (p.status < 300 || p.status >= 400),
  );
  const headerProblems = answers.flatMap((p) =>
    headersVerdict(p, { production: true, hosts: o.hosts }).map(
      (x) => `${p.path}: ${x}`,
    ),
  );
  const robots = html
    .map((p) => [p.path, robotsMetaVerdict(p.html)] as const)
    .filter(([, v]) => v.ok !== true);
  return {
    static:
      notStatic.length === 0
        ? pass(`${html.length} страниц — статические`)
        : fail(
            `собраны по запросу: ${notStatic.map((p) => p.path).join(", ")}`,
          ),
    status: statusVerdict(o.pages, {
      missing: MISSING_PATHS,
      redirects: REDIRECTS,
      redirect: REDIRECT_STATUS,
    }),
    headers:
      headerProblems.length === 0
        ? pass(`у всех ${answers.length} ответов`)
        : fail([...new Set(headerProblems)].slice(0, 5).join("; ")),
    robots:
      robots.length === 0
        ? pass(`на всех ${html.length} страницах`)
        : fail(robots.map(([path, v]) => `${path}: ${v.note}`).join("; ")),
    lang: langVerdict(o.pages),
    switch: switchVerdict(o.pages),
    search: searchFormVerdict(o.pages),
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
      if (path === "/docs" || path === "/" || path === "/ru") {
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
    if (path === "/docs" || path === "/ru") {
      result.shots.push({
        title: `${path} — телефон, 375 px`,
        png: await shot(page, seen),
      });
    }
  }
  v.phone =
    phone.length === 0
      ? pass(`${paths.length} страниц помещаются в 375 px`)
      : fail(phone.join("; "));

  // Ссылка «к содержимому» — первая остановка Tab, ведёт к main#content, на языке страницы. WebKit, как
  // Safari, по Tab ходит только по полям форм, а ссылки — по Option+Tab, которого у Playwright нет: там
  // — первый в порядке фокуса элемент страницы, поэтому ссылка обязана стоять в документе первой.
  const skipProblems: string[] = [];
  for (const [path, lang] of [
    ["/docs", "en"],
    ["/ru", "ru"],
  ] as const) {
    await page.goto(`${o.base}${path}`, { waitUntil: "load" });
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
    if (
      skip.text !== SKIP_TEXT[lang] ||
      skip.href !== "#content" ||
      !skip.target
    ) {
      skipProblems.push(
        `${path}: «${skip.text}» (${skip.href}), main#content ${skip.target ? "есть" : "нет"}`,
      );
    }
  }
  const how =
    name === "webkit"
      ? "первая в порядке фокуса (WebKit по Tab ходит только по полям форм)"
      : "первая по Tab";
  v.skip =
    skipProblems.length === 0
      ? pass(`${how} на /docs и /ru, ведёт к main#content`)
      : fail(`${how} — ${skipProblems.join("; ")}`);
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

/** Гидратация закончилась — у main есть данные React. */
async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main");
      return (
        main !== null &&
        Object.keys(main).some((key) => key.startsWith("__reactFiber$"))
      );
    },
    null,
    { timeout: 60_000 },
  );
}

/**
 * Скрипт до страницы: какая тема стояла, когда появился <body>. Скрипт темы в <head> обязан успеть
 * раньше — иначе первая отрисовка шла бы в теме системы и мигала. Выполняется в браузере.
 */
function recordThemeAtBody() {
  const observer = new MutationObserver(() => {
    if (!document.body) return;
    (window as unknown as { themeAtBody: string }).themeAtBody =
      document.documentElement.dataset.theme ?? "нет";
    observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
}

const themeAtBody = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { themeAtBody?: string }).themeAtBody ?? "",
  );

const themeAttr = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.theme ?? "нет");

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/**
 * Меню темы на главной, только с клавиатуры: в светлой системе — тёмная, в тёмной — светлая, затем «как
 * в системе». Свой контекст на каждую тему системы: выбор живёт в localStorage и не должен попасть в
 * проверки axe страниц. Открытое меню не добавляет элементов <style> (их запрещает CSP) и проходит axe.
 */
async function checkTheme(
  browser: Browser,
  o: SiteCheckOptions,
  result: SiteResult,
) {
  const problems: string[] = [];
  const axePages: { path: string; violations: AxeViolation[] }[] = [];
  const source = await axe();
  // Пункты меню по порядку: как в системе, светлая, тёмная — открытое с клавиатуры меню ставит фокус
  // на первый, и до нужного — столько нажатий ↓.
  for (const [scheme, title, steps, chosen] of [
    ["light", "светлая", 2, "dark"],
    ["dark", "тёмная", 1, "light"],
  ] as const) {
    const context = await browser.newContext({
      viewport: DESKTOP,
      colorScheme: scheme,
    });
    await context.addInitScript(recordThemeAtBody);
    const page = await context.newPage();
    const seen = watch(page);
    await recordViolations(page);
    await page.goto(`${o.base}/`, { waitUntil: "load" });
    await waitForHydration(page);
    const system = await background(page);
    const styles = () =>
      page.evaluate(() => document.querySelectorAll("style").length);
    const before = await styles();
    const trigger = page.getByRole("button", {
      name: THEME_LABEL.en,
      exact: true,
    });
    const menu = page.getByRole("menu");
    const open = async () => {
      await trigger.focus();
      await page.keyboard.press("Enter");
      await menu.waitFor();
    };
    // Фокус на кнопку Radix возвращает на следующем такте после закрытия меню — ждём до 2 с.
    const triggerFocused = async () =>
      page
        .waitForFunction(
          (el) => el === document.activeElement,
          await trigger.elementHandle(),
          { timeout: 2000 },
        )
        .then(
          () => true,
          () => false,
        );

    await open();
    if ((await styles()) > before) {
      problems.push(`система ${title}: открытое меню добавило <style>`);
    }
    await runAxe(page, source, `/ — меню темы, система ${title}`, axePages);
    if (scheme === "light") {
      result.shots.push({
        title: "/ — меню темы открыто",
        png: await shot(page, seen),
      });
    }
    for (let i = 0; i < steps; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await menu.waitFor({ state: "hidden" });
    const picked = await themeAttr(page);
    if (picked !== chosen) {
      problems.push(
        `система ${title}: выбрана тема «${picked}», а ждали «${chosen}»`,
      );
    }
    if ((await background(page)) === system) {
      problems.push(`система ${title} → ${chosen}: фон не изменился`);
    }
    if (!(await triggerFocused())) {
      problems.push(`система ${title}: после выбора фокус не на кнопке темы`);
    }
    await open();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    if (!(await triggerFocused())) {
      problems.push(`система ${title}: Esc не вернул фокус на кнопку темы`);
    }

    await page.reload({ waitUntil: "load" });
    const atBody = await themeAtBody(page);
    if (atBody !== chosen) {
      problems.push(
        `система ${title}: после перезагрузки при появлении <body> тема «${atBody}», а ждали «${chosen}»`,
      );
    }
    await waitForHydration(page);
    await open();
    await page.keyboard.press("Enter");
    await menu.waitFor({ state: "hidden" });
    if ((await themeAttr(page)) !== "нет") {
      problems.push(`система ${title}: «как в системе» не сняло data-theme`);
    }
    if ((await background(page)) !== system) {
      problems.push(`система ${title}: «как в системе» — фон не вернулся`);
    }
    problems.push(
      ...(await violations(page)).map((x) => `CSP: ${x}`),
      ...[...new Set(seen.errors)].map((e) => `ошибка: ${e}`),
      ...[...new Set(seen.warnings)].map((w) => `предупреждение: ${w}`),
    );
    await context.close();
  }
  const menuAxe = axeVerdict(axePages);
  if (menuAxe.ok === false)
    problems.push(`axe с открытым меню: ${menuAxe.note}`);
  result.verdicts.theme =
    problems.length === 0
      ? pass(
          "с клавиатуры: тёмная, светлая и как в системе; тема стоит до <body>; Esc и выбор возвращают фокус; без <style>, нарушений CSP и замечаний axe",
        )
      : fail(problems.slice(0, 5).join("; "));
}

/**
 * Контрольный запуск: поломки, которые проверки обязаны заметить, — кнопка без подписи (axe), атрибут
 * style (CSP), слишком широкий блок (телефон), убранная метка robots, битая ссылка, испорченный
 * заголовок до гидратации; с фазы 4 — чужой lang, страница без ссылки на другой язык, переход не туда и
 * страница без скрипта темы.
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
  // Поломки — после гидратации: иначе React убрал бы чужие узлы из main раньше, чем их увидит axe (так
  // было на машине CI).
  await waitForHydration(page);
  // И по очереди: нарушение CSP Firefox сообщает и в чужой вызов — во вставку скрипта axe.
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
  // Языки и переходы — те же функции, что у проверок по HTTP.
  const canaryPage = (path: string, html: string): CrawledPage => ({
    path,
    status: 200,
    headers: {},
    html,
  });
  if (
    langVerdict([canaryPage("/ru/__canary__", '<html lang="en">')]).ok !== false
  ) {
    missed.push("чужой lang");
  }
  if (switchVerdict([canaryPage("/__canary__", "<p></p>")]).ok !== false) {
    missed.push("страница без ссылки на другой язык");
  }
  if (
    statusVerdict(
      [
        ...o.pages.filter((p) => p.path !== "/ru/docs"),
        {
          path: "/ru/docs",
          status: 308,
          headers: { location: "/ru" },
          html: "",
        },
      ],
      {
        missing: MISSING_PATHS,
        redirects: REDIRECTS,
        redirect: REDIRECT_STATUS,
      },
    ).ok !== false
  ) {
    missed.push("переход не туда");
  }
  await context.close();

  // Страница без скрипта темы в <head>: выбранная тёмная тема обязана не успеть к появлению <body>.
  const noScript = await browser.newContext({ viewport: DESKTOP });
  await noScript.addInitScript(() => {
    localStorage.setItem("iconavo-theme", "dark");
  });
  await noScript.addInitScript(recordThemeAtBody);
  const noScriptPage = await noScript.newPage();
  await noScriptPage.route(`${o.base}/`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /<script>try\{var t=localStorage[\s\S]*?<\/script>/,
      "",
    );
    await route.fulfill({ response, body });
  });
  await noScriptPage.goto(`${o.base}/`, { waitUntil: "load" });
  if ((await themeAtBody(noScriptPage)) === "dark") {
    missed.push("страница без скрипта темы");
  }
  await noScript.close();

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
          "замечены все одиннадцать: кнопка без подписи, style, ширина, иконка-блок, robots, битая ссылка, гидратация, чужой lang, нет ссылки на другой язык, переход не туда, нет скрипта темы",
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
      o.log?.(`${BROWSER_TITLES[name]}: меню темы…`);
      await checkTheme(browser, o, result);
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
