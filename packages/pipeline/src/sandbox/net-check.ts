// Сбои сети в настоящем браузере (фаза 3, шаг 9; ADR-0030, ADR-0035): страница /net песочницы, а хосты
// роняют и задерживают правила Playwright (page.route) — сеть браузера, не подмена fetch, ядро о
// проверке не знает. Каждый сценарий — в чистом контексте: память ядра и манифесты статики не
// переходят из сценария в сценарий. Хосты — превью API (пачки), его статика и второе превью — второй
// хост статики. Чистые части — разбор запросов, иконок и предупреждений — проверяются тестами без
// браузера.

import { ROTATE_CDN } from "@iconavo-ui/core/internal";
import type { Browser, Page } from "playwright";
import { NET_NAMES } from "./net-page.js";
import {
  fail,
  layoutVerdict,
  pass,
  type Spot,
  type Verdict,
  watch,
} from "./verdict.js";

export const NET_CHECKS = [
  ["netApi", "Сеть: API отказал — иконки сразу со статики"],
  ["netCdn", "Сеть: API и первый хост статики отказали — иконки со второго"],
  ["netSilent", "Сеть: API молчит — через 1,5 с те же иконки со статики"],
  [
    "netSlow",
    "Сеть: медленная (+2 с) — заглушки, потом иконки, текст рядом на месте",
  ],
  [
    "netDown",
    "Сеть: ничего не отвечает — повторы через 1, 2 и 4 с, потом рамка и по предупреждению",
  ],
] as const;

export type NetCheckId = (typeof NET_CHECKS)[number][0];

/** Задержка «медленной сети»: дольше порога перехода на статику, короче попытки. */
export const NET_SLOW_MS = 2000;

/** Хосты страницы /net. */
export interface NetHosts {
  /** Пачки — превью API. */
  api: string;
  /** Первый хост статики — /_static превью API. */
  cdn: string;
  /** Второй хост статики — /_static второго превью. */
  cdn2: string;
}

export const netHosts = (api: string, static2: string): NetHosts => ({
  api,
  cdn: `${api}/_static`,
  cdn2: `${static2}/_static`,
});

/** Что видно после сценария: запросы к хостам, иконки, предупреждения и ошибки страницы. */
export interface NetOutcome {
  /** Адрес и когда ушёл, мс от открытия страницы. */
  requests: { url: string; at: number }[];
  /** Иконки страницы: нарисована или резерв «нет» / «ошибка» (рамка). */
  icons: { icon: string; drawn: boolean; missing: boolean }[];
  warnings: string[];
  errors: string[];
  /** Положение имён рядом с иконками: сразу после открытия и в конце. */
  before: Spot[];
  after: Spot[];
}

/** Иконка, которой нет нарочно: её резерв — рамка, а не рисунок. */
const ABSENT = NET_NAMES.at(-1) as string;

/** Пачка API — всё у хоста API, кроме его /_static. */
export const isBatch = (url: string, h: NetHosts) =>
  url.startsWith(`${h.api}/`) && !url.startsWith(`${h.cdn}/`);

/** Файлы иконок на хосте статики (без манифеста). */
const files = (o: NetOutcome, host: string) =>
  o.requests.filter(
    (r) => r.url.startsWith(`${host}/v/`) && r.url.endsWith(".json"),
  );

/** Иконки, кроме нарочно отсутствующей, нарисованы, а у той — рамка. */
function iconsProblems(o: NetOutcome): string[] {
  const present = o.icons.filter((i) => i.icon !== ABSENT);
  const absent = o.icons.find((i) => i.icon === ABSENT);
  return [
    present.length !== NET_NAMES.length - 1 || !present.every((i) => i.drawn)
      ? `нарисовано ${present.filter((i) => i.drawn).length} из ${NET_NAMES.length - 1}`
      : "",
    absent?.missing ? "" : `у ${ABSENT} нет рамки`,
    ...[...new Set(o.errors)].slice(0, 3).map((e) => `ошибка: ${e}`),
  ].filter(Boolean);
}

/**
 * Хост ответил вместо упавших: иконки — с хоста from (файлами статики), с хоста not — ни одной.
 * Пачка к API уходила (её уронили правила). which — «с первого» или «со второго», для пояснения.
 */
export function fallbackVerdict(
  o: NetOutcome,
  h: NetHosts,
  from: string,
  which: string,
  not?: string,
): Verdict {
  const own = files(o, from).length;
  const problems = [
    ...iconsProblems(o),
    o.requests.some((r) => isBatch(r.url, h)) ? "" : "пачка к API не уходила",
    own === 0 ? `ни одного файла ${which} хоста статики` : "",
    not && files(o, not).length > 0
      ? `файлы и с другого хоста статики: ${files(o, not).length}`
      : "",
  ].filter(Boolean);
  return problems.length === 0
    ? pass(
        `иконки нарисованы ${which} хоста статики (файлов: ${own}); у иконки, которой нет, — рамка`,
      )
    : fail(problems.join("; "));
}

