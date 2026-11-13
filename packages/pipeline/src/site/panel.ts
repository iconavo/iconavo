// Сценарии боковой панели и страницы иконки проверки сайта (шаг 4 фазы 4, ADR-0041; редизайн — панель во
// всю высоту страницы): панель мышью и с клавиатуры, сетка не прыгает при открытии и закрытии, каталог и
// поиск при открытой панели, раскладка на разной ширине окна, страница иконки и шторка на телефоне. Ошибки
// сценария — список «не так»; контрольный запуск подкладывает поломки скриптом до страницы и ждёт, что
// список не пуст.

import type { Browser, Page } from "playwright";
import { type AxeViolation, axe, axeVerdict, runAxe } from "../sandbox/axe.js";
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
  CATALOG_SET,
  CRAWL_ICON_NAMES,
  DESKTOP,
  MOCKUPS,
  PANEL_WAIT_MS,
  PHONE,
  STYLES_SET,
} from "./config.js";
import { type CrawledPage, iconPagesProblems } from "./crawl.js";

export interface PanelCheckOptions {
  base: string;
  pages: CrawledPage[];
}

/** Панель в своём месте справа от страницы (#page-panel); уходящая копия — не она. */
const PANEL = "#page-panel > aside.icon-panel";

/** Что видно в панели и вокруг неё. Выполняется в браузере. */
function panelFacts() {
  const panel = document.querySelector("#page-panel > aside.icon-panel");
  const active = document.activeElement as HTMLElement | null;
  const box = panel?.getBoundingClientRect();
  const state = history.state as { iconavoPanel?: unknown } | null;
  const root = document.documentElement;
  return {
    open: panel !== null,
    icon: panel?.getAttribute("data-panel-icon") ?? "",
    focusInPanel: panel?.contains(active) === true,
    focusTitle: active?.id === "icon-panel-title",
    focusIcon: active?.getAttribute("data-icon") ?? "",
    search: decodeURIComponent(location.search),
    history: history.length,
    marker: typeof state?.iconavoPanel === "string",
    /** Сколько превью нарисовано (светлое и тёмное). */
    drawn: [...(panel?.querySelectorAll(".panel-preview svg") ?? [])].filter(
      (svg) => svg.childNodes.length > 0,
    ).length,
    color: panel?.querySelector('input[type="color"]') != null,
    stroke: panel?.querySelector('input[type="range"]') != null,
    position: panel ? getComputedStyle(panel).position : "",
    left: box?.left ?? 0,
    top: box?.top ?? 0,
    right: box?.right ?? 0,
    bottom: box?.bottom ?? 0,
    width: innerWidth,
    /** Правый край затемнения шторки: оно, как и шторка, закреплено во весь экран — по нему её ширина. */
    backdrop:
      document
        .querySelector("#page-panel > .panel-backdrop")
        ?.getBoundingClientRect().right ?? 0,
    height: root.clientHeight,
    wide: root.scrollWidth > root.clientWidth,
  };
}

type Facts = ReturnType<typeof panelFacts>;
const facts = (page: Page): Promise<Facts> => page.evaluate(panelFacts);

/** Гидратация закончилась — у main есть данные React. */
export async function hydrated(page: Page) {
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
 * Страница успокоилась: прошло несколько кадров (высоту панели по прокрутке пересчитывает кадр после события
 * прокрутки, lib/panel-fit.ts) и закончились движения — переход колонок, появление и уход панели
 * (бесконечные анимации не в счёт).
 */
async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let left = 3;
        const tick = () => {
          left -= 1;
          if (left === 0) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== "running" ||
              !Number.isFinite(Number(a.effect?.getComputedTiming().endTime)),
          ),
      null,
      { timeout: 5_000 },
    )
    .catch(() => {});
}

