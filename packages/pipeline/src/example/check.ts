// Проверка примера на Next.js в трёх браузерах (фаза 3, шаг 7; ADR-0033, ADR-0035): pnpm example --check
// открывает пример в режиме разработки и в продакшен-сборке — Chrome, Firefox и WebKit по очереди, чтобы
// не съесть память, — и проверяет обещания шага: иконки обёртки — в серверном HTML и не мигают при
// гидратации, остальные догружаются в браузере, в консоли нет предупреждений о гидратации. Сеть не
// нужна: хосты иконок — превью API на этом компьютере. Контрольный запуск сам портит HTML страницы и
// ждёт предупреждения — так видно, что проверка не слепая. Чистые части — разбор запросов к API и
// консоли — проверяются тестами без браузера.

import type { Browser, Page } from "playwright";
import {
  BROWSER_TITLES,
  BROWSERS,
  type BrowserName,
  launchBrowser,
} from "../sandbox/browser.js";
import {
  fail,
  layoutVerdict,
  pass,
  recordViolations,
  type Spot,
  shot,
  type Verdict,
  violations,
  watch,
} from "../sandbox/check.js";
import { SLOW_MS, VIEWPORT } from "./config.js";
import type { Mode } from "./next.js";

export const MODES: readonly Mode[] = ["dev", "prod"];

export const MODE_TITLES: Record<Mode, string> = {
  dev: "разработка",
  prod: "продакшен",
};

export const CHECKS = [
  [
    "html",
    "Серверный HTML: иконки обёртки нарисованы, остальные — резерв нужного размера, без атрибутов style",
  ],
  [
    "noflash",
    "Без мигания: иконки с сервера при гидратации не меняются — ни в DOM, ни на снимке",
  ],
  [
    "console",
    "Консоль: ни ошибок, ни предупреждений о гидратации — только два ожидаемых, про иконки, которых нет",
  ],
  ["csp", "Строгая CSP продакшена (style-src 'self'): ни одного нарушения"],
  ["browser", "Иконки из браузера появились после гидратации"],
  [
    "reserve",
    "Место до загрузки: текст рядом с иконками из браузера не сдвинулся",
  ],
  [
    "placeholders",
    "Заглушки: первые 150 мс скрыты, потом видны — скелетон мерцает, спиннер крутится",
  ],
  [
    "network",
    "Сеть: только имена не из обёртки, каждое по разу; иконки обёртки — ни одного запроса",
  ],
  [
    "client",
    "Клиентский компонент: addIcons, смена цвета и иконки, которые появляются только в браузере",
  ],
  [
    "navigation",
    "Переход на /more: вложенная обёртка — сразу, без запросов; остальные догрузились",
  ],
  ["label", "Подпись: обе кнопки из README называются «Delete»"],
  ["trusted", "Trusted Types: рисунок уходит в innerHTML объектом TrustedHTML"],
  ["frame", "Иконки нет: пунктирная рамка — только в режиме разработки"],
  ["tag", "Тег <iconavo-icon> в React нарисован"],
  [
    "canary",
    "Контрольный запуск: испорченный HTML — предупреждение о гидратации замечено",
  ],
  ["devEntry", "Сведения: какой вход тега выбрал Next.js (рамка у тега)"],
  ["cssVar", 'Сведения: color="var(--brand)" в атрибуте <svg>'],
] as const;

export type CheckId = (typeof CHECKS)[number][0];

/** Имена иконок примера (examples/next/app/icons.json). */
export interface ExampleNames {
  /** В обёртке корневого layout. */
  server: string[];
  /** На главной, не в обёртке. */
  browser: string[];
  /** Появляются только в браузере, по кнопке. */
  toggle: string[];
  /** Во вложенной обёртке страницы /more. */
  more: string[];
  /** На /more, не в обёртке. */
  moreBrowser: string[];
  /** У тега <iconavo-icon>. */
  tag: string;
  /** Имена, которых нет: у компонента и у тега. */
  missing: string;
  missingTag: string;
}