/** API молчит: статика — не раньше порога ROTATE_CDN после пачки (и не намного позже), иконки — с неё. */
export function silentVerdict(o: NetOutcome, h: NetHosts): Verdict {
  const batch = o.requests.find((r) => isBatch(r.url, h));
  const manifest = o.requests.find((r) =>
    r.url.startsWith(`${h.cdn}/manifest.json`),
  );
  if (!batch || !manifest) {
    return fail(
      `${batch ? "" : "пачки не было; "}${manifest ? "" : "к статике не перешли"}`.replace(
        /; $/,
        "",
      ),
    );
  }
  const gap = manifest.at - batch.at;
  const problems = [
    ...iconsProblems(o),
    gap < ROTATE_CDN - 200
      ? `статика через ${gap} мс — раньше порога ${ROTATE_CDN} мс`
      : "",
    gap > ROTATE_CDN + 1500
      ? `статика через ${gap} мс — намного позже порога ${ROTATE_CDN} мс`
      : "",
  ].filter(Boolean);
  return problems.length === 0
    ? pass(
        `статика через ${gap} мс после пачки (порог ${ROTATE_CDN} мс), файлов: ${files(o, h.cdn).length}; иконки нарисованы`,
      )
    : fail(problems.join("; "));
}

/** Медленная сеть: заглушки были, иконки пришли, текст рядом не сдвинулся. */
export function slowVerdict(o: NetOutcome, placeholders: number): Verdict {
  const layout = layoutVerdict(o.before, o.after);
  const problems = [
    ...iconsProblems(o),
    placeholders === 0 ? "заглушек не было" : "",
    layout.ok ? "" : layout.note,
  ].filter(Boolean);
  return problems.length === 0
    ? pass(`заглушки у ${placeholders} иконок, потом рисунок; ${layout.note}`)
    : fail(problems.join("; "));
}

/**
 * Ничего не отвечает: пачка — в 0, 1, 3 и 7 с (повторы через 1, 2 и 4 с), потом у всех иконок рамка и
 * по одному предупреждению «failed to load» на имя.
 */
export function downVerdict(o: NetOutcome, h: NetHosts): Verdict {
  const batches = o.requests.filter((r) => isBatch(r.url, h));
  const first = batches[0]?.at ?? 0;
  const pauses = batches.map((r) => r.at - first);
  const expected = [0, 1000, 3000, 7000];
  const late = pauses.some(
    (at, i) => Math.abs(at - (expected[i] ?? Number.NaN)) > 700,
  );
  const failed = NET_NAMES.map(
    (name) => `Iconavo: icon "${name}" failed to load`,
  );
  const counts = failed.map(
    (text) => o.warnings.filter((w) => w.startsWith(text)).length,
  );
  const problems = [
    batches.length !== expected.length || late
      ? `пачки в ${pauses.map((at) => `${(at / 1000).toFixed(1).replace(".", ",")} с`).join(", ") || "—"}, ждали 0, 1, 3 и 7 с`
      : "",
    o.icons.length !== NET_NAMES.length || !o.icons.every((i) => i.missing)
      ? `рамка у ${o.icons.filter((i) => i.missing).length} из ${NET_NAMES.length}`
      : "",
    counts.some((n) => n !== 1)
      ? `предупреждений «failed to load»: ${counts.join(", ")} — ждали по одному`
      : "",
    ...[...new Set(o.errors)].slice(0, 3).map((e) => `ошибка: ${e}`),
  ].filter(Boolean);
  return problems.length === 0
    ? pass(
        `4 попытки — в 0, 1, 3 и 7 с; у ${NET_NAMES.length} иконок рамка, по одному предупреждению на имя`,
      )
    : fail(problems.join("; "));
}

export interface NetCheckOptions {
  /** Песочница: http://127.0.0.1:порт. */
  base: string;
  /** Превью API. */
  api: string;
  /** Второе превью — второй хост статики. */
  static2: string;
}

/** Иконки страницы: нарисована (viewBox) или резерв с рамкой «нет» / «ошибка». */
const iconsOf = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("iconavo-icon")].map((tag) => {
      const svg = tag.shadowRoot?.querySelector("svg");
      return {
        icon: tag.getAttribute("icon") ?? "",
        drawn: Boolean(svg?.hasAttribute("viewBox")),
        missing: svg?.getAttribute("class") === "missing",
      };
    }),
  );

