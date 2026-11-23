// Настройки сетки в проверке сайта (ADR-0054, решения владельца 23 ноября 2026): панель Settings открывается
// кнопкой у строки поиска, фокус — на заголовок; вид — крупная сетка и список меняют колонки и размер иконки
// по стилям (data-grid-view у <html>), ползунок — размер иконки в плитке; вид и размер переживают
// перезагрузку и стоят у <html> уже к DOMContentLoaded (скрипт в <head>, без мигания); «Icons per page» над
// сеткой — целыми рядами, первая иконка страницы остаётся на экране; Reset Settings; Esc и щелчок мимо
// закрывают, фокус — на кнопку; рюкзак и настройки — по одной; axe в обеих темах и шторка на телефоне.

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
import { CATALOG_SET, DESKTOP, PANEL_WAIT_MS, PHONE } from "./config.js";
import { hydrated } from "./panel.js";

export interface SettingsCheckOptions {
  base: string;
}

/** Ключ настроек сетки в localStorage сайта (apps/site/lib/grid-script.ts). */
export const GRID_KEY = "iconavo-grid";

/** Иконок на странице при cols колонках и выбранном числе — целыми рядами, как pageSizeFor сайта. */
const rows = (cols: number, target: number) =>
  cols * Math.max(1, Math.round(target / cols));

/** Номер страницы, на которой окажется первая иконка прежней страницы (keptPage сайта). */
const kept = (page: number, from: number, to: number) =>
  Math.floor(((page - 1) * from) / to) + 1;

interface GridFacts {
  view: string;
  size: string;
  cols: number;
  tiles: number;
  icon: number;
  first: string | null;
  page: string | null;
  open: boolean;
}

const facts = (page: Page): Promise<GridFacts> =>
  page.evaluate(() => {
    const root = document.documentElement;
    const grid = document.querySelector(".icon-grid:not(.grid-skeletons)");
    const icon = grid?.querySelector(".icon-cell-svg")?.getBoundingClientRect();
    return {
      view: root.dataset.gridView ?? "grid",
      size: root.style.getPropertyValue("--tile-icon"),
      cols: Number.parseInt(
        getComputedStyle(root).getPropertyValue("--icon-cols"),
        10,
      ),
      tiles: grid
        ? grid.querySelectorAll(":scope > li:not(.result-skeleton)").length
        : 0,
      icon: icon === undefined ? 0 : Math.round(icon.height),
      first:
        grid?.querySelector<HTMLElement>(".icon-card-link")?.dataset.icon ??
        null,
      page: new URL(location.href).searchParams.get("page"),
      open:
        (document.getElementById("settings-panel") as HTMLDialogElement | null)
          ?.open ?? false,
    };
  });

/** Сетка готова: колонки посчитаны (у строки над сеткой снята отметка; на телефоне её не видно), карточки нарисованы. */
async function ready(page: Page) {
  await page
    .locator(".grid-bar-top:not([data-pending])")
    .waitFor({ state: "attached", timeout: PANEL_WAIT_MS });
  await page
    .locator(".icon-grid:not(.grid-skeletons) > li .icon-cell-svg")
    .first()
    .waitFor({ timeout: PANEL_WAIT_MS });
}

