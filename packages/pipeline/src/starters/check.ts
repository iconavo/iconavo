// Проверка живых примеров в браузерах (фаза 3, шаг 10; ADR-0050): страница рабочей копии примера в
// Chrome, Firefox и WebKit по очереди. Примеры без меток для проверки — она смотрит, как разработчик:
// все иконки нарисованы, текст не прыгает, у Next.js иконки обёртки уже в серверном HTML и не мигают,
// консоль чистая, запросы — только к хостам иконок (за них отвечает превью API) и к скрипту тега.
// Контрольные запуски — хосты иконок не отвечают и испорченный HTML до гидратации — должны быть
// замечены: так видно, что проверка не слепая.

import type { Browser, BrowserContext, Page } from "playwright";
import { canaryVerdict } from "../example/check.js";
import { type AxeViolation, axe, axeVerdict, runAxe } from "../sandbox/axe.js";
import {
  BROWSER_TITLES,
  type BrowserName,
  launchBrowser,
} from "../sandbox/browser.js";
import {
  fail,
  layoutVerdict,
  pass,
  type Spot,
  shot,
  type Verdict,
  watch,
} from "../sandbox/verdict.js";
import {
  DRAW_TIMEOUT_MS,
  SCRIPT_DELAY_MS,
  STARTER_TITLES,
  type StarterId,
  VIEWPORT,
} from "./config.js";
import { routeHosts, type Traffic } from "./hosts.js";

/** Как запущен пример: HTML — файлы как есть, остальные — режим разработки или продакшен-сборка. */
export type StarterMode = "static" | "dev" | "prod";

export const STARTER_MODES: Record<StarterId, readonly StarterMode[]> = {
  html: ["static"],
  react: ["dev", "prod"],
  next: ["dev", "prod"],
};

export const MODE_TITLES: Record<StarterMode, string> = {
  static: "без сборки",
  dev: "разработка",
  prod: "продакшен",
};

export const CHECKS = [
  [
    "pack",
    "Архивы пакетов: только package.json, README, LICENSE и dist/, без workspace:",
  ],
  [
    "install",
    "Установка: каждый наш пакет — одной копией, из архивов этой ветки (с --npm — из реестра npm)",
  ],
  ["build", "Сборка примера (npm run build) без ошибок"],
  [
    "drawn",
    "Иконки нарисованы: у каждой viewBox и рисунок, заглушек и рамок не осталось",
  ],
  [
    "reserve",
    "Место до загрузки скрипта тега: текст рядом с иконками не сдвинулся",
  ],
  [
    "html",
    "Серверный HTML без JavaScript: иконки обёртки нарисованы, остальные — пустое место нужного размера, без атрибутов style",
  ],
  [
    "noflash",
    "Без мигания: иконки из серверного HTML при гидратации не меняются",
  ],
  ["console", "Консоль: ни ошибок, ни предупреждений"],
  [
    "network",
    "Сеть: только хосты иконок и скрипт тега — у браузера и у сервера Next.js",
  ],
  ["label", "Подпись: обе кнопки из README называются «Delete»"],
  ["axe", "Доступность (axe-core, WCAG 2.2 A и AA): ни одного нарушения"],
  [
    "canary",
    "Контрольный запуск: хосты иконок не отвечают — пустые иконки замечены",
  ],
  [
    "canaryHydration",
    "Контрольный запуск: испорченный HTML до гидратации — ошибка замечена",
  ],
] as const;

export type CheckId = (typeof CHECKS)[number][0];

export interface StarterResult {
  starter: StarterId;
  mode: StarterMode;
  browser: BrowserName;
  /** Браузер не запустился или страница не открылась — почему. */
  failure?: string;
  verdicts: Partial<Record<CheckId, Verdict>>;
  shots: { title: string; png: string }[];
}

export interface PageCheckOptions {
  starter: StarterId;
  mode: StarterMode;
  /** Адрес рабочей копии: http://127.0.0.1:порт. */
  base: string;
  /** Живой хост → превью (origins.ts); null — живые хосты как есть (--npm). */
  map: Record<string, string> | null;
  /** Скрипт тега для HTML-примера: адрес из README и файл из архива этой ветки. */
  script?: { url: string; body: Buffer };
  /** Скрипт тега с настоящего jsDelivr (--npm). */
  liveScript?: string;
  /** Сведения, общие для всех браузеров: архивы, установка, сборка, журнал сервера Next.js. */
  shared: Partial<Record<CheckId, Verdict>>;
  log?: (line: string) => void;
}