/** Панель открыта с этой иконкой, оба превью нарисованы, движения закончились. */
async function shown(page: Page, icon: string): Promise<Facts> {
  await page
    .waitForFunction(
      ([selector, name]) => {
        const panel = document.querySelector(selector as string);
        return (
          panel !== null &&
          panel.getAttribute("data-panel-icon") === name &&
          [...panel.querySelectorAll(".panel-preview svg")].filter(
            (svg) => svg.childNodes.length > 0,
          ).length === 2
        );
      },
      [PANEL, icon],
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  await settled(page);
  return facts(page);
}

async function closed(page: Page): Promise<Facts> {
  await page
    .waitForFunction(
      () =>
        !document.querySelector("#page-panel > aside.icon-panel") &&
        !document.querySelector(".panel-leaving"),
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  await settled(page);
  return facts(page);
}

/** Имя иконки n-й карточки сетки. */
const cardName = (page: Page, n: number) =>
  page.locator("a.icon-card-link").nth(n).getAttribute("data-icon");

/** Верх карточки этой иконки в окне. */
const cardTop = (page: Page, name: string) =>
  page.evaluate((icon) => {
    for (const a of document.querySelectorAll<HTMLElement>(
      "a.icon-card-link",
    )) {
      if (a.dataset.icon === icon)
        return Math.round(a.getBoundingClientRect().top);
    }
    return Number.NaN;
  }, name);

/**
 * Ширина, на которой с открытой панелью левая колонка узкая: шапка набора и строка поиска в ней выше —
 * на ней видно, что сетка не прыгает (план редизайна, шаг 5). В WebKit 1024 px — уже телефон.
 */
const NARROW = { width: 1040, height: 900 };

/**
 * Панель на странице набора мышью и с клавиатуры: адрес, фокус, смена иконки без новой записи истории,
 * Esc, ✕, «назад» и «вперёд», ссылка с ?icon=; сетка не прыгает при открытии и закрытии; другая страница
 * сетки при открытой панели; панель в поиске; цвет и толщина линии — где положено.
 */
export async function panelProblems(
  page: Page,
  base: string,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  await page.setViewportSize(DESKTOP);
  await page.goto(`${base}/${CATALOG_SET}`);
  await hydrated(page);
  const first = (await cardName(page, 0)) ?? "";
  const second = (await cardName(page, 1)) ?? "";
  const start = await facts(page);

  // Мышью: открыть, сменить, Esc.
  await page.locator("a.icon-card-link").nth(0).click();
  let f = await shown(page, first);
  no(f.open && f.icon === first, `щелчок по ${first} не открыл панель`);
  no(
    f.search === `?icon=${first}`,
    `адрес после открытия — «${f.search}», а ждали ?icon=${first}`,
  );
  no(f.focusTitle, "фокус после открытия — не на заголовке панели");
  no(f.drawn === 2, "превью в панели не нарисованы");
  no(f.history === start.history + 1, "открытие не добавило запись истории");
  no(f.marker, "у записи открытия нет пометки панели");
  no(f.color, `у ${first} (Lucide) нет выбора цвета`);
  no(f.stroke, `у ${first} (Lucide) нет толщины линии`);
  const opened = f.history;
  await page.locator("a.icon-card-link").nth(1).click();
  f = await shown(page, second);
  no(f.icon === second, "щелчок по второй карточке не сменил иконку панели");
  no(f.history === opened, "смена иконки добавила запись истории");
  no(!f.focusInPanel, "смена иконки щелчком увела фокус в панель");
  await page.keyboard.press("Escape");
  f = await closed(page);
  no(!f.open, "Esc не закрыл панель");
  no(f.search === "", `после Esc в адресе осталось «${f.search}»`);
  no(f.focusIcon === second, "после закрытия фокус не вернулся к карточке");

  // С клавиатуры: Enter на карточке, Tab — в панели, ✕.
  await page.locator("a.icon-card-link").nth(0).focus();
  await page.keyboard.press("Enter");
  f = await shown(page, first);
  no(f.open && f.focusTitle, "Enter на карточке не открыл панель с фокусом");
  await page.keyboard.press("Tab");
  f = await facts(page);
  no(f.focusInPanel, "Tab с заголовка панели увёл фокус из панели");
  await page.getByRole("button", { name: /^(Close|Закрыть)$/ }).click();
  f = await closed(page);
  no(!f.open, "✕ не закрыл панель");
  no(f.focusIcon === first, "после ✕ фокус не вернулся к карточке");

  // «Назад» закрывает панель целиком, даже после смены иконки; «вперёд» открывает последнюю.
  await page.locator("a.icon-card-link").nth(0).click();
  await shown(page, first);
  await page.locator("a.icon-card-link").nth(1).click();
  await shown(page, second);
  await page.goBack();
  f = await closed(page);
  no(!f.open, "«назад» не закрыл панель");
  await page.goForward();
  f = await shown(page, second);
  no(
    f.open && f.icon === second,
    "«вперёд» не открыл панель с последней иконкой",
  );
  await page.goBack();
  await closed(page);

  // Ссылка с панелью открывает ту же иконку; ✕ убирает icon из адреса, не уходя со страницы.
  await page.goto(`${base}/${CATALOG_SET}?icon=${first}`);
  await hydrated(page);
  f = await shown(page, first);
  no(f.open && f.icon === first, "ссылка с ?icon= не открыла панель");
  const linked = f.history;
  await page.keyboard.press("Escape");
  f = await closed(page);
  no(f.search === "", "закрытие панели из ссылки не убрало icon из адреса");
  no(f.history === linked, "закрытие панели из ссылки добавило запись истории");

  // Другая страница сетки при открытой панели: панель остаётся, ✕ — без «назад».
  await page.locator("a.icon-card-link").nth(0).click();
  await shown(page, first);
  await page.locator(".pagination a", { hasText: /^2$/ }).first().click();
  await page.waitForFunction(() => location.search.includes("page=2"));
  f = await shown(page, first);
  no(
    f.open && f.icon === first,
    "переход на вторую страницу сетки закрыл панель",
  );
  // ✕ — только если панель открыта: иначе ожидание кнопки вместо понятной ошибки.
  if (f.open) {
    await page.getByRole("button", { name: /^(Close|Закрыть)$/ }).click();
    f = await closed(page);
    no(
      f.search === "?page=2",
      `после ✕ адрес — «${f.search}», а ждали ?page=2: «назад» отменил страницу или icon остался`,
    );
  }

  // Сетка не прыгает (план редизайна, шаг 5): с панелью шапка набора и строка поиска в узкой колонке выше,
  // и карточки уезжали на высоту разницы — браузеры держали прокрутку по-разному, теперь её держит сайт
  // (apps/site/lib/panel-anchor.ts). И через Esc, и через «назад» браузера.
  await page.setViewportSize(NARROW);
  await page.goto(`${base}/${CATALOG_SET}`);
  await hydrated(page);
  const columns = await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector(".icon-grid") as Element,
      ).gridTemplateColumns.split(" ").length,
  );
  const n = columns * 4 + 1;
  const card = (await cardName(page, n)) ?? "";
  await page.evaluate((icon) => {
    for (const a of document.querySelectorAll<HTMLElement>(
      "a.icon-card-link",
    )) {
      if (a.dataset.icon === icon)
        scrollBy(0, a.getBoundingClientRect().top - 450);
    }
  }, card);
  await settled(page);
  for (const how of ["Esc", "«назад»"] as const) {
    const before = await cardTop(page, card);
    await page.locator("a.icon-card-link").nth(n).click();
    await shown(page, card);
    const open = await cardTop(page, card);
    no(
      Math.abs(open - before) <= 2,
      `открытие панели сдвинуло карточку ${card}: ${before} → ${open} px`,
    );
    if (how === "Esc") await page.keyboard.press("Escape");
    else await page.goBack();
    await closed(page);
    const after = await cardTop(page, card);
    no(
      Math.abs(after - before) <= 2,
      `закрытие панели (${how}) сдвинуло карточку ${card}: ${before} → ${after} px`,
    );
  }
  await page.setViewportSize(DESKTOP);

  // Поиск: та же панель во всю высоту — справа от поля и выдачи.
  await page.goto(`${base}/search?q=house&icon=${CRAWL_ICON_NAMES[0]}`);
  await hydrated(page);
  f = await shown(page, CRAWL_ICON_NAMES[0] as string);
  const hero = await page.evaluate(() => {
    const box = document.querySelector(".hero")?.getBoundingClientRect();
    return { right: box?.right ?? 0, top: box?.top ?? 0 };
  });
  no(f.open, "ссылка с ?icon= на странице поиска не открыла панель");
  no(
    f.left >= hero.right - 1,
    `панель в поиске заходит на поле поиска: панель с ${Math.round(f.left)} px, поле до ${Math.round(hero.right)} px`,
  );
  await page.keyboard.press("Escape");
  f = await closed(page);
  no(!f.open && f.search === "?q=house", `Esc в поиске: адрес «${f.search}»`);

  // Набор со стилями без линий и цветной набор: лишних настроек нет.
  await page.goto(`${base}/${STYLES_SET}?icon=${CRAWL_ICON_NAMES[1]}`);
  await hydrated(page);
  f = await shown(page, CRAWL_ICON_NAMES[1] as string);
  no(f.drawn === 2, `${CRAWL_ICON_NAMES[1]} в панели не нарисована`);
  no(!f.stroke, `у ${CRAWL_ICON_NAMES[1]} (Phosphor) есть толщина линии`);
  no(f.color, `у ${CRAWL_ICON_NAMES[1]} нет выбора цвета`);
  await page.goto(`${base}/fluent-emoji-flat?icon=${CRAWL_ICON_NAMES[4]}`);
  await hydrated(page);
  f = await shown(page, CRAWL_ICON_NAMES[4] as string);
  no(f.drawn === 2, `${CRAWL_ICON_NAMES[4]} в панели не нарисована`);
  no(!f.color && !f.stroke, "у цветной иконки есть выбор цвета или толщины");

  // Ссылка на несуществующую иконку: строка «нет» вместо превью, настроек и кода (решение владельца
  // 13 ноября 2026). Своя вкладка: ядро пишет в консоль о каждой ненайденной иконке, а сторож консоли
  // сценария этого не ждёт.
  const other = await page.context().newPage();
  await other.goto(`${base}/${CATALOG_SET}?icon=${CATALOG_SET}:no-such-icon`);
  await hydrated(other);
  await other
    .waitForSelector(`${PANEL} .panel-missing`, { timeout: PANEL_WAIT_MS })
    .catch(() => {});
  const missing = await other.evaluate(() => {
    const panel = document.querySelector("#page-panel > aside.icon-panel");
    return {
      text: panel?.querySelector(".panel-missing")?.textContent ?? "",
      previews: panel?.querySelectorAll(".panel-preview").length ?? 0,
    };
  });
  no(
    missing.text !== "" && missing.previews === 0,
    `ссылка на несуществующую иконку: строки «такой иконки нет» не видно${missing.previews > 0 ? ", а превью есть" : ""}`,
  );
  await other.close();
  return problems;
}

