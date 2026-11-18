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
 * прокрутки, lib/panel-fit.ts) и закончились движения — переезд карточек, появление и уход панели
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

/**
 * Следить покадрово, пока панель открывается: не стала ли страница шире окна и не прокрутилась ли вбок
 * (18 ноября 2026: место панели с полем в колонке нулевой ширины давало 28 px лишней ширины, а фокус на
 * заголовке панели прокручивал к нему страницу). Выполняется в браузере.
 */
function watchSideways() {
  const seen = { x: 0, wide: 0 };
  (window as unknown as { __sideways?: typeof seen }).__sideways = seen;
  let left = 120;
  const tick = () => {
    const root = document.documentElement;
    seen.x = Math.max(seen.x, Math.abs(Math.round(window.scrollX)));
    seen.wide = Math.max(seen.wide, root.scrollWidth - root.clientWidth);
    left -= 1;
    if (left > 0) requestAnimationFrame(tick);
  };
  tick();
}

/** Что насмотрел watchSideways. */
const sideways = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __sideways?: { x: number; wide: number } })
        .__sideways ?? { x: 0, wide: 0 },
  );

/** Метки анимаций перехода панели на сайте (apps/site/components/panel/PanelLayout.tsx). */
const MOTION_IDS = ["iconavo-flip", "iconavo-panel-slide"];

/**
 * Останавливать анимации перехода панели в самом их начале: тогда видно, с какого вида движение
 * начинается, — и проверка не зависит от скорости машины. Выполняется в браузере.
 */
function holdMotion(ids: string[]) {
  const held: Animation[] = [];
  (window as unknown as { __held?: Animation[] }).__held = held;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const animation = animate.call(this, frames, options);
    if (
      typeof options === "object" &&
      options !== null &&
      ids.includes(String(options.id))
    ) {
      animation.pause();
      animation.currentTime = 0;
      held.push(animation);
    }
    return animation;
  };
}

/** Доиграть остановленные анимации разом; ответ — сколько их было. Выполняется в браузере. */
function releaseMotion() {
  const held = (window as unknown as { __held?: Animation[] }).__held ?? [];
  for (const animation of held) animation.finish();
  return held.length;
}