/** Состояние иконок страницы: тег — по его shadow DOM, React — по <svg> в самой странице. */
interface IconState {
  /** По значению на иконку: нарисована ли. */
  drawn: boolean[];
  /** Заглушки и рамки «иконки нет» у React. */
  loading: number;
  missing: number;
}

/** Иконки страницы: теги и <svg> компонента React. Выполняется в браузере. */
function iconState(): IconState {
  const ready = (svg: Element | null | undefined) =>
    Boolean(svg?.hasAttribute("viewBox") && svg.childNodes.length > 0);
  const tags = [...document.querySelectorAll("iconavo-icon")].map((tag) =>
    ready(tag.shadowRoot?.querySelector("svg")),
  );
  const svgs = [...document.querySelectorAll("body svg")].map(ready);
  return {
    drawn: [...tags, ...svgs],
    loading: document.querySelectorAll(".iconavo-loading").length,
    missing: document.querySelectorAll(".iconavo-missing").length,
  };
}

/** Все иконки страницы нарисованы — то же, что iconState. Выполняется в браузере. */
function everyIconDrawn(): boolean {
  const ready = (svg: Element | null | undefined) =>
    Boolean(svg?.hasAttribute("viewBox") && svg.childNodes.length > 0);
  const all = [
    ...[...document.querySelectorAll("iconavo-icon")].map((tag) =>
      ready(tag.shadowRoot?.querySelector("svg")),
    ),
    ...[...document.querySelectorAll("body svg")].map(ready),
  ];
  return all.length > 0 && all.every(Boolean);
}

/** Ждать, пока все иконки нарисуются; не дождались — то, что есть. */
async function waitDrawn(page: Page, timeout: number): Promise<IconState> {
  await page.waitForFunction(everyIconDrawn, null, { timeout }).catch(() => {});
  return page.evaluate(iconState);
}

/** Иконки нарисованы: все, ни заглушек, ни рамок. */
export function drawnVerdict(state: IconState): Verdict {
  const done = state.drawn.filter(Boolean).length;
  const problems = [
    state.drawn.length === 0 ? "иконок на странице нет" : "",
    done < state.drawn.length
      ? `нарисовано ${done} из ${state.drawn.length}`
      : "",
    state.loading > 0 ? `заглушек осталось: ${state.loading}` : "",
    state.missing > 0 ? `«иконки нет»: ${state.missing}` : "",
  ].filter(Boolean);
  return problems.length === 0
    ? pass(`все ${done} иконок нарисованы`)
    : fail(problems.join("; "));
}

/** Консоль: ни одного предупреждения и ни одной ошибки. */
export function quietVerdict(warnings: string[], errors: string[]): Verdict {
  const problems = [
    ...[...new Set(warnings)].map((w) => `предупреждение: ${w}`),
    ...[...new Set(errors)].map((e) => `ошибка: ${e}`),
  ];
  return problems.length === 0
    ? pass("ни ошибок, ни предупреждений")
    : fail(problems.slice(0, 4).join("; "));
}

/**
 * Сеть браузера: иконки спрашивались, всё ушло на известные адреса; у HTML-примера скрипт тега — ровно
 * по разу на загрузку страницы.
 */
export function trafficVerdict(
  traffic: Traffic,
  o: { script: boolean },
): Verdict {
  const problems = [
    traffic.icons.length === 0 ? "к хостам иконок — ни одного запроса" : "",
    o.script && traffic.scripts.length !== 1
      ? `скрипт тега запрошен ${traffic.scripts.length} раз`
      : "",
    traffic.stray.length > 0
      ? `к другим адресам: ${[...new Set(traffic.stray.map((u) => new URL(u).host))].join(", ")}`
      : "",
  ].filter(Boolean);
  return problems.length === 0
    ? pass(
        `${traffic.icons.length} запросов к хостам иконок${o.script ? ", скрипт тега — один" : ""}, больше никуда`,
      )
    : fail(problems.join("; "));
}

/**
 * Журнал сервера Next.js (preload.ts): иконки обёртки запрошены у хостов — через превью, — и ни одного
 * нашего хоста без пары.
 */