export interface ExampleResult {
  mode: Mode;
  browser: BrowserName;
  /** Браузер не запустился или страница не открылась — почему. */
  failure?: string;
  verdicts: Partial<Record<CheckId, Verdict>>;
  /** Снимки: подпись и PNG в base64. */
  shots: { title: string; png: string }[];
}

export interface ExampleCheckOptions {
  /** Пример: http://127.0.0.1:порт. */
  base: string;
  /** Превью API — оно же хост статики (/_static/). */
  api: string;
  mode: Mode;
  names: ExampleNames;
  browsers?: readonly BrowserName[];
  log?: (line: string) => void;
}

/** Имена из адресов пачек API: /{набор}.json?icons=a,b → набор:a, набор:b; запросы к статике — счётом. */
export function requested(
  urls: string[],
  api: string,
): { names: string[]; batches: number; statics: number } {
  const names: string[] = [];
  let batches = 0;
  let statics = 0;
  for (const url of urls) {
    if (!url.startsWith(api)) continue;
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/_static/")) {
      statics++;
      continue;
    }
    const set = /^\/([a-z0-9-]+)\.json$/.exec(parsed.pathname)?.[1];
    const icons = parsed.searchParams.get("icons");
    if (set === undefined || icons === null) continue;
    batches++;
    for (const icon of icons.split(",")) names.push(`${set}:${icon}`);
  }
  return { names, batches, statics };
}

/** Сеть: имена обёртки не запрашиваются, ожидаемые — ровно по разу, к статике не ходят. */
export function networkVerdict(
  urls: string[],
  api: string,
  provided: string[],
  expected: string[],
): Verdict {
  const { names, batches, statics } = requested(urls, api);
  const unique = (list: string[]) => [...new Set(list)].join(", ");
  const own = names.filter((n) => provided.includes(n));
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  const missed = expected.filter((n) => !names.includes(n));
  const problems = [
    own.length > 0 ? `запрошены иконки обёртки: ${unique(own)}` : "",
    twice.length > 0 ? `дважды: ${unique(twice)}` : "",
    missed.length > 0 ? `не запрошены: ${missed.join(", ")}` : "",
    statics > 0 ? `запросов к статике: ${statics}` : "",
  ].filter(Boolean);
  return problems.length === 0
    ? pass(
        `${batches} пачек, ${names.length} имён; иконки обёртки — ни одного запроса`,
      )
    : fail(problems.join("; "));
}

/** Предупреждения страницы: по одному на имя, которого нет, — у компонента и у тега. */
export const expectedWarnings = (names: ExampleNames) => [
  `Iconavo: icon "${names.missing}" not found`,
  `Iconavo: icon "${names.missingTag}" not found`,
];

/** Консоль: ожидаемые предупреждения — ровно по разу, других предупреждений и ошибок нет. */
export function consoleVerdict(
  warnings: string[],
  errors: string[],
  expected: string[],
): Verdict {
  const problems = [
    ...expected
      .map((text) => [text, warnings.filter((w) => w === text).length] as const)
      .filter(([, count]) => count !== 1)
      .map(([text, count]) => `${count} раз: ${text}`),
    ...[...new Set(warnings.filter((w) => !expected.includes(w)))].map(
      (w) => `предупреждение: ${w}`,
    ),
    ...[...new Set(errors)].map((e) => `ошибка: ${e}`),
  ];
  return problems.length === 0
    ? pass(`${expected.length} ожидаемых предупреждения, больше ничего`)
    : fail(problems.slice(0, 6).join("; "));
}

/** Заглушка иконки из браузера в момент замера: класс, нарисована ли иконка, видимость, анимации. */
export interface Placeholder {
  name: string;
  className: string;
  drawn: boolean;
  visibility: string;
  animation: string;
}