/** Карточек на странице — целые ряды под это число при нынешних колонках; ждём, пока сетка перестроится. */
async function settled(page: Page, target: number): Promise<GridFacts> {
  await page
    .waitForFunction(
      (want) => {
        const root = document.documentElement;
        const cols = Number.parseInt(
          getComputedStyle(root).getPropertyValue("--icon-cols"),
          10,
        );
        const grid = document.querySelector(".icon-grid:not(.grid-skeletons)");
        const tiles = grid
          ? grid.querySelectorAll(":scope > li:not(.result-skeleton)").length
          : 0;
        return tiles === cols * Math.max(1, Math.round(want / cols));
      },
      target,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  return facts(page);
}

/** Панель настроек открыта или закрыта — с её анимацией закрытия. */
const panelIs = (page: Page, open: boolean) =>
  page
    .waitForFunction(
      (want) =>
        (document.getElementById("settings-panel") as HTMLDialogElement | null)
          ?.open === want,
      open,
      { timeout: 5_000 },
    )
    .then(
      () => true,
      () => false,
    );

async function openSettings(page: Page) {
  await page.locator(".grid-toolbar .grid-settings").click();
  return panelIs(page, true);
}

const option = (page: Page, text: string) =>
  page.locator("#settings-panel .settings-option", { hasText: text });

/** Сценарий на компьютере; пустой список — всё так. */
export async function settingsProblems(
  page: Page,
  o: SettingsCheckOptions,
): Promise<string[]> {
  const problems: string[] = [];
  // Что стоит у <html> к DOMContentLoaded — до гидратации: вид и размер ставит скрипт в <head>.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const root = document.documentElement;
      (window as unknown as { gridAtDom: string }).gridAtDom =
        `${root.dataset.gridView ?? "grid"} ${root.style.getPropertyValue("--tile-icon")}`;
    });
  });
  await page.goto(`${o.base}/${CATALOG_SET}`);
  await hydrated(page);
  await ready(page);

  const start = await settled(page, 96);
  if (start.view !== "grid" || start.tiles !== rows(start.cols, 96)) {
    problems.push(
      `по умолчанию: вид ${start.view}, ${start.tiles} карточек при ${start.cols} колонках — ждали мелкую сетку и ${rows(start.cols, 96)}`,
    );
  }

  if (!(await openSettings(page))) return [...problems, "панель не открылась"];
  const opened = await page.evaluate(() => ({
    expanded: document
      .querySelector(".grid-toolbar .grid-settings")
      ?.getAttribute("aria-expanded"),
    focus: document.activeElement?.closest("#settings-panel h2") !== null,
  }));
  if (opened.expanded !== "true" || !opened.focus) {
    problems.push(
      `открыта: aria-expanded ${opened.expanded}, фокус ${opened.focus ? "на заголовке" : "не на заголовке"}`,
    );
  }

  // Крупная сетка: колонок меньше, иконка 48 px; список — строки, иконка 24 px.
  await option(page, "Large Grid").click();
  await page.waitForFunction(
    () => document.documentElement.dataset.gridView === "large",
  );
  await ready(page);
  const large = await settled(page, 96);
  if (
    large.cols >= start.cols ||
    large.tiles !== rows(large.cols, 96) ||
    large.icon !== 48
  ) {
    problems.push(
      `крупная сетка: ${large.cols} колонок, ${large.tiles} карточек, иконка ${large.icon} px`,
    );
  }
  await option(page, "List of Icons").click();
  await page.waitForFunction(
    () => document.documentElement.dataset.gridView === "list",
  );
  await ready(page);
  const list = await settled(page, 96);
  const row = await page.evaluate(() =>
    Math.round(
      document
        .querySelector(".icon-grid:not(.grid-skeletons) .icon-card-link")
        ?.getBoundingClientRect().height ?? 0,
    ),
  );
  if (
    list.cols >= large.cols ||
    list.tiles !== rows(list.cols, 96) ||
    list.icon !== 24 ||
    row !== 48
  ) {
    problems.push(
      `список: ${list.cols} колонок, ${list.tiles} строк, иконка ${list.icon} px, строка ${row} px`,
    );
  }

  // Ползунок: шесть шагов вправо — 48 px в мелкой сетке.
  await option(page, "Small Grid").click();
  const slider = page.locator("#settings-panel input[type=range]");
  await slider.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await page
    .waitForFunction(
      () =>
        document.documentElement.style.getPropertyValue("--tile-icon") ===
        "48px",
      null,
      { timeout: 5_000 },
    )
    .catch(() => {});
  const sized = await settled(page, 96);
  const label = (
    await page.locator("#settings-panel .settings-size").innerText()
  ).replace(/\s+/g, " ");
  if (sized.view !== "grid" || sized.icon !== 48 || label !== "48 px") {
    problems.push(
      `ползунок: вид ${sized.view}, иконка ${sized.icon} px, подпись «${label}»`,
    );
  }

  // После перезагрузки вид и размер — уже к DOMContentLoaded, выбор в переключателе — тот же.
  await option(page, "List of Icons").click();
  await page.reload();
  await hydrated(page);
  await ready(page);
  const atDom = await page.evaluate(
    () => (window as unknown as { gridAtDom?: string }).gridAtDom,
  );
  const switched = await page
    .locator('.grid-toolbar .view-item[data-view="list"] input')
    .isChecked();
  if (atDom !== "list 48px" || !switched) {
    problems.push(
      `после перезагрузки: к DOMContentLoaded «${atDom}» (ждали «list 48px»), переключатель — ${switched ? "список" : "не список"}`,
    );
  }

  // «Icons per page» над сеткой: на странице 3 — 192, первая иконка остаётся на экране.
  await page.goto(`${o.base}/${CATALOG_SET}?page=3`);
  await hydrated(page);
  await ready(page);
  const before = await settled(page, 96);
  await page.locator(".grid-bar-top .per-page").click();
  await page.locator('[role="menuitemradio"]').nth(3).click();
  await page.waitForFunction(
    (was) => new URL(location.href).searchParams.get("page") !== was,
    before.page,
    { timeout: PANEL_WAIT_MS },
  );
  await ready(page);
  const after = await settled(page, 192);
  const names = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        ".icon-grid:not(.grid-skeletons) .icon-card-link",
      ),
    ].map((a) => a.dataset.icon),
  );
  const wantPage = kept(3, before.tiles, rows(after.cols, 192));
  if (
    after.tiles !== rows(after.cols, 192) ||
    after.page !== (wantPage === 1 ? null : String(wantPage)) ||
    before.first === null ||
    !names.includes(before.first)
  ) {
    problems.push(
      `192 на странице: ${after.tiles} карточек, страница ${after.page ?? 1} (ждали ${wantPage}), первая иконка ${before.first} ${before.first !== null && names.includes(before.first) ? "на экране" : "пропала"}`,
    );
  }

  // Reset Settings: хранилище пусто, всё по умолчанию.
  if (!(await openSettings(page))) return [...problems, "панель не открылась"];
  await page.locator("#settings-panel .settings-reset").click();
  await ready(page);
  const reset = await settled(page, 96);
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    GRID_KEY,
  );
  if (
    stored !== null ||
    reset.view !== "grid" ||
    reset.size !== "" ||
    reset.tiles !== rows(reset.cols, 96)
  ) {
    problems.push(
      `Reset Settings: в хранилище ${stored}, вид ${reset.view}, ${reset.tiles} карточек`,
    );
  }

  // Esc закрывает, фокус — на кнопку Settings; щелчок мимо тоже закрывает.
  await page.keyboard.press("Escape");
  const escClosed = await panelIs(page, false);
  const backTo = await page.evaluate(
    () => document.activeElement?.closest(".grid-settings") !== null,
  );
  if (!escClosed || !backTo) {
    problems.push(
      `Esc: панель ${escClosed ? "закрылась" : "открыта"}, фокус ${backTo ? "на Settings" : "не на Settings"}`,
    );
  }
  await openSettings(page);
  await page.locator("h1").first().click();
  if (!(await panelIs(page, false))) {
    problems.push("щелчок мимо панели её не закрыл");
  }

  // Рюкзак и настройки — по одной: открытие настроек закрывает рюкзак.
  await page.locator(".topbar .bag-button").click();
  await page
    .locator("dialog.bag-panel[open]")
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await page
    .locator(".grid-toolbar .grid-settings")
    .evaluate((b: HTMLElement) => b.click());
  const both = await page
    .waitForFunction(
      () =>
        (document.getElementById("settings-panel") as HTMLDialogElement).open &&
        !(document.getElementById("bag-panel") as HTMLDialogElement).open,
      null,
      { timeout: 5_000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (!both) problems.push("рюкзак не закрылся, когда открылись настройки");
  await page.keyboard.press("Escape");
  await panelIs(page, false);
  return problems;
}

export async function checkSettings(
  browser: Browser,
  o: SettingsCheckOptions,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems = await settingsProblems(page, o).catch((e: unknown) => [
    `остановился: ${String(e).slice(0, 200)}`,
  ]);
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();

  // Открытая панель: axe в обеих темах; на телефоне — шторка в пределах экрана.
  const axePages: { path: string; violations: AxeViolation[] }[] = [];
  for (const [viewport, scheme] of [
    [DESKTOP, "light"],
    [DESKTOP, "dark"],
    [PHONE, "dark"],
  ] as const) {
    const themed = await browser.newContext({ viewport, colorScheme: scheme });
    const p = await themed.newPage();
    const pageSeen = watch(p);
    await recordViolations(p);
    await p.goto(`${o.base}/${CATALOG_SET}`);
    await hydrated(p);
    await ready(p);
    if (!(await openSettings(p))) {
      problems.push(`панель не открылась (${viewport.width} px, ${scheme})`);
      await themed.close();
      continue;
    }
    if (viewport === PHONE) {
      // Шторка выезжает снизу — мерить, когда анимация открытия закончилась.
      await p
        .waitForFunction(
          () =>
            (document.getElementById("settings-panel")?.getAnimations() ?? [])
              .length === 0,
          null,
          { timeout: 5_000 },
        )
        .catch(() => {});
      const wide = await p.evaluate(() => {
        const box = document
          .getElementById("settings-panel")
          ?.getBoundingClientRect();
        return (
          document.documentElement.scrollWidth > innerWidth ||
          box === undefined ||
          box.right > innerWidth ||
          box.left < 0 ||
          box.bottom > innerHeight + 1
        );
      });
      if (wide) problems.push("на телефоне шторка настроек не в экране");
      shots.push({
        title: "Настройки сетки на телефоне",
        png: await shot(p, pageSeen),
      });
    } else if (scheme === "light") {
      shots.push({ title: "Настройки сетки", png: await shot(p, pageSeen) });
    }
    await runAxe(
      p,
      await axe(),
      `/${CATALOG_SET}, настройки, ${viewport.width} px, ${scheme}`,
      axePages,
    );
    problems.push(...(await violations(p)).map((x) => `CSP: ${x}`));
    await themed.close();
  }
  const access = axeVerdict(axePages);
  if (access.ok === false) problems.push(`axe: ${access.note}`);
  return problems.length === 0
    ? pass(
        "кнопка Settings открывает панель, фокус — на заголовке; крупная сетка и список — свои колонки и размер иконки; ползунок — 48 px; вид и размер после перезагрузки — уже до гидратации; 192 на странице целыми рядами, первая иконка на экране; Reset Settings; Esc и щелчок мимо закрывают; рюкзак и настройки — по одной; axe в обеих темах, шторка на телефоне",
      )
    : fail(problems.slice(0, 4).join("; "));
}