/** Строка «Панель»: сценарий, CSP и консоль, axe с открытой панелью в обеих темах. */
export async function checkPanel(
  browser: Browser,
  o: PanelCheckOptions,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems = await panelProblems(page, o.base);
  shots.push({
    title: "Панель иконки — цветной набор",
    png: await shot(page, seen),
  });
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  const axePages: { path: string; violations: AxeViolation[] }[] = [];
  for (const scheme of ["light", "dark"] as const) {
    const themed = await browser.newContext({
      viewport: DESKTOP,
      colorScheme: scheme,
    });
    const p = await themed.newPage();
    await p.goto(`${o.base}/${CATALOG_SET}?icon=${CRAWL_ICON_NAMES[0]}`);
    await hydrated(p);
    await shown(p, CRAWL_ICON_NAMES[0] as string);
    await runAxe(p, await axe(), `/${CATALOG_SET}?icon=…, ${scheme}`, axePages);
    await themed.close();
  }
  const access = axeVerdict(axePages);
  if (access.ok === false) problems.push(`axe: ${access.note}`);
  await context.close();
  return problems.length === 0
    ? pass(
        "мышью и с клавиатуры: адрес, фокус, Esc, ✕, «назад» и «вперёд», ссылка с ?icon=; сетка не прыгает при открытии и закрытии (1040 px); вторая страница сетки и поиск с панелью; цвет и толщина — где положено; несуществующая иконка — «нет»; axe в обеих темах",
      )
    : fail(problems.slice(0, 4).join("; "));
}