/** Места того, что переезжает, когда открывается панель. Выполняется в браузере. */
function motionFacts(icon: string) {
  const rect = (element: Element | null | undefined) => {
    const r = element?.getBoundingClientRect();
    return r === undefined
      ? undefined
      : { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  let link: HTMLElement | undefined;
  for (const a of document.querySelectorAll<HTMLElement>("a.icon-card-link")) {
    if (a.dataset.icon === icon) link = a;
  }
  return {
    card: rect(link?.parentElement),
    cardIcon: rect(link?.querySelector("svg")),
    cardName: rect(link?.querySelector(".icon-cell-name")),
    first: rect(document.querySelector(".icon-grid > li")),
    subscribe: rect(document.querySelector(".subscribe")),
    field: rect(document.querySelector(".grid-field")),
    fieldIcon: rect(document.querySelector(".grid-field .hero-field-icon")),
    pages: rect(document.querySelector(".grid-bar .pagination")),
    panel: rect(document.querySelector("#page-panel > aside.icon-panel")),
    /** Ширина колонки под панель по стилям: 0 — колонки нет. */
    column: Number.parseFloat(
      getComputedStyle(document.querySelector("main") as Element)
        .gridTemplateColumns.split(" ")
        .at(-1) ?? "0",
    ),
    /** Переходы ширины колонок в стилях: с ними страница раскладывается заново в каждом кадре. */
    transitions: document
      .getAnimations()
      .filter(
        (a) =>
          (a as CSSTransition).transitionProperty === "grid-template-columns",
      ).length,
  };
}

type MotionRect = NonNullable<ReturnType<typeof motionFacts>["card"]>;

/** Где страница и содержимое панели по вертикали и куда вести мышь. Выполняется в браузере. */
function scrollFacts() {
  const panel = document.querySelector("#page-panel > aside.icon-panel");
  const card = document.querySelector("a.icon-card-link");
  const p = panel?.getBoundingClientRect();
  const c = card?.getBoundingClientRect();
  return {
    page: Math.round(window.scrollY),
    panel: Math.round(panel?.scrollTop ?? 0),
    /** Сколько содержимого панели не помещается в неё. */
    room: panel ? panel.scrollHeight - panel.clientHeight : 0,
    panelX: p ? p.left + p.width / 2 : 0,
    panelY: p ? p.top + p.height / 2 : 0,
    gridX: c ? c.left + c.width / 2 : 0,
    gridY: c ? c.top + c.height / 2 : 0,
  };
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

  // Мышью: открыть, сменить, Esc. Пока панель открывается, страница не шире окна и не уезжает вбок.
  await page.evaluate(watchSideways);
  await page.locator("a.icon-card-link").nth(0).click();
  let f = await shown(page, first);
  no(f.open && f.icon === first, `щелчок по ${first} не открыл панель`);
  const side = await sideways(page);
  no(
    side.wide === 0,
    `пока панель открывалась, страница была шире окна на ${side.wide} px`,
  );
  no(
    side.x === 0,
    `пока панель открывалась, страница уезжала вбок на ${side.x} px`,
  );
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
  await page.evaluate(watchSideways);
  await page.keyboard.press("Escape");
  f = await closed(page);
  no(!f.open, "Esc не закрыл панель");
  const sideClose = await sideways(page);
  no(
    sideClose.wide === 0 && sideClose.x === 0,
    `пока панель закрывалась, страница была шире окна на ${sideClose.wide} px и уезжала вбок на ${sideClose.x} px`,
  );
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

  // Колесо над панелью крутит только её (решение владельца 18 ноября 2026): страница стоит и пока панель
  // прокручивается, и когда она дошла до конца; над сеткой колесо крутит страницу. WebKit у Playwright в
  // конце панели передаёт колесо странице (overscroll-behavior там не работает) — конец в нём не проверяется.
  await page.goto(`${base}/${CATALOG_SET}`);
  await hydrated(page);
  await page.locator("a.icon-card-link").nth(0).click();
  f = await shown(page, first);
  if (f.open) {
    const spin = async (times: number) => {
      for (let i = 0; i < times; i++) {
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(30);
      }
      await page.waitForTimeout(400);
      await settled(page);
    };
    let s = await page.evaluate(scrollFacts);
    no(
      s.room > 400,
      `содержимое панели помещается в окно (запас ${s.room} px) — колесо проверить не на чем`,
    );
    await page.mouse.move(s.panelX, s.panelY);
    await page.waitForTimeout(100);
    await spin(3);
    s = await page.evaluate(scrollFacts);
    no(s.panel > 0, "колесо над панелью не прокрутило её содержимое");
    no(s.page === 0, `колесо над панелью прокрутило страницу на ${s.page} px`);
    if (page.context().browser()?.browserType().name() !== "webkit") {
      await spin(25);
      s = await page.evaluate(scrollFacts);
      no(
        s.panel >= s.room - 1,
        `колесо не докрутило панель до конца: ${s.panel} из ${s.room} px`,
      );
      no(
        s.page === 0,
        `в конце панели колесо прокрутило страницу на ${s.page} px`,
      );
    }
    // Мышь ушла на сетку: пауза — Firefox ещё полторы секунды помнит, что крутило колесо.
    await page.mouse.move(s.gridX, s.gridY);
    await page.waitForTimeout(1600);
    const was = s.page;
    await spin(3);
    s = await page.evaluate(scrollFacts);
    no(s.page > was, "колесо над сеткой не прокрутило страницу");
    await page.keyboard.press("Escape");
    await closed(page);
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

  // Движение начинается с прежнего вида (18 ноября 2026): страница перестраивается один раз, а карточки,
  // строка поиска и кнопки доезжают до новых мест сдвигом — в первом кадре они там же, где были, и ничего
  // не перескакивает; панель выезжает из-за края и не лежит на том, что ещё едет. Страница в самом верху и
  // узкая: шапка набора и строка поиска с панелью выше — без движения сетка прыгала бы на их разницу.
  // Анимации останавливаются в начале (holdMotion) — от скорости машины проверка не зависит.
  await page.goto(`${base}/${CATALOG_SET}`);
  await hydrated(page);
  await settled(page);
  const m = columns + 2;
  const moving = (await cardName(page, m)) ?? "";
  const was = await page.evaluate(motionFacts, moving);
  await page.evaluate(holdMotion, MOTION_IDS);
  await page.locator("a.icon-card-link").nth(m).click();
  await shown(page, moving);
  const begun = await page.evaluate(motionFacts, moving);
  const same = (a: MotionRect | undefined, b: MotionRect | undefined) =>
    a !== undefined &&
    b !== undefined &&
    Math.abs(a.left - b.left) <= 1.5 &&
    Math.abs(a.top - b.top) <= 1.5 &&
    Math.abs(a.width - b.width) <= 1.5 &&
    Math.abs(a.height - b.height) <= 1.5;
  const where = (r: MotionRect | undefined) =>
    r === undefined
      ? "нет"
      : `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`;
  for (const [label, key] of [
    ["карточка иконки", "card"],
    ["иконка в карточке", "cardIcon"],
    ["первая карточка", "first"],
    ["Subscribe", "subscribe"],
    ["поле поиска", "field"],
    ["значок в поле поиска", "fieldIcon"],
    ["номера страниц", "pages"],
  ] as const) {
    no(
      same(begun[key], was[key]),
      `в начале движения ${label} не на прежнем месте: было ${where(was[key])}, стало ${where(begun[key])}`,
    );
  }
  no(
    begun.cardName !== undefined &&
      was.cardName !== undefined &&
      Math.abs(begun.cardName.left - was.cardName.left) <= 1.5 &&
      Math.abs(begun.cardName.top - was.cardName.top) <= 1.5,
    `в начале движения подпись карточки не там, где была: было ${where(was.cardName)}, стало ${where(begun.cardName)}`,
  );
  no(
    begun.column > 300,
    `колонка под панель не сразу своей ширины: ${begun.column} px`,
  );
  no(
    begun.transitions === 0,
    "ширина колонок переходит в стилях — страница раскладывается заново в каждом кадре",
  );
  no(
    begun.panel !== undefined &&
      was.subscribe !== undefined &&
      begun.panel.left >= was.subscribe.left + was.subscribe.width,
    `в начале движения панель лежит на «Subscribe»: панель с ${Math.round(begun.panel?.left ?? 0)} px`,
  );
  const played = await page.evaluate(releaseMotion);
  no(played > 10, `переезд не запущен: анимаций перехода — ${played}`);
  await settled(page);
  const end = await page.evaluate(motionFacts, moving);
  no(
    end.card !== undefined &&
      was.card !== undefined &&
      end.card.width < was.card.width - 10,
    `после движения карточка не уже: было ${where(was.card)}, стало ${where(end.card)}`,
  );
  await page.keyboard.press("Escape");
  await closed(page);
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
        "мышью и с клавиатуры: адрес, фокус, Esc, ✕, «назад» и «вперёд», ссылка с ?icon=; при открытии и закрытии страница не шире окна и не уезжает вбок; колесо над панелью крутит только её, над сеткой — страницу; движение начинается с прежнего вида — карточки, поле поиска и кнопки доезжают сдвигом, колонка под панель сразу своей ширины; сетка не прыгает при открытии и закрытии (1040 px); вторая страница сетки и поиск с панелью; цвет и толщина — где положено; несуществующая иконка — «нет»; axe в обеих темах",
      )
    : fail(problems.slice(0, 4).join("; "));
}

/**
 * Страница иконки (редизайн): серверный HTML страниц выборки (iconPagesProblems); в браузере — размер, цвет
 * и толщина линии из адреса в превью и обратно в адресе; во вкладке «Код» — указание авторства набора (у
 * Lucide — с Feather); из панели — ссылка на страницу с настройками панели в адресе (ADR-0041). Поворота и
 * отражения в редизайне нет: в макете их нет ни в панели, ни на странице.
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

  // Настройки из адреса: в превью — цвет и толщина линии; после гидратации адрес держит те же настройки.
  await page.goto(`${o.base}/lucide/house?size=64&color=e11d48&stroke=1.5`);
  await hydrated(page);
  await page
    .waitForFunction(
      () =>
        document.querySelector(".ip-tile-icon")?.getAttribute("color") ===
        "#e11d48",
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  const tile = await page.evaluate(() => {
    const svg = document.querySelector(".ip-tile-icon");
    return {
      color: svg?.getAttribute("color") ?? "",
      stroke: svg?.innerHTML.includes('stroke-width="1.5"') === true,
    };
  });
  no(tile.color === "#e11d48", `цвет из адреса не применён: «${tile.color}»`);
  no(tile.stroke, "толщина линии из адреса не применена");
  const query = new URL(page.url()).searchParams;
  no(
    query.get("size") === "64" &&
      query.get("color") === "e11d48" &&
      query.get("stroke") === "1.5",
    `настройки не вернулись в адрес: «${new URL(page.url()).search}»`,
  );

  // Вкладка «Код»: последний раздел — автор, лицензия и указание авторства набора; у Lucide — с Feather.
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await page
    .waitForFunction(
      () =>
        document.querySelector("#ip-tabpanel")?.getAttribute("data-tab") ===
          "code" &&
        document
          .querySelector("#ip-tabpanel")
          ?.textContent?.includes("Feather") === true,
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  const code = await page.evaluate(
    () => document.querySelector("#ip-tabpanel")?.textContent ?? "",
  );
  no(
    code.includes("Feather"),
    "во вкладке «Код» у Lucide нет указания авторства с Feather",
  );

  // Из панели — на страницу с настройками панели в адресе: новая вкладка хранилища этой не видит.
  await page.goto(`${o.base}/${CATALOG_SET}`);
  await hydrated(page);
  const first = (await cardName(page, 0)) ?? "";
  await page.locator("a.icon-card-link").nth(0).click();
  await shown(page, first);
  await page.locator(".icon-panel input.color-hex").fill("E11D48");
  const link = page.getByRole("link", {
    name: /Open icon page|Открыть страницу иконки/,
  });
  await page
    .waitForFunction(
      () =>
        document
          .querySelector('.icon-panel a[target="_blank"]')
          ?.getAttribute("href")
          ?.includes("color=e11d48") === true,
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  const url = new URL((await link.getAttribute("href")) ?? "", o.base);
  no(
    url.pathname === `/${first.replace(":", "/")}` &&
      url.searchParams.get("color") === "e11d48",
    `«Открыть страницу иконки» ведёт на ${url.pathname}${url.search}`,
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
        `${CRAWL_ICON_NAMES.length * 2} страниц: серверный HTML — заголовок, иконка, метки, вкладки; «Removed»; размер, цвет и толщина из адреса; Feather во вкладке «Код»; из панели — с настройками в адресе`,
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