/** Положение имён рядом с иконками. */
const spotsOf = (page: Page): Promise<Spot[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("#icons .c span")].map((span) => {
      const box = span.getBoundingClientRect();
      return { left: box.left, top: box.top };
    }),
  );

/** Каждая иконка нарисована или стала резервом с рамкой. */
const settled = (page: Page, timeout: number) =>
  page.waitForFunction(
    () => {
      const tags = [...document.querySelectorAll("iconavo-icon")];
      return (
        tags.length > 0 &&
        tags.every((tag) =>
          tag.shadowRoot?.querySelector("svg[viewBox], svg.missing"),
        )
      );
    },
    null,
    { timeout },
  );

/**
 * Один сценарий: чистый контекст, правила сети, страница /net, ожидание итога. during — замеры, пока
 * иконки грузятся (до итога).
 */
async function scenario(
  browser: Browser,
  o: NetCheckOptions,
  rules: (page: Page, h: NetHosts) => Promise<unknown>,
  during?: (page: Page) => Promise<void>,
): Promise<NetOutcome> {
  const h = netHosts(o.api, o.static2);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    const start = Date.now();
    const requests: NetOutcome["requests"] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith(`${h.api}/`) || url.startsWith(`${o.static2}/`)) {
        requests.push({ url, at: Date.now() - start });
      }
    });
    await rules(page, h);
    const url = `${o.base}/net?api=${encodeURIComponent(o.api)}&cdn2=${encodeURIComponent(o.static2)}`;
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(
      () => document.body.dataset.ready === "1",
      null,
      {
        timeout: 60_000,
      },
    );
    const before = await spotsOf(page);
    await during?.(page);
    await settled(page, 60_000);
    return {
      requests,
      icons: await iconsOf(page),
      warnings: seen.warnings,
      errors: seen.errors,
      before,
      after: await spotsOf(page),
    };
  } finally {
    await context.close();
  }
}

/** Отказ соединения — как у упавшего хоста. */
const refuse = (page: Page, match: (url: URL) => boolean) =>
  page.route(match, (route) => route.abort("connectionrefused"));

/** Пять сценариев по очереди: вердикты строк NET_CHECKS. */
export async function checkNetwork(
  browser: Browser,
  o: NetCheckOptions,
  log?: (line: string) => void,
): Promise<Partial<Record<NetCheckId, Verdict>>> {
  const v: Partial<Record<NetCheckId, Verdict>> = {};
  const h = netHosts(o.api, o.static2);

  log?.("сеть: API отказал…");
  v.netApi = fallbackVerdict(
    await scenario(browser, o, (page) =>
      refuse(page, (url) => isBatch(url.href, h)),
    ),
    h,
    h.cdn,
    "с первого",
    h.cdn2,
  );

  log?.("сеть: API и первый хост статики отказали…");
  v.netCdn = fallbackVerdict(
    await scenario(browser, o, (page) =>
      refuse(
        page,
        (url) => isBatch(url.href, h) || url.href.startsWith(`${h.cdn}/`),
      ),
    ),
    h,
    h.cdn2,
    "со второго",
  );

  log?.("сеть: API молчит…");
  v.netSilent = silentVerdict(
    // Ответа нет, пока ядро само не отменит запрос.
    await scenario(browser, o, (page) =>
      page.route(
        (url) => isBatch(url.href, h),
        () => {},
      ),
    ),
    h,
  );

  log?.("сеть: медленная…");
  let placeholders = 0;
  const slow = await scenario(
    browser,
    o,
    (page) =>
      page.route(
        (url) =>
          url.href.startsWith(`${h.api}/`) ||
          url.href.startsWith(`${o.static2}/`),
        async (route) => {
          await new Promise((resolve) => setTimeout(resolve, NET_SLOW_MS));
          // Запрос могли уже отменить — тогда отвечать некому.
          await route.continue().catch(() => {});
        },
      ),
    async (page) => {
      // Задержка ответа — NET_SLOW_MS: на её середине у ещё не пришедших иконок — заглушка.
      await page.waitForTimeout(NET_SLOW_MS / 2);
      placeholders = await page.evaluate(
        () =>
          [...document.querySelectorAll("iconavo-icon")].filter(
            (tag) =>
              tag.shadowRoot?.querySelector("svg")?.getAttribute("class") ===
              "skeleton",
          ).length,
      );
    },
  );
  v.netSlow = slowVerdict(slow, placeholders);

  log?.("сеть: ничего не отвечает…");
  v.netDown = downVerdict(
    await scenario(browser, o, (page) =>
      refuse(
        page,
        (url) =>
          url.href.startsWith(`${h.api}/`) ||
          url.href.startsWith(`${o.static2}/`),
      ),
    ),
    h,
  );
  return v;
}