/** Мокапы на странице иконки: сколько мест и панелей тем, что нарисовано, фон тем, цвет и высота иконки. */
function mockupFacts() {
  const panes = [...document.querySelectorAll(".mockup-pane")];
  const svgs = panes.flatMap((pane) => [...pane.querySelectorAll("svg")]);
  const bg = (selector: string) => {
    const pane = document.querySelector(selector);
    return pane ? getComputedStyle(pane).backgroundColor : "";
  };
  const main = panes.map((pane) => pane.querySelector("svg[color]"));
  return {
    mockups: document.querySelectorAll(".mockup[data-mockup]").length,
    panes: panes.length,
    svgs: svgs.length,
    drawn: svgs.filter(
      (svg) => svg.hasAttribute("viewBox") && svg.childNodes.length > 0,
    ).length,
    light: bg(".mockup-light"),
    dark: bg(".mockup-dark"),
    colors: [...new Set(main.map((svg) => svg?.getAttribute("color") ?? ""))],
    firstHeight: main[0]?.getAttribute("height") ?? "",
    hidden: panes.every((pane) => pane.getAttribute("aria-hidden") === "true"),
  };
}

/**
 * Страница иконки: серверный HTML со сведениями, иконкой, мокапами и меткой версии; скрытая — «Устарела» и
 * noindex; в браузере — настройки из адреса в превью и мокапах, переход из панели с настройками.
 */