/**
 * Заглушки: класс есть уже в серверном HTML, а стили приходят с гидратацией, и первые 150 мс заглушка
 * скрыта. early — сразу после гидратации, late — через 0,3 с: ещё не пришедшие иконки видны и
 * анимированы — скелетон мерцает (iconavo-p), спиннер крутится (iconavo-s).
 */
export function placeholderVerdict(
  early: Placeholder[],
  late: Placeholder[],
): Verdict {
  const waiting = late.filter((p) => !p.drawn);
  if (waiting.length === 0) {
    return { ok: null, note: "иконки пришли раньше замера" };
  }
  const motion = (p: Placeholder) =>
    p.className.includes("iconavo-spinner")
      ? p.animation.includes("iconavo-s")
      : p.animation.includes("iconavo-p");
  const problems = waiting
    .filter((p) => p.visibility !== "visible" || !motion(p))
    .map(
      (p) =>
        `${p.name} (${p.className}): ${p.visibility}, анимации «${p.animation}»`,
    );
  if (problems.length > 0) return fail(problems.join("; "));
  const hidden = early.filter(
    (p) => !p.drawn && p.visibility === "hidden",
  ).length;
  const kinds = [
    ...new Set(
      waiting.map((p) =>
        p.className.includes("iconavo-spinner") ? "спиннер" : "скелетон",
      ),
    ),
  ].join(" и ");
  return pass(
    `${waiting.length} заглушек (${kinds}) видны и анимированы; сразу после гидратации скрыто ${hidden} из ${early.length}`,
  );
}

/**
 * Контрольный запуск: после порчи HTML страница сказала именно о расхождении при гидратации — проверка
 * не слепая. Другое сообщение не в счёт: оно не доказывает, что расхождение было бы замечено.
 */
