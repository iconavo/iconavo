// Сценарии боковой панели и страницы иконки проверки сайта (шаг 4 фазы 4, ADR-0041): панель мышью и с
// клавиатуры, каталог при открытой панели, переход на страницу иконки, страница иконки и шторка на
// телефоне. Сведения панель берёт у превью API: /icon отвечает по локальному Meilisearch (meili/local.ts),
// похожие — соседи по общим словам. Ошибки сценария — список «не так»; контрольный запуск подкладывает
// поломки скриптом до страницы и ждёт, что список не пуст.

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

/** Что видно в панели и вокруг неё. Выполняется в браузере. */
function panelFacts() {
  const panel = document.querySelector("aside.icon-panel");
  const active = document.activeElement as HTMLElement | null;
  const box = panel?.getBoundingClientRect();
  const icons = (selector: string) =>
    [...(panel?.querySelectorAll(selector) ?? [])].map(
      (e) => e.getAttribute("data-icon") ?? "",
    );
  return {
    open: panel !== null,
    icon: panel?.getAttribute("data-panel-icon") ?? "",
    details:
      panel?.querySelector(".icon-details")?.getAttribute("data-details") ?? "",
    focusInPanel: panel?.contains(active) === true,
    focusIcon: active?.getAttribute("data-icon") ?? "",
    search: location.search,
    history: history.length,
    variants: icons(".icon-variants .icon-variant"),
    similar: icons(".icon-similar .icon-variant"),
    stroke: (panel?.querySelectorAll('input[type="range"]').length ?? 0) > 1,
    color: panel?.querySelector('input[type="color"]') !== null,
    preview:
      (panel?.querySelector(".icon-preview svg")?.childNodes.length ?? 0) > 0,
    /** Фон превью на светлом и тёмном фоне — у каждой панели свой color-scheme. */
    backgrounds: [...(panel?.querySelectorAll(".icon-preview") ?? [])].map(
      (e) => getComputedStyle(e).backgroundColor,
    ),
    /** Заголовки разделов панели: описания, тегов и синонимов в ней нет (решение владельца 3 ноября 2026). */
    sections: [...(panel?.querySelectorAll(".icon-section-title") ?? [])].map(
      (e) => e.textContent?.trim() ?? "",
    ),
    /** Указание авторства: свёрнуто под стрелкой, текст — на весь набор и по-английски. */
    attribution: (() => {
      const block = panel?.querySelector("details.icon-attribution");
      return {
        present: block !== null && block !== undefined,
        open: block?.hasAttribute("open") === true,
        text: block?.querySelector(".icon-attribution-text")?.textContent ?? "",
      };
    })(),
    position: panel ? getComputedStyle(panel).position : "",
    top: box?.top ?? 0,
    height: box?.height ?? 0,
    viewport: innerHeight,
    wide: document.documentElement.scrollWidth > innerWidth,
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

/** Панель открыта с этой иконкой и сведения пришли. */
async function shown(page: Page, icon: string): Promise<Facts> {
  await page
    .waitForFunction(
      (name) => {
        const panel = document.querySelector("aside.icon-panel");
        return (
          panel?.getAttribute("data-panel-icon") === name &&
          panel.querySelector(".icon-details")?.getAttribute("data-details") ===
            "ready"
        );
      },
      icon,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  return facts(page);
}

async function closed(page: Page): Promise<Facts> {
  await page
    .waitForFunction(() => !document.querySelector("aside.icon-panel"), null, {
      timeout: PANEL_WAIT_MS,
    })
    .catch(() => {});
  return facts(page);
}

/** Имя иконки n-й карточки сетки. */
const cardName = (page: Page, n: number) =>
  page.locator("a.icon-card-link").nth(n).getAttribute("data-icon");

/**
 * Панель на странице набора мышью и с клавиатуры: адрес, фокус, смена иконки без новой записи истории,
 * Esc, ✕ и «назад»; смена фильтра при открытой панели и ✕ после неё; варианты по таблице стилей,
 * похожие, толщина и цвет — где положено; ссылка с ?icon=.
 */
export async function panelProblems(
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
  no(f.focusInPanel, "фокус после открытия — не в панели");
  no(f.preview, "превью в панели не нарисовано");
  no(
    f.backgrounds.length === 2 && f.backgrounds[0] !== f.backgrounds[1],
    `у превью на светлом и тёмном фоне один фон: ${f.backgrounds.join(", ")}`,
  );
  no(f.history === start.history + 1, "открытие не добавило запись истории");
  no(f.stroke, `у ${first} (Lucide) нет толщины линии`);
  no(f.color, `у ${first} нет выбора цвета`);
  no(
    f.variants.length === 0,
    `у ${first} один вариант, а блок вариантов показан: ${f.variants.join(", ")}`,
  );
  no(
    !f.sections.some((s) => /^(Description|Tags|Synonyms)$/.test(s)),
    `в панели — описание, теги или синонимы: ${f.sections.join(", ")}`,
  );
  no(
    f.attribution.present && !f.attribution.open,
    "указание авторства не свёрнуто под стрелкой",
  );
  await page
    .locator("aside.icon-panel details.icon-attribution summary")
    .click();
  const attribution = (await facts(page)).attribution;
  no(
    attribution.open &&
      attribution.text.startsWith("Icons: Lucide by ") &&
      attribution.text.includes("Includes icons from Feather"),
    `указание авторства — «${attribution.text.slice(0, 80)}», а ждали текст на весь набор Lucide с Feather`,
  );
  const opened = f.history;
  await page.locator("a.icon-card-link").nth(1).click();
  f = await shown(page, second);
  no(f.icon === second, "щелчок по второй карточке не сменил иконку панели");
  no(f.history === opened, "смена иконки добавила запись истории");
  no(f.focusIcon === second, "после смены иконки фокус ушёл с карточки");
  await page.keyboard.press("Escape");
  f = await closed(page);
  no(!f.open, "Esc не закрыл панель");
  no(f.search === "", `после Esc в адресе осталось «${f.search}»`);
  no(f.focusIcon === second, "после закрытия фокус не вернулся к карточке");

  // С клавиатуры: Enter на карточке, ✕.
  await page.locator("a.icon-card-link").nth(0).focus();
  await page.keyboard.press("Enter");
  f = await shown(page, first);
  no(f.open && f.focusInPanel, "Enter на карточке не открыл панель с фокусом");
  await page.getByRole("button", { name: /^(Close|Закрыть)$/ }).click();
  f = await closed(page);
  no(!f.open, "✕ не закрыл панель");
  no(f.focusIcon === first, "после ✕ фокус не вернулся к карточке");

  // «Назад» закрывает панель целиком, даже после смены иконки.
  await page.locator("a.icon-card-link").nth(0).click();
  await shown(page, first);
  await page.locator("a.icon-card-link").nth(1).click();
  await shown(page, second);
  await page.goBack();
  f = await closed(page);
  no(!f.open, "«назад» не закрыл панель");

  // Ссылка с панелью открывает ту же иконку.
  await page.goto(`${base}/${CATALOG_SET}?icon=${first}`);
  await hydrated(page);
  f = await shown(page, first);
  no(f.open && f.icon === first, "ссылка с ?icon= не открыла панель");
  await page.keyboard.press("Escape");
  f = await closed(page);
  no(f.search === "", "закрытие панели из ссылки не убрало icon из адреса");

  // Набор со стилями: варианты по таблице, фильтр при открытой панели, похожие, нет толщины линии.
  await page.goto(`${base}/${STYLES_SET}`);
  await hydrated(page);
  const card = (await cardName(page, 0)) ?? "";
  await page.locator("a.icon-card-link").nth(0).click();
  f = await shown(page, card);
  const base0 = card.slice(card.indexOf(":") + 1);
  const outline = ["-thin", "-light", "", "-bold"].map(
    (s) => `${STYLES_SET}:${base0}${s}`,
  );
  no(
    outline.every((n, i) => f.variants[i] === n),
    `варианты ${card} — ${f.variants.slice(0, 4).join(", ")}, а ждали ${outline.join(", ")}`,
  );
  no(!f.stroke, `у ${card} (Phosphor) есть толщина линии`);
  no(f.similar.length > 0, `у ${card} нет похожих`);
  const fill = `${STYLES_SET}:${base0}-fill`;
  await page
    .locator(`aside.icon-panel .icon-variant[data-icon="${fill}"]`)
    .click();
  f = await shown(page, fill);
  no(f.icon === fill, `вариант ${fill} не открылся в панели`);
  const similar = f.similar[0];
  if (similar !== undefined) {
    await page
      .locator(
        `aside.icon-panel .icon-similar .icon-variant[data-icon="${similar}"]`,
      )
      .click();
    f = await shown(page, similar);
    no(f.icon === similar, `похожая ${similar} не открылась в панели`);
  }
  await page
    .getByRole("link", { name: /^(Filled|Заливка)\b/ })
    .first()
    .click();
  await page.waitForFunction(() => location.search.includes("style=filled"));
  f = await facts(page);
  no(f.open, "смена фильтра закрыла панель");
  await page.getByRole("button", { name: /^(Close|Закрыть)$/ }).click();
  f = await closed(page);
  no(!f.open, "✕ после смены фильтра не закрыл панель");
  no(
    f.search.includes("style=filled") && !f.search.includes("icon="),
    `после ✕ адрес — «${f.search}»: «назад» отменил фильтр или icon остался`,
  );

  // Цветной набор: выбора цвета нет.
  await page.goto(
    `${base}/fluent-emoji-flat?icon=fluent-emoji-flat:waving-hand`,
  );
  await hydrated(page);
  f = await shown(page, "fluent-emoji-flat:waving-hand");
  no(!f.color, "у цветной иконки есть выбор цвета");
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
        "мышью и с клавиатуры: адрес, фокус, Esc, ✕, «назад», ссылка с ?icon=; фильтр при открытой панели; варианты, похожие, толщина и цвет; axe в обеих темах",
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

/** Шторка на телефоне: снизу, выдача над ней видна и щёлкается, «развернуть», «назад», без прокрутки вбок. */
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
  const second = (await cardName(page, 1)) ?? "";
  await page.locator("a.icon-card-link").nth(0).click();
  let f = await shown(page, first);
  no(f.position === "fixed", `шторка — position: ${f.position}, а ждали fixed`);
  no(
    f.height <= f.viewport * 0.62 && f.top > 0,
    `шторка занимает ${Math.round(f.height)} из ${f.viewport} px — больше 60%`,
  );
  no(!f.wide, "с открытой шторкой страница шире экрана");
  await page.locator("a.icon-card-link").nth(1).click();
  f = await shown(page, second);
  no(f.icon === second, "карточка над шторкой не сменила иконку");
  await page.getByRole("button", { name: /^(Expand|Развернуть)$/ }).click();
  f = await facts(page);
  no(f.top <= 1, `развёрнутая шторка начинается на ${Math.round(f.top)} px`);
  await page.getByRole("button", { name: /^(Collapse|Свернуть)$/ }).click();
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
        "375 px: шторка снизу до 60% экрана, выдача над ней щёлкается, «развернуть» — во весь экран, «назад» закрывает",
      )
    : fail(problems.slice(0, 4).join("; "));
}