export async function iconPageProblems(
  page: Page,
  o: PanelCheckOptions,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  // Серверный HTML страниц выборки — тот же разбор, что у pnpm site --live.
  problems.push(...iconPagesProblems(o.pages));
  // Строка «по мотивам Feather» — только у иконок из Feather, а текст указания авторства — на весь набор:
  // у любой иконки Lucide в нём есть Feather (решение владельца 3 ноября 2026).
  const house = o.pages.find((p) => p.path === "/lucide/house")?.html ?? "";
  no(
    !house.includes('class="icon-credit"'),
    "/lucide/house: строка «по мотивам Feather» у иконки не из Feather",
  );
  no(
    house.includes("Includes icons from Feather"),
    "/lucide/house: в указании авторства набора нет Feather",
  );

  // Настройки из адреса.
  await page.goto(
    `${o.base}/lucide/house?size=64&color=e11d48&stroke=1.5&rotate=90&flip=horizontal`,
  );
  await hydrated(page);
  await page
    .waitForFunction(
      () =>
        document.querySelector(".icon-preview svg")?.getAttribute("color") ===
        "#e11d48",
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  const preview = await page.evaluate(() => {
    const svg = document.querySelector(".icon-preview svg");
    return {
      color: svg?.getAttribute("color") ?? "",
      height: svg?.getAttribute("height") ?? "",
      size: document.querySelector(".icon-preview-size")?.textContent ?? "",
      stroke: svg?.innerHTML.includes('stroke-width="1.5"') === true,
    };
  });
  no(
    preview.color === "#e11d48",
    `цвет из адреса не применён: «${preview.color}»`,
  );
  // Превью всегда крупное, размер копии и кода — подписью под ним (решение владельца 3 ноября 2026).
  no(
    preview.height === "96",
    `превью не крупное: высота «${preview.height}», а ждали 96`,
  );
  no(
    preview.size === "64 × 64 px",
    `размер из адреса не применён: под превью «${preview.size}»`,
  );
  no(preview.stroke, "толщина линии из адреса не применена");

  // Мокапы: восемь мест в двух темах, всё нарисовано; у иконки — цвет из адреса и размер места, не превью.
  await page
    .waitForFunction(
      () => {
        const svgs = [...document.querySelectorAll(".mockup-pane svg")];
        return (
          svgs.length > 0 &&
          svgs.every(
            (s) => s.hasAttribute("viewBox") && s.childNodes.length > 0,
          )
        );
      },
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  const m = await page.evaluate(mockupFacts);
  no(
    m.mockups === MOCKUPS && m.panes === MOCKUPS * 2,
    `мокапов ${m.mockups}, панелей тем ${m.panes}, а ждали ${MOCKUPS} и ${MOCKUPS * 2}`,
  );
  no(m.drawn === m.svgs, `в мокапах нарисовано ${m.drawn} иконок из ${m.svgs}`);
  no(
    m.light !== "" && m.light !== m.dark,
    `у светлой и тёмной темы мокапа один фон: ${m.light}`,
  );
  no(
    m.colors.length === 1 && m.colors[0] === "#e11d48",
    `цвет иконки в мокапах — ${m.colors.join(", ")}, а ждали #e11d48`,
  );
  no(
    m.firstHeight === "20",
    `иконка в кнопке — ${m.firstHeight} px, а ждали 20: размер из настроек меняет только превью`,
  );
  no(m.hidden, "мокапы не скрыты от экранных дикторов");

  // Из панели — на страницу с настройками.
  await page.goto(`${o.base}/${CATALOG_SET}`);
  await hydrated(page);
  const first = (await cardName(page, 0)) ?? "";
  await page.locator("a.icon-card-link").nth(0).click();
  await shown(page, first);
  await page.getByRole("button", { name: "90°" }).click();
  await page
    .getByRole("link", { name: /Open icon page|Открыть страницу иконки/ })
    .click();
  await page
    .waitForURL((url) => url.pathname === `/${first.replace(":", "/")}`, {
      timeout: PANEL_WAIT_MS,
    })
    .catch(() => {});
  const url = new URL(page.url());
  no(
    url.pathname === `/${first.replace(":", "/")}` &&
      url.searchParams.get("rotate") === "90",
    `«Открыть страницу иконки» привела на ${url.pathname}${url.search}`,
  );
  return problems;
}

export async function checkIconPage(
  browser: Browser,
  o: PanelCheckOptions,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems = await iconPageProblems(page, o);
  shots.push({ title: "Страница иконки", png: await shot(page, seen) });
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();
  return problems.length === 0
    ? pass(
        `${CRAWL_ICON_NAMES.length * 2} страниц: серверный HTML со сведениями и иконкой, метка версии; «Устарела»; настройки из адреса; переход из панели с настройками`,
      )
    : fail(problems.slice(0, 4).join("; "));
}

/** Раскладка вокруг панели. Выполняется в браузере. */
function layoutFacts() {
  const box = (selector: string) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    return r === undefined
      ? undefined
      : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const grid = document.querySelector(".icon-grid");
  const toolbar = document.querySelector(".grid-toolbar");
  const bar = toolbar?.getBoundingClientRect();
  const panel = document.querySelector("#page-panel > aside.icon-panel");
  const root = document.documentElement;
  return {
    panel: box("#page-panel > aside.icon-panel"),
    position: panel ? getComputedStyle(panel).position : "",
    crumbs: box(".crumbs"),
    grid: box(".icon-grid"),
    footer: box(".site-footer"),
    main: box("main"),
    columns: grid
      ? getComputedStyle(grid).gridTemplateColumns.split(" ").length
      : 0,
    card: grid?.firstElementChild?.getBoundingClientRect().width ?? 0,
    /** Части строки поиска, вылезающие за неё. */
    toolbarOut:
      toolbar && bar
        ? [...toolbar.querySelectorAll("*")].filter((e) => {
            const r = e.getBoundingClientRect();
            return (
              r.width > 1 &&
              r.height > 1 &&
              (r.right > bar.right + 1 || r.left < bar.left - 1)
            );
          }).length
        : 0,
    width: innerWidth,
    height: root.clientHeight,
    wide: root.scrollWidth > root.clientWidth,
  };
}

type Layout = ReturnType<typeof layoutFacts>;

/** Ширины окна для строки «Раскладка»: от узкой колонки до широкого экрана. */
const WIDTHS = [1040, 1280, 1440, 1920, 2560] as const;

export interface LayoutOptions {
  /** Только эти ширины и без сценариев прокрутки (контрольный запуск). */
  widths?: readonly number[];
  /** Скрипт до страницы — поломка контрольного запуска. */
  init?: () => void;
}

/**
 * Панель во всю высоту страницы (план редизайна): справа от страницы с отступом края, с уровня хлебных
 * крошек, помещается в окно; колонки сетки — те же, что без панели (зависят только от ширины окна);
 * строка поиска не вылезает; без прокрутки вбок. На 1440 px — ещё свёрнутый сайдбар, прилипание во всю
 * высоту окна, подвал, короткая страница и смена ширины окна через 1024 px.
 */
export async function layoutProblems(
  browser: Browser,
  base: string,
  o: LayoutOptions = {},
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const r = Math.round;
  /** Панель на месте: справа с отступом края, правее сетки, в окне. */
  const placed = (at: string, l: Layout) => {
    const p = l.panel;
    if (p === undefined) {
      no(false, `${at}: панели нет`);
      return;
    }
    const gutter = l.width - p.right;
    no(
      gutter >= 24 && gutter <= 48,
      `${at}: от панели до края окна ${r(gutter)} px, а ждали отступ страницы`,
    );
    no(
      l.grid === undefined || l.grid.right <= p.left - 16,
      `${at}: сетка заходит под панель (сетка до ${r(l.grid?.right ?? 0)}, панель с ${r(p.left)} px)`,
    );
    no(
      p.bottom <= l.height - 16 + 1,
      `${at}: низ панели ${r(p.bottom)} px — за окном ${l.height} px`,
    );
    no(!l.wide, `${at}: страница шире окна`);
    no(l.toolbarOut === 0, `${at}: строка поиска вылезает за свою колонку`);
  };
  for (const width of o.widths ?? WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    if (o.init) await context.addInitScript(o.init);
    const page = await context.newPage();
    await page.goto(`${base}/${CATALOG_SET}`);
    await hydrated(page);
    await settled(page);
    const without = await page.evaluate(layoutFacts);
    const first = (await cardName(page, 0)) ?? "";
    await page.locator("a.icon-card-link").nth(0).click();
    await shown(page, first);
    const l = await page.evaluate(layoutFacts);
    const at = `${width} px`;
    placed(at, l);
    no(
      l.panel === undefined ||
        l.crumbs === undefined ||
        Math.abs(l.panel.top - l.crumbs.top) <= 4,
      `${at}: панель начинается на ${r(l.panel?.top ?? 0)} px, а хлебные крошки — на ${r(l.crumbs?.top ?? 0)} px`,
    );
    no(
      l.columns === without.columns,
      `${at}: колонок сетки с панелью ${l.columns}, без панели ${without.columns}`,
    );
    no(
      l.card < without.card,
      `${at}: карточки с панелью не уже (${r(l.card)} и ${r(without.card)} px)`,
    );
    if (width === 1440 && o.widths === undefined) {
      // Свёрнутый сайдбар: панель на месте, колонки те же.
      await page.locator(".sidebar-toggle").first().click();
      await settled(page);
      await page.waitForTimeout(300);
      const folded = await page.evaluate(layoutFacts);
      placed(`${at}, сайдбар свёрнут`, folded);
      no(
        folded.columns === without.columns,
        `${at}, сайдбар свёрнут: колонок ${folded.columns}, а ждали ${without.columns}`,
      );
      await page.locator(".sidebar-toggle").first().click();
      await settled(page);
      await page.waitForTimeout(300);

      // Прокрутка: панель прилипает во всю высоту окна; внизу не заходит на подвал.
      await page.evaluate(() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        scrollTo(
          0,
          Math.max(200, (main?.bottom ?? 0) + scrollY - innerHeight - 300),
        );
      });
      await settled(page);
      const middle = await page.evaluate(layoutFacts);
      no(
        middle.panel !== undefined &&
          Math.abs(middle.panel.top - 16) <= 1 &&
          Math.abs(middle.panel.bottom - (middle.height - 16)) <= 1,
        `${at}, прокрутка: панель ${r(middle.panel?.top ?? 0)}–${r(middle.panel?.bottom ?? 0)} px, а ждали 16–${middle.height - 16}`,
      );
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight),
      );
      await settled(page);
      const end = await page.evaluate(layoutFacts);
      no(
        end.panel !== undefined &&
          end.footer !== undefined &&
          end.panel.bottom <= end.footer.top + 1,
        `${at}, конец страницы: панель (до ${r(end.panel?.bottom ?? 0)} px) заходит на подвал (с ${r(end.footer?.top ?? 0)} px)`,
      );
      // Внизу панель становится ниже, а не уезжает вверх: заголовок и ✕ видны.
      no(
        end.panel !== undefined && end.panel.top >= 15,
        `${at}, конец страницы: панель уехала вверх — начинается на ${r(end.panel?.top ?? 0)} px`,
      );

      // Короткая страница — поиск по набору: страница не короче панели, подвал под ней.
      await page.goto(
        `${base}/${CATALOG_SET}?q=house&icon=${CRAWL_ICON_NAMES[0]}`,
      );
      await hydrated(page);
      await shown(page, CRAWL_ICON_NAMES[0] as string);
      const short = await page.evaluate(layoutFacts);
      placed(`${at}, поиск по набору`, short);
      no(
        short.panel !== undefined &&
          short.footer !== undefined &&
          short.panel.bottom <= short.footer.top + 1,
        `${at}, поиск по набору: панель заходит на подвал`,
      );

      // Окно уже 1024 px — шторка; снова шире — колонка справа.
      await page.setViewportSize({ width: 900, height: 900 });
      await settled(page);
      const phone = await page.evaluate(layoutFacts);
      no(
        phone.position === "fixed" &&
          phone.panel !== undefined &&
          Math.abs(phone.panel.bottom - phone.height) <= 1,
        `окно 900 px: панель — ${phone.position}, низ ${r(phone.panel?.bottom ?? 0)} px, а ждали шторку снизу`,
      );
      no(!phone.wide, "окно 900 px: страница шире окна");
      await page.setViewportSize({ width: 1440, height: 900 });
      await settled(page);
      const back = await page.evaluate(layoutFacts);
      placed(`${at} после 900 px`, back);
      no(
        back.position === "sticky",
        `${at} после 900 px: панель — ${back.position}, а ждали колонку справа`,
      );
    }
    await context.close();
  }
  return problems;
}

