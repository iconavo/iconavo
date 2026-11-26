// Аналитика в проверке сайта (шаг 2 фазы 5, ADR-0043): события сайта доходят до приёма /event превью API
// — в его базу node:sqlite. Сценарий на /search: набрать «hou», подождать меньше 2 секунд, дописать «se» —
// промежуточный запрос не считается (решение владельца 26 ноября 2026); выдача «house» стоит 2 секунды,
// первая карточка открывает панель, «Download» в панели — файл SVG; уход со страницы отправляет пачку
// (pagehide). Ждём в базе: просмотр раздела «поиск», запрос «house» — первый в сессии, место 1, скачано;
// открытие из поиска; скачивание со временем от входа на сайт; успех поиска с одним запросом. С сигналом
// Global Privacy Control — ни одного события. Контрольный запуск портит события — их отбрасывает приём.

import type { D1Like } from "@iconavo-ui/analytics/db";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  allViolations,
  fail,
  pass,
  recordViolations,
  type Verdict,
  watch,
} from "../sandbox/verdict.js";
import { DESKTOP, PANEL_WAIT_MS } from "./config.js";
import { hydrated } from "./panel.js";

export interface AnalyticsCheckOptions {
  base: string;
  /** База событий превью API; undefined — ни одной пачки ещё не пришло. */
  analytics?: () => D1Like | undefined;
}

/** Выдача простояла столько — запрос засчитан (QUERY_SETTLE_MS сайта, 2 с, и запас). */
const SETTLE_MS = 2_400;
/** Буквы набора стоят меньше 2 секунд. */
const TYPING_MS = 400;
/** Пачка после ухода со страницы доходит до превью за столько. */
const ARRIVE_MS = 10_000;

interface Row {
  rowid: number;
  name: string;
  lang: string;
  data: string;
}

/** Последняя строка базы до сценария: события других браузеров и шагов — не его. */
async function lastRow(o: AnalyticsCheckOptions): Promise<number> {
  const db = o.analytics?.();
  if (db === undefined) return 0;
  const rows = (
    await db
      .prepare("SELECT coalesce(max(rowid), 0) AS id FROM events")
      .all<{ id: number }>()
  ).results;
  return rows[0]?.id ?? 0;
}

async function rowsAfter(
  o: AnalyticsCheckOptions,
  after: number,
): Promise<Row[]> {
  const db = o.analytics?.();
  if (db === undefined) return [];
  return (
    await db
      .prepare(
        "SELECT rowid, name, lang, data FROM events WHERE rowid > ? AND test = 0 ORDER BY rowid",
      )
      .bind(after)
      .all<Row>()
  ).results;
}

/** Выдача нарисована по этому запросу и в ней есть карточки. */
const resultsFor = (page: Page, q: string) =>
  page.waitForFunction(
    (want) => {
      const section = document.querySelector("section.search-results");
      const shown = new URLSearchParams(
        section?.getAttribute("data-query") ?? "",
      ).get("q");
      return (
        shown === want &&
        section?.getAttribute("data-search") !== "loading" &&
        document.querySelector(
          "section.search-results .result-grid a.icon-card-link",
        ) !== null
      );
    },
    q,
    { timeout: PANEL_WAIT_MS },
  );

/** Сценарий: буквы, запрос, карточка, скачивание, уход. Возвращает открытую иконку. */
async function searchAndDownload(page: Page, base: string): Promise<string> {
  await page.goto(`${base}/search`);
  await hydrated(page);
  const field = page.locator("#hero-search");
  await field.click();
  await field.pressSequentially("hou", { delay: 40 });
  await resultsFor(page, "hou");
  await page.waitForTimeout(TYPING_MS);
  await field.pressSequentially("se", { delay: 40 });
  await resultsFor(page, "house");
  await page.waitForTimeout(SETTLE_MS);
  const card = page
    .locator("section.search-results .result-grid a.icon-card-link")
    .first();
  const icon = (await card.getAttribute("data-icon")) ?? "";
  await card.click();
  const button = page.locator(".panel-actions button.panel-btn-secondary", {
    hasText: "Download",
  });
  await page.waitForFunction(
    () => {
      const b = [
        ...document.querySelectorAll(
          ".panel-actions button.panel-btn-secondary",
        ),
      ].find((el) => el.textContent?.includes("Download"));
      return b !== undefined && b.getAttribute("aria-disabled") !== "true";
    },
    undefined,
    { timeout: PANEL_WAIT_MS },
  );
  const download = page.waitForEvent("download", { timeout: PANEL_WAIT_MS });
  await button.click();
  await download;
  // Уход со страницы — pagehide: запрос закрыт, пачка ушла.
  await page.goto("about:blank");
  return icon;
}

/** Строки сценария: события, которые пришли после него, — до ARRIVE_MS. */
async function arrived(
  o: AnalyticsCheckOptions,
  after: number,
  done: (rows: Row[]) => boolean,
): Promise<Row[]> {
  const deadline = Date.now() + ARRIVE_MS;
  let rows = await rowsAfter(o, after);
  while (!done(rows) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    rows = await rowsAfter(o, after);
  }
  return rows;
}