export function canaryVerdict(messages: string[]): Verdict {
  const hydration = messages.find((m) =>
    /hydrat|#418|#423|#425|didn't match|did not match/i.test(m),
  );
  return hydration === undefined
    ? fail(
        `о расхождении ни слова — проверка слепая${messages.length > 0 ? `; было: ${messages[0]?.split("\n")[0]?.slice(0, 120)}` : ""}`,
      )
    : pass(`замечено: ${hydration.split("\n")[0]?.slice(0, 160)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Сторожа до скриптов страницы: изменения в разделе «С сервера» после разбора HTML (разбор только
 * добавляет узлы — добавления не в счёт) и записи innerHTML у <svg> на странице — строкой или
 * TrustedHTML. Выполняется в браузере.
 */
function watchers(): void {
  const w = window as unknown as {
    changes: string[];
    inner: (boolean | null)[];
    trustedTypes?: { isHTML(value: unknown): boolean };
  };
  w.changes = [];
  w.inner = [];
  new MutationObserver((list) => {
    for (const m of list) {
      const target =
        m.target instanceof Element ? m.target : m.target.parentElement;
      if (!target?.closest('[data-check="server"]')) continue;
      if (m.type === "childList" && m.removedNodes.length === 0) continue;
      w.changes.push(
        `${m.type} ${target.tagName.toLowerCase()}${m.attributeName ? ` ${m.attributeName}` : ""}`,
      );
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const own = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  const set = own?.set;
  if (own && set) {
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...own,
      set(value: unknown) {
        if (this instanceof SVGSVGElement && this.isConnected) {
          w.inner.push(w.trustedTypes ? w.trustedTypes.isHTML(value) : null);
        }
        set.call(this, value);
      },
    });
  }
}

/** Нарисована ли иконка: у <svg> есть viewBox и рисунок. */
const drawn = (page: Page, selector: string) =>
  page.evaluate(
    (s) =>
      [...document.querySelectorAll(s)].map(
        (svg) => svg.hasAttribute("viewBox") && svg.childNodes.length > 0,
      ),
    selector,
  );

/** Ждать, пока все иконки по селектору нарисуются. */
const allDrawn = (page: Page, selector: string) =>
  page.waitForFunction(
    (s) => {
      const list = [...document.querySelectorAll(s)];
      return (
        list.length > 0 && list.every((svg) => svg.hasAttribute("viewBox"))
      );
    },
    selector,
    { timeout: 120_000 },
  );

/** Заглушки иконок из браузера: класс, видимость и анимации. */
const placeholders = (page: Page): Promise<Placeholder[]> =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll<SVGElement>(selector)].map((svg) => {
        const style = getComputedStyle(svg);
        return {
          name: svg.dataset.name ?? "",
          className: svg.getAttribute("class") ?? "",
          drawn: svg.hasAttribute("viewBox"),
          visibility: style.visibility,
          animation: style.animationName,
        };
      }),
    BROWSER_ICONS,
  );

/** Положение подписей рядом с иконками из браузера. */
const spots = (page: Page): Promise<Spot[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-check="browser"] .spot')].map(
      (spot) => {
        const text = [...spot.childNodes].find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
        );
        const range = document.createRange();
        if (text) range.selectNodeContents(text);
        const box = range.getBoundingClientRect();
        return { left: box.left, top: box.top };
      },
    ),
  );

const SERVER = '[data-check="server"]';
const BROWSER_ICONS = '[data-check="browser"] svg[data-name]';

/** Страница без JavaScript — то, что отдал сервер. Возвращает снимок раздела «С сервера» в base64. */
async function checkServerHtml(
  browser: Browser,
  o: ExampleCheckOptions,
  result: ExampleResult,
): Promise<string> {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: VIEWPORT,
  });
  const page = await context.newPage();
  await page.goto(`${o.base}/`, { waitUntil: "load", timeout: 120_000 });
  const html = await page.evaluate(
    ([server, browserIcons]) => {
      const all = (s: string) => [...document.querySelectorAll(s)];
      return {
        server: all(`${server} svg[data-name]`).map(
          (svg) => svg.hasAttribute("viewBox") && svg.childNodes.length > 0,
        ),
        browser: all(browserIcons).map(
          (svg) =>
            !svg.hasAttribute("viewBox") &&
            svg.childNodes.length === 0 &&
            svg.getAttribute("width") === "32" &&
            svg.getAttribute("height") === "32",
        ),
        styled: all("main svg[style]").length,
      };
    },
    [SERVER, BROWSER_ICONS] as const,
  );
  const problems = [
    html.server.length !== o.names.server.length || !html.server.every(Boolean)
      ? `нарисовано ${html.server.filter(Boolean).length} из ${o.names.server.length} иконок обёртки`
      : "",
    html.browser.length !== o.names.browser.length ||
    !html.browser.every(Boolean)
      ? `пустой резерв 32×32 — у ${html.browser.filter(Boolean).length} из ${o.names.browser.length} иконок из браузера`
      : "",
    html.styled > 0 ? `<svg> с атрибутом style: ${html.styled}` : "",
  ].filter(Boolean);
  result.verdicts.html =
    problems.length === 0
      ? pass(
          `${html.server.length} иконок обёртки нарисованы, ${html.browser.length} — резерв 32×32; style — ни у одной`,
        )
      : fail(problems.join("; "));
  // Без JavaScript нет ни сторожей, ни ошибок страницы — снимкам считать нечего.
  const none = { errors: [] };
  const section = await shot(page, none, SERVER);
  result.shots.push({
    title:
      "Без JavaScript — серверный HTML: иконки «From the server» уже нарисованы, у остальных — пустое место нужного размера",
    png: await shot(page, none),
  });
  await context.close();
  return section;
}

/** Гидратация, загрузка в браузере, клиентский компонент, переход по ссылке. */
async function checkHydration(
  browser: Browser,
  name: BrowserName,
  o: ExampleCheckOptions,
  result: ExampleResult,
  before: string,
): Promise<void> {
  const v = result.verdicts;
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  await page.addInitScript(watchers);
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(o.api)) urls.push(request.url());
  });
  // Ответы хостов иконок — на SLOW_MS позже: до них место держит резерв.
  await page.route(`${o.api}/**`, async (route) => {
    await sleep(SLOW_MS);
    await route.continue().catch(() => {});
  });
  await page.goto(`${o.base}/`, { waitUntil: "load", timeout: 120_000 });
  const spotsBefore = await spots(page);
  const early = await drawn(page, BROWSER_ICONS);

  // Заглушки: стили приходят с гидратацией — её видно по иконке addIcons. Замер сразу и через
  // 0,25 с, пока ответы API (задержка SLOW_MS) ещё не пришли.
  await page.waitForFunction(
    () =>
      document
        .querySelector('svg[data-name="acme:logo"]')
        ?.hasAttribute("viewBox"),
    null,
    { timeout: 120_000 },
  );
  const placeholdersEarly = await placeholders(page);
  await page.waitForTimeout(250);
  const placeholdersLate = await placeholders(page);
  v.placeholders = placeholderVerdict(placeholdersEarly, placeholdersLate);
  result.shots.push({
    title: `Пока иконки из браузера грузятся (ответы API задержаны на ${SLOW_MS} мс): заглушки — скелетон и спиннер`,
    png: await shot(page, seen, '[data-check="browser"]'),
  });

  await allDrawn(page, BROWSER_ICONS);
  v.browser = pass(`${o.names.browser.length} иконок нарисованы`);
  const reserve = layoutVerdict(spotsBefore, await spots(page));
  v.reserve = early.some(Boolean)
    ? { ok: null, note: `иконки пришли раньше замера; ${reserve.note}` }
    : reserve;

  const after = await shot(page, seen, SERVER);
  const changes = await page.evaluate(
    () => (window as unknown as { changes: string[] }).changes,
  );
  const same = after === before;
  if (!same) {
    result.shots.push(
      { title: "Раздел «С сервера» без JavaScript", png: before },
      { title: "Раздел «С сервера» после гидратации", png: after },
    );
  }
  v.noflash =
    changes.length === 0 && same
      ? pass(
          "после загрузки ни одного изменения в DOM; снимки раздела без JavaScript и после гидратации совпадают",
        )
      : fail(
          [
            changes.length > 0
              ? `изменений в DOM: ${changes.length} (${[...new Set(changes)].slice(0, 3).join("; ")})`
              : "",
            same
              ? ""
              : "снимки раздела без JavaScript и после гидратации различаются",
          ]
            .filter(Boolean)
            .join("; "),
        );

  // Тег и иконки, которых нет: их запросы — тоже до замера сети.
  await page.waitForFunction(
    (n) => {
      const tag = document.querySelector(`iconavo-icon[icon="${n.tag}"]`);
      const missing = document.querySelector(`svg[data-name="${n.missing}"]`);
      const missingTag = document.querySelector(
        `iconavo-icon[icon="${n.missingTag}"]`,
      );
      return (
        tag?.shadowRoot?.querySelector("svg[viewBox]") &&
        missing?.classList.contains("iconavo-missing") &&
        missingTag?.shadowRoot?.querySelector("svg:not([viewBox])")
      );
    },
    o.names,
    { timeout: 60_000 },
  );
  v.network = networkVerdict(urls, o.api, o.names.server, [
    ...o.names.browser,
    o.names.tag,
    o.names.missing,
    o.names.missingTag,
  ]);

  const outline = await page.evaluate((n) => {
    const svg = document.querySelector(`svg[data-name="${n}"]`);
    return svg ? getComputedStyle(svg).outlineStyle : "";
  }, o.names.missing);
  v.frame =
    o.mode === "dev"
      ? outline === "dashed"
        ? pass("рамка есть")
        : fail(`рамки нет (outline: ${outline || "—"})`)
      : outline === "dashed"
        ? fail("рамка в продакшене")
        : pass("рамки нет");

  const tag = await page.evaluate((n) => {
    const shadow = (icon: string) =>
      document.querySelector(`iconavo-icon[icon="${icon}"]`)?.shadowRoot;
    return {
      drawn: Boolean(shadow(n.tag)?.querySelector("svg[viewBox]")),
      frame:
        shadow(n.missingTag)?.querySelector("svg")?.getAttribute("class") ===
        "missing",
    };
  }, o.names);
  v.tag = tag.drawn ? pass("нарисован") : fail("не нарисован");
  v.devEntry = {
    ok: null,
    note: tag.frame
      ? "рамка есть — вход development.js"
      : "рамки нет — обычный вход index.js",
  };

  const colors = await page.evaluate(() => {
    const svg = document.querySelector('[data-check="var"]');
    const probe = document.createElement("span");
    probe.style.color = "var(--brand)";
    document.body.append(probe);
    const brand = getComputedStyle(probe).color;
    probe.remove();
    return { svg: svg ? getComputedStyle(svg).color : "", brand };
  });
  v.cssVar = {
    ok: null,
    note:
      colors.svg === colors.brand
        ? `работает: ${colors.svg}`
        : `не работает: цвет ${colors.svg}, а --brand — ${colors.brand}`,
  };

  const added = await drawn(page, 'svg[data-name="acme:logo"]');
  await page.getByRole("button", { name: "Change color" }).click();
  const recolored = await page
    .locator('svg[data-name="lucide:palette"]')
    .getAttribute("color");
  await page.locator('[data-check="toggle"]').click();
  await page.waitForFunction(
    (list) =>
      list.every((icon) =>
        document
          .querySelector(`svg[data-name="${icon}"]`)
          ?.hasAttribute("viewBox"),
      ),
    o.names.toggle,
    { timeout: 60_000 },
  );
  v.client =
    added[0] && recolored === "crimson"
      ? pass(
          `addIcons — сразу после гидратации, цвет сменился, по кнопке — ${o.names.toggle.length} иконки`,
        )
      : fail(
          `${added[0] ? "" : "иконки addIcons нет; "}цвет после кнопки: ${recolored ?? "—"}`,
        );

  if (name === "chrome") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Accessibility.enable");
    const tree = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: { role?: { value?: string }; name?: { value?: string } }[];
    };
    const buttons = tree.nodes
      .filter((n) => n.role?.value === "button")
      .map((n) => n.name?.value ?? "");
    const named = buttons.filter((b) => b.trim() === "Delete").length;
    v.label =
      named === 2
        ? pass("по дереву доступности Chrome: обе кнопки — «Delete»")
        : fail(
            `кнопок «Delete» — ${named} из 2; имена кнопок: ${buttons.map((b) => `«${b}»`).join(", ")}`,
          );
  } else {
    v.label = { ok: null, note: "только Chrome — по дереву доступности" };
  }

  const inner = await page.evaluate(
    () => (window as unknown as { inner: (boolean | null)[] }).inner,
  );
  v.trusted =
    inner.length === 0
      ? { ok: null, note: "innerHTML у <svg> не вызывался" }
      : inner.every((x) => x === null)
        ? {
            ok: null,
            note: `в браузере нет Trusted Types — записей строкой: ${inner.length}`,
          }
        : inner.every((x) => x === true)
          ? pass(`${inner.length} записей — все TrustedHTML`)
          : fail(
              `строкой: ${inner.filter((x) => x !== true).length} из ${inner.length}`,
            );
  result.shots.push({
    title:
      "Главная после загрузки: все иконки на месте, кнопки клиентского компонента нажаты",
    png: await shot(page, seen),
  });

  // Переход по ссылке: страница рисуется уже в браузере, без гидратации.
  const sent = urls.length;
  await page.locator('[data-check="link"]').click();
  await page.waitForURL(`${o.base}/more`, { timeout: 120_000 });
  await page.waitForSelector('[data-check="nested"] svg[data-name]', {
    timeout: 120_000,
  });
  const nested = await drawn(page, '[data-check="nested"] svg[data-name]');
  await allDrawn(page, BROWSER_ICONS);
  const asked = requested(urls.slice(sent), o.api).names;
  const own = asked.filter((n) => o.names.more.includes(n));
  const missed = o.names.moreBrowser.filter((n) => !asked.includes(n));
  v.navigation =
    nested.length === o.names.more.length &&
    nested.every(Boolean) &&
    own.length === 0 &&
    missed.length === 0
      ? pass(
          `вложенная обёртка — сразу, ${nested.length} иконки без запросов; из браузера — ${o.names.moreBrowser.length}`,
        )
      : fail(
          [
            nested.every(Boolean)
              ? ""
              : `вложенная обёртка не нарисована сразу: ${nested.filter(Boolean).length} из ${o.names.more.length}`,
            own.length > 0 ? `запрошены иконки обёртки: ${own.join(", ")}` : "",
            missed.length > 0 ? `не запрошены: ${missed.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("; "),
        );
  result.shots.push({
    title: "Страница /more после перехода по ссылке",
    png: await shot(page, seen),
  });

  v.console = consoleVerdict(
    seen.warnings,
    seen.errors,
    expectedWarnings(o.names),
  );
  const found = await violations(page);
  v.csp =
    o.mode === "prod"
      ? found.length === 0
        ? pass("ни одного нарушения")
        : fail([...new Set(found)].slice(0, 4).join("; "))
      : { ok: null, note: "в режиме разработки политики нет" };
  await context.close();
}

/**
 * Контрольный запуск: заголовок «From the server» портится сразу после разбора HTML, до гидратации, —
 * React должен это заметить. Портит скрипт в самой странице, а не подменённый ответ: документ из
 * подменённого ответа Chrome считает пришедшим извне и режет соединения к 127.0.0.1.
 */
function spoil(): void {
  const observer = new MutationObserver(() => {
    for (const h2 of document.querySelectorAll("h2")) {
      if (h2.textContent === "From the server") {
        h2.textContent = "From the server, spoiled";
        observer.disconnect();
      }
    }
  });
  observer.observe(document, { subtree: true, childList: true });
}

async function checkCanary(
  browser: Browser,
  o: ExampleCheckOptions,
  result: ExampleResult,
): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const seen = watch(page);
  await page.addInitScript(spoil);
  await page.goto(`${o.base}/`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(3000);
  result.verdicts.canary = canaryVerdict([...seen.errors, ...seen.warnings]);
  await context.close();
}

async function checkBrowser(
  name: BrowserName,
  o: ExampleCheckOptions,
): Promise<ExampleResult> {
  const result: ExampleResult = {
    mode: o.mode,
    browser: name,
    verdicts: {},
    shots: [],
  };
  const title = `${BROWSER_TITLES[name]}, ${MODE_TITLES[o.mode]}`;
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser(name, true);
    o.log?.(`${title}: серверный HTML…`);
    const before = await checkServerHtml(browser, o, result);
    o.log?.(`${title}: гидратация, загрузка, переход по ссылке…`);
    await checkHydration(browser, name, o, result, before);
    o.log?.(`${title}: контрольный запуск…`);
    await checkCanary(browser, o, result);
  } catch (e) {
    result.failure = (e as Error).message.split("\n")[0];
  } finally {
    await browser?.close();
  }
  return result;
}

/** Все браузеры одного режима по очереди. */
export async function checkExample(
  o: ExampleCheckOptions,
): Promise<ExampleResult[]> {
  const results: ExampleResult[] = [];
  for (const name of o.browsers ?? BROWSERS) {
    results.push(await checkBrowser(name, o));
  }
  return results;
}

/** Провал: браузер не прошёл до конца или хоть одна проверка — «нет». */
export const exampleCheckFailed = (results: ExampleResult[]) =>
  results.some(
    (r) =>
      r.failure !== undefined ||
      Object.values(r.verdicts).some((v) => v.ok === false),
  );