export function serverLogVerdict(lines: string[]): Verdict {
  const unmapped = lines.filter((l) => l.startsWith("unmapped "));
  const mapped = lines.filter((l) => l.includes(" -> "));
  if (unmapped.length > 0) {
    return fail(`сервер ходил к живым адресам: ${unmapped[0]?.slice(9)}`);
  }
  return mapped.length === 0
    ? fail("сервер Next.js не запрашивал иконки — loadIcons не дошёл до хостов")
    : pass(
        `сервер Next.js: ${mapped.length} запросов иконок, все — через превью`,
      );
}

/** Сеть: браузер и, у Next.js, сервер. */
const networkVerdict = (browser: Verdict, server?: Verdict): Verdict =>
  server === undefined
    ? browser
    : browser.ok === true && server.ok === true
      ? pass(`${browser.note}; ${server.note}`)
      : fail(
          [browser, server]
            .filter((v) => v.ok !== true)
            .map((v) => v.note)
            .join("; "),
        );

/**
 * Положение текста сразу за тегами — от начала его абзаца: его и сдвинула бы загрузка без резерва.
 * Иконки с width и height строка :not(:defined) не знает (так и написано в README), и всё, что ниже
 * такой иконки, съезжает целиком, — поэтому от абзаца, а не от страницы.
 */
const textSpots = (page: Page): Promise<Spot[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("iconavo-icon")]
      .map((tag) => tag.nextSibling)
      .filter(
        (n): n is Text =>
          n !== null &&
          n.nodeType === Node.TEXT_NODE &&
          Boolean(n.textContent?.trim()),
      )
      .map((text) => {
        const range = document.createRange();
        range.selectNodeContents(text);
        const box = range.getBoundingClientRect();
        const block = text.parentElement
          ?.closest("p, li, td, th, h1, h2, h3, h4, div")
          ?.getBoundingClientRect();
        return {
          left: box.left - (block?.left ?? 0),
          top: box.top - (block?.top ?? 0),
        };
      }),
  );

/**
 * Сторож «без мигания»: когда разбор HTML закончен (readyState — interactive), нарисованные <svg> — это
 * иконки серверного HTML. Любое их изменение потом — атрибуты, содержимое, удаление — мигание.
 * Выполняется в браузере до скриптов страницы.
 */
function flashGuard(): void {
  const w = window as unknown as { flashes: string[]; serverIcons: number };
  w.flashes = [];
  w.serverIcons = 0;
  const server = new WeakSet<Element>();
  document.addEventListener("readystatechange", () => {
    if (document.readyState !== "interactive") return;
    const icons = document.querySelectorAll("body svg[viewBox]");
    for (const svg of icons) server.add(svg);
    w.serverIcons = icons.length;
    const touches = (node: Node) =>
      node instanceof Element &&
      (server.has(node) ||
        [...node.querySelectorAll("svg")].some((svg) => server.has(svg)));
    new MutationObserver((list) => {
      for (const m of list) {
        const target =
          m.target instanceof Element ? m.target : m.target.parentElement;
        const svg = target?.closest("svg");
        if (svg && server.has(svg)) {
          w.flashes.push(
            `${m.type}${m.attributeName ? ` ${m.attributeName}` : ""}`,
          );
        }
        if ([...m.removedNodes].some(touches)) {
          w.flashes.push("иконку серверного HTML убрали");
        }
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
}

/** Контрольный запуск гидратации: первый h1 портится сразу после разбора HTML, до гидратации. */
function spoilHeading(): void {
  const observer = new MutationObserver(() => {
    const h1 = document.querySelector("h1");
    if (h1?.textContent && !h1.textContent.endsWith(" (spoiled)")) {
      h1.textContent = `${h1.textContent} (spoiled)`;
      observer.disconnect();
    }
  });
  observer.observe(document, { subtree: true, childList: true });
}

/** Имена кнопок по дереву доступности Chrome. */
async function buttonNames(
  context: BrowserContext,
  page: Page,
): Promise<string[]> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const tree = (await cdp.send("Accessibility.getFullAXTree")) as {
    nodes: { role?: { value?: string }; name?: { value?: string } }[];
  };
  return tree.nodes
    .filter((n) => n.role?.value === "button")
    .map((n) => n.name?.value?.trim() ?? "");
}

/** Серверный HTML без JavaScript: нарисованные иконки обёртки и пустые места нужного размера. */
async function checkServerHtml(
  browser: Browser,
  o: PageCheckOptions,
  result: StarterResult,
): Promise<void> {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: VIEWPORT,
  });
  const page = await context.newPage();
  await page.goto(`${o.base}/`, { waitUntil: "load", timeout: 120_000 });
  const html = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll("body svg")];
    return {
      drawn: svgs.filter(
        (s) => s.hasAttribute("viewBox") && s.childNodes.length > 0,
      ).length,
      reserved: svgs.filter(
        (s) =>
          !s.hasAttribute("viewBox") &&
          s.hasAttribute("width") &&
          s.hasAttribute("height"),
      ).length,
      empty: svgs.filter(
        (s) =>
          !s.hasAttribute("viewBox") &&
          !(s.hasAttribute("width") && s.hasAttribute("height")),
      ).length,
      styled: document.querySelectorAll("body svg[style]").length,
    };
  });
  const problems = [
    html.drawn === 0
      ? "ни одной нарисованной иконки — IconavoProvider пуст"
      : "",
    html.empty > 0 ? `без размера: ${html.empty}` : "",
    html.styled > 0 ? `<svg> с атрибутом style: ${html.styled}` : "",
  ].filter(Boolean);
  result.verdicts.html =
    problems.length === 0
      ? pass(
          `${html.drawn} иконок обёртки нарисованы, у ${html.reserved} — пустое место нужного размера`,
        )
      : fail(problems.join("; "));
  result.shots.push({
    title: "Без JavaScript — серверный HTML: иконки обёртки уже нарисованы",
    png: await shot(page, { errors: [] }),
  });
  await context.close();
}