/** Строка «Раскладка»: сценарий, CSP и консоль. */
export async function checkLayout(
  browser: Browser,
  o: PanelCheckOptions,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const problems = await layoutProblems(browser, o.base);
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  await page.goto(`${o.base}/${CATALOG_SET}?icon=${CRAWL_ICON_NAMES[0]}`);
  await hydrated(page);
  await shown(page, CRAWL_ICON_NAMES[0] as string);
  shots.push({
    title: `Панель во всю высоту — ${DESKTOP.width} px`,
    png: await shot(page, seen),
  });
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();
  return problems.length === 0
    ? pass(
        `${WIDTHS.join(", ")} px: справа с отступом края, с уровня крошек, в окне, колонки сетки те же, строка поиска не вылезает; свёрнутый сайдбар, прилипание, подвал, короткая страница, окно 900 px и обратно`,
      )
    : fail(problems.slice(0, 4).join("; "));
}

/** Шторка на телефоне: снизу, затемнение закрывает, ручка раскрывает и сворачивает, «назад», без прокрутки вбок. */
export async function sheetProblems(
  page: Page,
  base: string,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  await page.goto(`${base}/${CATALOG_SET}`);
  await hydrated(page);
  const first = (await cardName(page, 0)) ?? "";
  await page.locator("a.icon-card-link").nth(0).click();
  let f = await shown(page, first);
  no(f.position === "fixed", `шторка — position: ${f.position}, а ждали fixed`);
  no(
    Math.abs(f.bottom - f.height) <= 1 &&
      f.left <= 0 &&
      f.right >= f.backdrop - 1,
    `шторка не во всю ширину снизу: ${Math.round(f.left)}–${Math.round(f.right)} × ${Math.round(f.top)}–${Math.round(f.bottom)} px`,
  );
  no(
    f.top >= f.height * 0.2 && f.top <= f.height * 0.5,
    `шторка начинается на ${Math.round(f.top)} из ${f.height} px`,
  );
  no(!f.wide, "с открытой шторкой страница шире экрана");
  const low = f.top;
  const handle = page.locator(`${PANEL} .panel-handle`);
  await handle.click();
  await settled(page);
  f = await facts(page);
  no(
    (await handle.getAttribute("aria-expanded")) === "true" && f.top < low - 50,
    `ручка не раскрыла шторку: верх ${Math.round(low)} → ${Math.round(f.top)} px`,
  );
  await handle.click();
  await settled(page);
  f = await facts(page);
  no(
    (await handle.getAttribute("aria-expanded")) === "false" &&
      Math.abs(f.top - low) <= 2,
    `ручка не свернула шторку: верх ${Math.round(f.top)}, а ждали ${Math.round(low)} px`,
  );
  await page
    .locator("#page-panel > .panel-backdrop")
    .click({ position: { x: 20, y: 120 } });
  f = await closed(page);
  no(!f.open, "затемнение над шторкой не закрыло её");
  no(f.search === "", `после затемнения в адресе осталось «${f.search}»`);
  await page.locator("a.icon-card-link").nth(0).click();
  await shown(page, first);
  await page.goBack();
  f = await closed(page);
  no(!f.open, "«назад» не закрыл шторку");
  return problems;
}

export async function checkSheet(
  browser: Browser,
  o: PanelCheckOptions,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems = await sheetProblems(page, o.base);
  await page.goto(`${o.base}/${CATALOG_SET}?icon=${CRAWL_ICON_NAMES[0]}`);
  await hydrated(page);
  await shown(page, CRAWL_ICON_NAMES[0] as string);
  shots.push({ title: "Шторка на телефоне", png: await shot(page, seen) });
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();
  return problems.length === 0
    ? pass(
        "375 px: шторка снизу во всю ширину, ручка раскрывает и сворачивает, затемнение и «назад» закрывают",
      )
    : fail(problems.slice(0, 4).join("; "));
}