const fields = (row: Row) => JSON.parse(row.data) as Record<string, unknown>;

/** Что не так с событиями сценария; пусто — всё пришло как надо. */
export async function analyticsProblems(
  page: Page,
  o: AnalyticsCheckOptions,
): Promise<string[]> {
  if (o.analytics === undefined) return ["у проверки нет базы превью API"];
  const after = await lastRow(o);
  const icon = await searchAndDownload(page, o.base);
  const rows = await arrived(o, after, (list) =>
    list.some((r) => r.name === "success"),
  );
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  if (rows.length === 0) return ["до превью API не дошло ни одного события"];
  no(
    rows.every((r) => r.lang === "en"),
    `язык не en: ${[...new Set(rows.map((r) => r.lang))].join(", ")}`,
  );
  no(
    rows.some((r) => r.name === "page" && fields(r).section === "search"),
    "нет просмотра раздела «поиск»",
  );
  const queries = rows.filter((r) => r.name === "query").map(fields);
  no(
    !queries.some((q) => q.q === "hou"),
    "буквы набора «hou» стали запросом: правило 2 секунд не работает",
  );
  const house = queries.find((q) => q.q === "house");
  if (house === undefined) {
    problems.push(
      `нет запроса «house»; запросы: ${JSON.stringify(queries.map((q) => q.q))}`,
    );
  } else {
    no(house.first === true, "запрос «house» — не первый в сессии");
    no(
      house.position === 1,
      `место открытой иконки — ${String(house.position)}, а не 1`,
    );
    no(house.downloaded === true, "у запроса нет отметки «скачано»");
    no(house.pages === 1, `страниц выдачи — ${String(house.pages)}, а не 1`);
    no(
      typeof house.results === "number" && house.results > 0,
      "у запроса нет числа результатов",
    );
  }
  no(
    rows.some(
      (r) =>
        r.name === "open" &&
        fields(r).from === "search" &&
        fields(r).icon === icon,
    ),
    `нет открытия ${icon} из поиска`,
  );
  const download = rows.find(
    (r) => r.name === "download" && fields(r).icon === icon,
  );
  no(
    download !== undefined && fields(download).format === "svg",
    `нет скачивания SVG ${icon}`,
  );
  no(
    download !== undefined && typeof fields(download).entry === "number",
    "у первого скачивания нет времени от входа на сайт",
  );
  const success = rows.find((r) => r.name === "success");
  no(
    success !== undefined && fields(success).queries === 1,
    `нет успеха поиска с одним запросом: ${success === undefined ? "успеха нет" : success.data}`,
  );
  return problems;
}

/** С Global Privacy Control тот же сценарий не отправляет ничего. */
async function privacyProblems(
  context: BrowserContext,
  o: AnalyticsCheckOptions,
): Promise<string[]> {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
      get: () => true,
      configurable: true,
    });
  });
  const page = await context.newPage();
  const after = await lastRow(o);
  await searchAndDownload(page, o.base);
  const rows = await arrived(o, after, () => false).catch(() => []);
  return rows.length === 0
    ? []
    : [
        `с Global Privacy Control ушли события: ${[...new Set(rows.map((r) => r.name))].join(", ")}`,
      ];
}

export async function checkAnalytics(
  browser: Browser,
  o: AnalyticsCheckOptions,
): Promise<Verdict> {
  const context = await browser.newContext({
    viewport: DESKTOP,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems = await analyticsProblems(page, o).catch((e: unknown) => [
    `остановился: ${String(e).slice(0, 200)}`,
  ]);
  problems.push(
    ...(await allViolations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();

  const quiet = await browser.newContext({
    viewport: DESKTOP,
    acceptDownloads: true,
  });
  problems.push(
    ...(await privacyProblems(quiet, o).catch((e: unknown) => [
      `с Global Privacy Control остановился: ${String(e).slice(0, 200)}`,
    ])),
  );
  await quiet.close();
  return problems.length === 0
    ? pass(
        "поиск «hou» → «house», карточка, «Download» и уход со страницы: в базе превью — раздел «поиск», запрос «house» (первый в сессии, место 1, скачано), открытие из поиска, скачивание со временем от входа, успех поиска; буквы «hou» — не запрос; с Global Privacy Control — ни одного события",
      )
    : fail(problems.join("; "));
}

/** Контрольная поломка: каждое событие с лишним полем — приём отбрасывает его, строка обязана заметить. */
export async function spoilEvents(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const send = Navigator.prototype.sendBeacon;
    Navigator.prototype.sendBeacon = function (url, data) {
      if (typeof data === "string" && data.startsWith('{"v":')) {
        const batch = JSON.parse(data) as { events: Record<string, unknown>[] };
        for (const event of batch.events) event.session = "spoiled";
        return send.call(this, url, JSON.stringify(batch));
      }
      return send.call(this, url, data);
    };
  });
}