/** Страница как у разработчика: иконки, место до загрузки, мигание, консоль, сеть, подпись, axe. */
async function checkPage(
  browser: Browser,
  name: BrowserName,
  o: PageCheckOptions,
  result: StarterResult,
): Promise<void> {
  const v = result.verdicts;
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const seen = watch(page);
  if (o.starter === "next") await page.addInitScript(flashGuard);
  const traffic = await routeHosts(page, {
    map: o.map,
    script: o.script && { ...o.script, delayMs: SCRIPT_DELAY_MS },
    liveScript: o.liveScript,
  });
  await page.goto(`${o.base}/`, { waitUntil: "commit", timeout: 120_000 });

  if (o.starter === "html") {
    // Скрипт тега задержан: пока его нет, место держит строка :not(:defined) из README.
    await page.waitForFunction(
      () =>
        document.readyState !== "loading" &&
        !customElements.get("iconavo-icon"),
      null,
      { timeout: 60_000 },
    );
    const before = await textSpots(page);
    const early = await page.evaluate(() =>
      Boolean(customElements.get("iconavo-icon")),
    );
    await waitDrawn(page, DRAW_TIMEOUT_MS);
    const reserve = layoutVerdict(before, await textSpots(page));
    v.reserve = early
      ? { ok: null, note: `скрипт пришёл раньше замера; ${reserve.note}` }
      : reserve;
  }

  await page.waitForLoadState("load", { timeout: 120_000 });
  const state = await waitDrawn(page, DRAW_TIMEOUT_MS);
  v.drawn = drawnVerdict(state);
  // Предупреждения React о гидратации и запоздалые запросы — после отрисовки.
  await page.waitForTimeout(1000);

  if (o.starter === "next") {
    const guard = await page.evaluate(() => {
      const w = window as unknown as { flashes: string[]; serverIcons: number };
      return { flashes: w.flashes, serverIcons: w.serverIcons };
    });
    v.noflash =
      guard.serverIcons === 0
        ? fail("в серверном HTML не нашлось нарисованных иконок")
        : guard.flashes.length === 0
          ? pass(
              `${guard.serverIcons} иконок серверного HTML после гидратации не менялись`,
            )
          : fail(
              `изменений: ${guard.flashes.length} (${[...new Set(guard.flashes)].slice(0, 3).join("; ")})`,
            );
  }

  if (o.starter !== "next") {
    if (name === "chrome") {
      const names = await buttonNames(context, page);
      const named = names.filter((b) => b === "Delete").length;
      v.label =
        named === 2
          ? pass("по дереву доступности Chrome: обе кнопки — «Delete»")
          : fail(
              `кнопок «Delete» — ${named} из 2; имена кнопок: ${names.map((b) => `«${b}»`).join(", ")}`,
            );
    } else {
      v.label = { ok: null, note: "только Chrome — по дереву доступности" };
    }
  }

  result.shots.push({
    title: `${STARTER_TITLES[o.starter]}, ${MODE_TITLES[o.mode]}: страница после загрузки`,
    png: await shot(page, seen),
  });

  // Подпись тега задана через ElementInternals, а их axe не видит (Deque, axe-core 4.13): кнопку, у
  // которой есть только иконка с подписью, он счёл бы безымянной. Такие кнопки axe пропускает, их имя
  // проверяет строка «Подпись» по дереву доступности Chrome.
  const skipped = await page.evaluate(() => {
    let count = 0;
    for (const button of document.querySelectorAll("button")) {
      if (
        button.querySelector("iconavo-icon[label]") &&
        button.textContent?.trim() === ""
      ) {
        button.setAttribute("data-axe-skip", "");
        count++;
      }
    }
    return count;
  });
  const pages: { path: string; violations: AxeViolation[] }[] = [];
  await runAxe(
    page,
    await axe(),
    "/",
    pages,
    skipped > 0 ? ["[data-axe-skip]"] : [],
  );
  const audit = axeVerdict(pages);
  v.axe =
    skipped > 0 && audit.ok === true
      ? pass(
          `${audit.note}; кнопок с подписью тега — ${skipped}: её axe не видит, имя проверяет строка «Подпись»`,
        )
      : audit;

  v.console = quietVerdict(seen.warnings, seen.errors);
  v.network = networkVerdict(
    trafficVerdict(traffic, { script: o.starter === "html" }),
    o.shared.network,
  );
  await context.close();
}

/** Контрольный запуск: хосты иконок не отвечают — иконки не дорисуются, ядро скажет об этом. */
async function checkCanary(
  browser: Browser,
  o: PageCheckOptions,
  result: StarterResult,
): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const seen = watch(page);
  await routeHosts(page, {
    map: o.map,
    script: o.script && { ...o.script, delayMs: 0 },
    liveScript: o.liveScript,
    refuse: true,
  });
  await page.goto(`${o.base}/`, { waitUntil: "load", timeout: 120_000 });
  // Ядро повторяет через 1, 2 и 4 с, потом пишет «failed to load».
  await page
    .waitForEvent("console", {
      predicate: (m) => m.text().includes("failed to load"),
      timeout: 30_000,
    })
    .catch(() => {});
  const state = await page.evaluate(iconState);
  const missed = state.drawn.filter((d) => !d).length;
  const warned = seen.warnings.some((w) => w.includes("failed to load"));
  result.verdicts.canary =
    missed > 0 && warned
      ? pass(
          `без хостов не нарисовано ${missed} иконок, в консоли — «failed to load»`,
        )
      : fail(
          `проверка слепая: без хостов не нарисовано ${missed} иконок${warned ? "" : ", предупреждения «failed to load» нет"}`,
        );
  await context.close();
}

/** Контрольный запуск гидратации (Next.js): испорченный заголовок — React должен это заметить. */
async function checkHydrationCanary(
  browser: Browser,
  o: PageCheckOptions,
  result: StarterResult,
): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const seen = watch(page);
  await routeHosts(page, { map: o.map, liveScript: o.liveScript });
  await page.addInitScript(spoilHeading);
  await page.goto(`${o.base}/`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(3000);
  result.verdicts.canaryHydration = canaryVerdict([
    ...seen.errors,
    ...seen.warnings,
  ]);
  await context.close();
}

/** Один пример в одном режиме — во всех браузерах по очереди. */
export async function checkStarterPages(
  o: PageCheckOptions,
  browsers: readonly BrowserName[],
): Promise<StarterResult[]> {
  const results: StarterResult[] = [];
  for (const name of browsers) {
    const result: StarterResult = {
      starter: o.starter,
      mode: o.mode,
      browser: name,
      verdicts: { ...o.shared },
      shots: [],
    };
    const title = `${BROWSER_TITLES[name]}, ${STARTER_TITLES[o.starter]}, ${MODE_TITLES[o.mode]}`;
    let browser: Browser | undefined;
    try {
      browser = await launchBrowser(name, true);
      if (o.starter === "next") {
        o.log?.(`${title}: серверный HTML…`);
        await checkServerHtml(browser, o, result);
      }
      o.log?.(`${title}: страница…`);
      await checkPage(browser, name, o, result);
      o.log?.(`${title}: контрольный запуск…`);
      await checkCanary(browser, o, result);
      if (o.starter === "next") await checkHydrationCanary(browser, o, result);
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
export const startersCheckFailed = (results: StarterResult[]) =>
  results.length === 0 ||
  results.some(
    (r) =>
      r.failure !== undefined ||
      Object.values(r.verdicts).some((v) => v.ok === false),
  );
