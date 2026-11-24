// Сценарий «Поиск» проверки сайта (шаг 3 фазы 4, ADR-0040): поле поиска и выдача в браузере против
// превью API, которое ищет в локальном Meilisearch по словам (pnpm site --check, meili/local.ts). Что
// выдача на странице — то, что API ответил на её запрос, проверяется по самому запросу страницы: он же
// уходит в превью из Node. Остальное подменяет page.route: неполная выдача, 429, пустые ответы.

import type { Browser, Page, Request, Route } from "playwright";
import { type AxeViolation, axe, axeVerdict, runAxe } from "../sandbox/axe.js";
import {
  allViolations,
  fail,
  pass,
  recordViolations,
  shot,
  type Verdict,
  watch,
} from "../sandbox/verdict.js";
import {
  DESKTOP,
  PHONE,
  SEARCH_EMPTY_QUERY,
  SEARCH_PAGES_QUERY,
  SEARCH_QUERY,
  SEARCH_WAIT_MS,
} from "./config.js";

export interface SearchCheckContext {
  base: string;
  /** Превью API: его /search спрашивает страница. */
  api: string;
}

/**
 * Подмена ответа без необработанных отказов (ревизия фазы 5, И-18): отказ в обработчике route ронял бы
 * весь процесс без отчёта. Страница или контекст закрылись, пока ответ шёл, — не ошибка; остальное — в
 * problems.
 */
export function guarded(
  problems: string[],
  handler: (route: Route) => Promise<void>,
): (route: Route) => Promise<void> {
  return async (route) => {
    try {
      await handler(route);
    } catch (e) {
      const message = (e as Error).message.split("\n")[0] ?? "";
      if (!/closed|disposed/i.test(message)) {
        problems.push(`подмена ответа ${route.request().url()}: ${message}`);
      }
      await route.abort().catch(() => {});
    }
  };
}

/** Выдача на странице: состояние, клетки, статус, поле. Выполняется в браузере. */
function searchFacts() {
  const section = document.querySelector("section.search-results");
  const cells = [
    ...document.querySelectorAll(
      "section.search-results > .search-body > .result-grid .result-cell:not(.result-skeleton)",
    ),
  ];
  const input = document.getElementById(
    "hero-search",
  ) as HTMLInputElement | null;
  const grid = document.querySelector(
    "section.search-results > .search-body > .result-grid",
  );
  const box = grid?.getBoundingClientRect();
  const shown = section?.getAttribute("data-query") ?? "";
  return {
    state: section?.getAttribute("data-search") ?? "",
    semantic: section?.getAttribute("data-semantic") ?? "",
    icons: cells.map((c) => c.getAttribute("data-icon") ?? ""),
    drawn: cells.filter((c) => {
      const svg = c.querySelector("svg");
      return svg?.hasAttribute("viewBox") === true && svg.childNodes.length > 0;
    }).length,
    exactFirst:
      cells[0]?.querySelector(".result-exact") !== null && cells.length > 0,
    skeletons: [...document.querySelectorAll(".result-skeleton-icon")].filter(
      (s) => getComputedStyle(s).visibility === "visible",
    ).length,
    status: document.querySelector(".search-status")?.textContent?.trim() ?? "",
    // Сообщения выдачи: «ничего не нашлось», «с фильтрами пусто», «дальше ничего» — в месте выдачи.
    paragraphs: [
      ...(section?.querySelectorAll(":scope > .search-body > p") ?? []),
    ].map((p) => p.textContent?.trim() ?? ""),
    unfiltered: document.querySelector("#search-unfiltered") !== null,
    focus: document.activeElement?.id ?? "",
    value: input?.value ?? "",
    path: location.pathname,
    search: location.search,
    // Адрес, по которому React нарисовал выдачу: сразу после смены адреса он ещё прежний.
    rendered: shown === "" ? "" : `?${shown}`,
    mark: (window as { __iconavoMark?: number }).__iconavoMark ?? 0,
    grid: box === undefined ? undefined : { top: box.top, height: box.height },
  };
}

type Facts = ReturnType<typeof searchFacts>;

/** Запросы страницы к /search превью API. */
function searchRequests(page: Page, api: string): string[] {
  const origin = new URL(api).origin;
  const list: string[] = [];
  page.on("request", (r: Request) => {
    const url = new URL(r.url());
    if (url.origin === origin && url.pathname === "/search") list.push(r.url());
  });
  return list;
}

/** Ответ превью API на тот же адрес — из Node, без браузера. */
async function apiIcons(url: string): Promise<string[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ответил ${response.status}`);
  const body = (await response.json()) as { icons?: unknown };
  return Array.isArray(body.icons) ? (body.icons as string[]) : [];
}

/** Ждать, пока выдача — в этом состоянии и адрес — с этими параметрами; вернуть, что на странице. */
async function waitFor(
  page: Page,
  check: (f: Facts) => boolean,
): Promise<{ facts: Facts; ok: boolean }> {
  const started = Date.now();
  let facts = await page.evaluate(searchFacts);
  while (!check(facts) && Date.now() - started < SEARCH_WAIT_MS) {
    await page.waitForTimeout(100);
    facts = await page.evaluate(searchFacts);
  }
  return { facts, ok: check(facts) };
}

const final = (search: string) => (f: Facts) =>
  f.state === "final" &&
  f.search === search &&
  f.rendered === search &&
  f.drawn === f.icons.length;

/** Выдача — та, что API ответил на последний запрос страницы; проблема — строкой. */
async function matchesApi(
  step: string,
  facts: Facts,
  requests: string[],
  expect: (params: URLSearchParams) => string | undefined,
): Promise<string | undefined> {
  const last = requests.at(-1);
  if (last === undefined) return `${step}: страница не спросила /search`;
  const params = new URL(last).searchParams;
  const wrong = expect(params);
  if (wrong !== undefined) return `${step}: запрос ${params} — ${wrong}`;
  const icons = await apiIcons(last);
  if (facts.icons.join(" ") !== icons.join(" ")) {
    return `${step}: клеток ${facts.icons.length}, первая ${facts.icons[0] ?? "нет"}; API — ${icons.length}, ${icons[0] ?? "нет"}`;
  }
  return undefined;
}

/** Набор с главной: поле не пересоздаётся, фокус и буквы на месте, выдача — как у API. */
async function homeProblems(
  page: Page,
  o: SearchCheckContext,
  requests: string[],
): Promise<string[]> {
  await page.goto(`${o.base}/`, { waitUntil: "load" });
  await waitForHydration(page);
  await page.evaluate(() => {
    (window as { __iconavoMark?: number }).__iconavoMark = 1;
  });
  await page.locator("#hero-search").click();
  await page.keyboard.type(SEARCH_QUERY.slice(0, 3), { delay: 30 });
  await page.waitForTimeout(400);
  await page.keyboard.type(SEARCH_QUERY.slice(3), { delay: 30 });
  const { facts, ok } = await waitFor(
    page,
    (f) => f.path === "/search" && final(`?q=${SEARCH_QUERY}`)(f),
  );
  if (!ok) {
    return [
      `с главной: адрес ${facts.path}${facts.search}, выдача «${facts.state}», клеток ${facts.icons.length}`,
    ];
  }
  const problems: string[] = [];
  if (facts.mark !== 1) problems.push("с главной: страница перезагрузилась");
  if (facts.focus !== "hero-search" || facts.value !== SEARCH_QUERY) {
    problems.push(
      `с главной: фокус — «${facts.focus}», в поле «${facts.value}»`,
    );
  }
  if (!facts.exactFirst) problems.push("с главной: первая — не точное имя");
  // Шапка по макету «Сценарий поиска иконок»: крошки «Icon Sets / Search» и «Search Results».
  const head = await page.evaluate(() => ({
    title: document.querySelector("main h1")?.textContent?.trim() ?? "",
    crumb:
      document
        .querySelector(".search-head .crumbs li[aria-current]")
        ?.textContent?.trim() ?? "",
  }));
  if (head.title !== "Search Results" || head.crumb !== "Search") {
    problems.push(`шапка: заголовок «${head.title}», крошка «${head.crumb}»`);
  }
  const api = await matchesApi("с главной", facts, requests, (p) =>
    p.get("query") === SEARCH_QUERY ? undefined : "не тот текст",
  );
  if (api) problems.push(api);
  return problems;
}

/**
 * Поиск с другой страницы (редизайн): поля в шапке больше нет. Ctrl K на странице без поля и «Поиск» в
 * верхней полосе открывают /search с фокусом в большом поле; набранное ищется без перезагрузки.
 */
async function headerProblems(
  page: Page,
  o: SearchCheckContext,
): Promise<string[]> {
  const problems: string[] = [];
  for (const [how, open] of [
    [
      "Ctrl K",
      async () => {
        // Слушатель Ctrl K ставит эффект после гидратации: нажатие до него теряется — как у человека,
        // который нажал раньше, чем страница ожила, и нажимает ещё раз (WebKit, 17 ноября 2026).
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press("Control+k");
          const moved = await page
            .waitForFunction(() => location.pathname === "/search", undefined, {
              timeout: 1000,
            })
            .then(
              () => true,
              () => false,
            );
          if (moved) return;
        }
      },
    ],
    [
      "«Поиск» в верхней полосе",
      () => page.locator(".topbar a.pill", { hasText: "Search" }).click(),
    ],
  ] as const) {
    await page.goto(`${o.base}/sets`, { waitUntil: "load" });
    await waitForHydration(page);
    await open();
    const opened = await waitFor(
      page,
      (f) => f.path === "/search" && f.focus === "hero-search",
    );
    if (!opened.ok) {
      problems.push(
        `${how}: адрес ${opened.facts.path}${opened.facts.search}, фокус «${opened.facts.focus}»`,
      );
      continue;
    }
    await page.keyboard.type("heart", { delay: 30 });
    const { facts, ok } = await waitFor(
      page,
      (f) =>
        f.path === "/search" &&
        final("?q=heart")(f) &&
        f.focus === "hero-search" &&
        f.value === "heart",
    );
    if (!ok) {
      problems.push(
        `${how}, набор: адрес ${facts.path}${facts.search}, выдача «${facts.state}», фокус «${facts.focus}», в поле «${facts.value}»`,
      );
    }
  }
  return problems;
}

/**
 * Фильтры левой панели (редизайн, 17 ноября 2026): вкладка Style — «Filled», вкладка Sets — Phosphor; в
 * адресе и в запросе (наборы — prefixes); «назад» — из памяти вкладки, без нового запроса.
 */
async function filterProblems(
  page: Page,
  requests: string[],
): Promise<string[]> {
  const sidebar = page.locator("#sidebar");
  const step = async (
    name: string,
    tab: string,
    option: string,
    search: string,
    want: (p: URLSearchParams) => string | undefined,
  ) => {
    await sidebar
      .locator("button.sidebar-tab[aria-pressed]", { hasText: tab })
      .click();
    await sidebar
      .locator(".filter-option", { hasText: option })
      .first()
      .click();
    const { facts, ok } = await waitFor(page, final(search));
    if (!ok) {
      return `${name}: адрес «${facts.search}», выдача «${facts.state}»`;
    }
    return matchesApi(name, facts, requests, want);
  };
  const filled = await step(
    "стиль «Заливка»",
    "Style",
    "Filled",
    `?q=${SEARCH_QUERY}&style=filled`,
    (p) => (p.get("style") === "filled" ? undefined : "нет style=filled"),
  );
  if (filled) return [filled];
  const set = await step(
    "набор ph",
    "Sets",
    "Phosphor",
    `?q=${SEARCH_QUERY}&style=filled&set=ph`,
    (p) => (p.get("prefixes") === "ph" ? undefined : "нет prefixes=ph"),
  );
  if (set) return [set];
  const before = requests.length;
  await page.goBack();
  const { facts, ok } = await waitFor(
    page,
    final(`?q=${SEARCH_QUERY}&style=filled`),
  );
  if (!ok) return [`«назад»: адрес «${facts.search}», выдача «${facts.state}»`];
  if (requests.length !== before) {
    return [`«назад»: новый запрос к API вместо памяти вкладки`];
  }
  return [];
}

/**
 * Вторая страница: start и limit в запросе — размер страницы целыми рядами, как у набора (колонок —
 * --icon-cols от ширины окна, ближе всего к 96 — pageSizeFor сайта); выдача — как у API.
 */
async function pageProblems(
  page: Page,
  o: SearchCheckContext,
  requests: string[],
): Promise<string[]> {
  await page.goto(`${o.base}/search?q=${SEARCH_PAGES_QUERY}`, {
    waitUntil: "load",
  });
  const first = await waitFor(page, final(`?q=${SEARCH_PAGES_QUERY}`));
  if (!first.ok) return [`страницы: первая — «${first.facts.state}»`];
  await page.locator('.pagination a[href*="page=2"]').first().click();
  const { facts, ok } = await waitFor(
    page,
    final(`?q=${SEARCH_PAGES_QUERY}&page=2`),
  );
  if (!ok)
    return [`страница 2: адрес «${facts.search}», выдача «${facts.state}»`];
  const size = await page.evaluate(() => {
    const cols = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--icon-cols",
      ),
      10,
    );
    return cols * Math.round(96 / cols);
  });
  const api = await matchesApi("страница 2", facts, requests, (p) =>
    p.get("start") === String(size) && p.get("limit") === String(size)
      ? undefined
      : `ждали start=${size} и limit=${size}`,
  );
  return api ? [api] : [];
}

/**
 * Неполная выдача (подмена ответа): сначала по словам — три карточки и скелетоны до полной страницы,
 * повтор — полная в тех же клетках. Вёрстка не двигается: место сетки то же; в Chrome ещё и сумма
 * сдвигов Layout Instability API со скелетонов загрузки до полной выдачи — ноль.
 */
async function pendingProblems(
  browser: Browser,
  o: SearchCheckContext,
  options: { pendingForever?: boolean } = {},
): Promise<string[]> {
  const context = await browser.newContext({ viewport: DESKTOP });
  // Сдвиги — со временем кадра: браузер сообщает о них не сразу, и сдвиг ещё от открытия страницы мог
  // прийти уже после появления неполной выдачи (так было в Chrome на машине CI).
  await context.addInitScript(() => {
    const w = window as { __iconavoShifts?: { at: number; value: number }[] };
    w.__iconavoShifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!e.hadRecentInput) {
            w.__iconavoShifts?.push({ at: e.startTime, value: e.value });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Firefox и WebKit сдвиги не меряют — у них только место сетки.
    }
  });
  const page = await context.newPage();
  const api = new URL(o.api);
  let calls = 0;
  const routeProblems: string[] = [];
  await page.route(
    (url) => url.origin === api.origin && url.pathname === "/search",
    guarded(routeProblems, async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      calls++;
      if (calls === 1 || options.pendingForever) {
        // Первый ответ задержан: сначала — скелетоны «загрузки».
        if (calls === 1) await new Promise((r) => setTimeout(r, 800));
        json.semantic = "pending";
        json.results = (json.results as unknown[]).slice(0, 3);
        json.icons = (json.icons as unknown[]).slice(0, 3);
        json.total = 3;
      } else {
        json.semantic = "full";
      }
      await route.fulfill({ response, json });
    }),
  );
  const problems: string[] = [];
  await page.goto(`${o.base}/search?q=${SEARCH_PAGES_QUERY}`, {
    waitUntil: "load",
  });
  await page.waitForTimeout(400);
  const loading = await page.evaluate(searchFacts);
  // С этого кадра сдвигов быть не должно: скелетоны загрузки, неполная и полная выдача встают в те же
  // клетки. Точка отсчёта — до неполной выдачи: сдвиг её кадра браузер отмечает временем отрисовки, и
  // отсчёт после неё ловил бы его, только если успел раньше кадра (на машине CI — не всегда).
  const since = await page.evaluate(() => performance.now());
  if (loading.state !== "loading" || loading.skeletons === 0) {
    problems.push(
      `загрузка: выдача «${loading.state}», видимых скелетонов ${loading.skeletons}`,
    );
  }
  const partial = await waitFor(page, (f) => f.state === "partial");
  if (!partial.ok) {
    problems.push(`неполная выдача не показана: «${partial.facts.state}»`);
    await context.close();
    return problems;
  }
  if (partial.facts.icons.length !== 3 || partial.facts.skeletons === 0) {
    problems.push(
      `неполная выдача: клеток ${partial.facts.icons.length}, скелетонов ${partial.facts.skeletons}`,
    );
  }
  // Полная — или повторы кончились, и выдача так и осталась по словам.
  const full = await waitFor(page, final(`?q=${SEARCH_PAGES_QUERY}`));
  if (!full.ok || full.facts.semantic !== "full") {
    problems.push(
      `поиск без полной выдачи: «${full.facts.state}», semantic «${full.facts.semantic}», повторов ${calls - 1}`,
    );
  } else {
    const before = partial.facts.grid;
    const after = full.facts.grid;
    if (
      before === undefined ||
      after === undefined ||
      Math.abs(before.top - after.top) > 1 ||
      Math.abs(before.height - after.height) > 1
    ) {
      problems.push(
        `сетка сдвинулась: было ${JSON.stringify(before)}, стало ${JSON.stringify(after)}`,
      );
    }
    // Наблюдатель сообщает о кадре не сразу — подождать два кадра.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const shift = await page.evaluate(
      (from) =>
        (
          (window as { __iconavoShifts?: { at: number; value: number }[] })
            .__iconavoShifts ?? []
        )
          .filter((s) => s.at > from)
          .reduce((sum, s) => sum + s.value, 0),
      since,
    );
    if (shift > 0.001) problems.push(`сдвиг вёрстки ${shift.toFixed(3)}`);
  }
  await context.close();
  return [...problems, ...routeProblems];
}

/** Пустые ответы и 429 — подменой; понятное сообщение у каждого. */
async function emptyProblems(
  browser: Browser,
  o: SearchCheckContext,
): Promise<string[]> {
  const problems: string[] = [];
  const api = new URL(o.api);
  const isSearch = (url: URL) =>
    url.origin === api.origin && url.pathname === "/search";

  // Ничего по словам, смысл недоступен (локальный Meilisearch — без смысла).
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  await page.goto(`${o.base}/search?q=${SEARCH_EMPTY_QUERY}`, {
    waitUntil: "load",
  });
  const nothing = await waitFor(page, final(`?q=${SEARCH_EMPTY_QUERY}`));
  if (
    !nothing.ok ||
    nothing.facts.icons.length > 0 ||
    nothing.facts.paragraphs.length === 0
  ) {
    problems.push(
      `«ничего не нашлось»: выдача «${nothing.facts.state}», клеток ${nothing.facts.icons.length}, сообщений ${nothing.facts.paragraphs.length}`,
    );
  }
  await context.close();

  // По словам ничего (matched: false) — подсказка в строке статуса.
  const meaning = await browser.newContext({ viewport: DESKTOP });
  const meaningPage = await meaning.newPage();
  await meaningPage.route(
    (url) => isSearch(url),
    guarded(problems, async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: { ...json, semantic: "full", matched: false },
      });
    }),
  );
  await meaningPage.goto(`${o.base}/search?q=${SEARCH_QUERY}`, {
    waitUntil: "load",
  });
  const hint = await waitFor(meaningPage, final(`?q=${SEARCH_QUERY}`));
  if (!hint.ok || hint.facts.status === "") {
    problems.push(
      `«похожие по смыслу»: строка статуса пустая («${hint.facts.state}»)`,
    );
  }
  await meaning.close();

  // С фильтрами пусто — сброс и то же без фильтров.
  const filtered = await browser.newContext({ viewport: DESKTOP });
  const filteredPage = await filtered.newPage();
  await filteredPage.route(
    (url) => isSearch(url),
    guarded(problems, async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      const styled = new URL(route.request().url()).searchParams.has("style");
      await route.fulfill({
        response,
        json: styled
          ? { ...json, icons: [], results: [], total: 0, semantic: "full" }
          : { ...json, semantic: "full" },
      });
    }),
  );
  await filteredPage.goto(`${o.base}/search?q=${SEARCH_QUERY}&style=duotone`, {
    waitUntil: "load",
  });
  const reset = await waitFor(
    filteredPage,
    (f) => f.state === "final" && f.unfiltered,
  );
  if (!reset.ok) {
    problems.push(
      `«с фильтрами пусто»: выдача «${reset.facts.state}», блока «без фильтров» нет, сообщений ${reset.facts.paragraphs.length}`,
    );
  }
  await filtered.close();

  // 429: сообщение, затем поиск повторяется сам.
  const limited = await browser.newContext({ viewport: DESKTOP });
  const limitedPage = await limited.newPage();
  const seen = watch(limitedPage);
  let calls = 0;
  await limitedPage.route(
    (url) => isSearch(url),
    guarded(problems, async (route) => {
      calls++;
      if (calls === 1) {
        await route.fulfill({
          status: 429,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "Retry-After",
            "retry-after": "2",
            "content-type": "application/json",
          },
          body: '{"error":"rate_limited","message":"Too many searches","status":429}',
        });
        return;
      }
      await route.continue();
    }),
  );
  await limitedPage.goto(`${o.base}/search?q=${SEARCH_QUERY}`, {
    waitUntil: "load",
  });
  const waiting = await waitFor(limitedPage, (f) => f.state === "limited");
  if (!waiting.ok || waiting.facts.status === "") {
    problems.push(`429: сообщения нет («${waiting.facts.state}»)`);
  }
  const again = await waitFor(limitedPage, final(`?q=${SEARCH_QUERY}`));
  if (!again.ok) {
    problems.push(`429: поиск не повторился сам («${again.facts.state}»)`);
  }
  const errors = [...new Set(seen.errors)];
  if (errors.length > 0) problems.push(`429: ошибки — ${errors.join("; ")}`);
  await limited.close();
  return problems;
}

/**
 * Шторка фильтра на телефоне (кадр «Search Results / Mobile — Filter»): кнопка в строке инструментов,
 * выбор — черновик до Show results (адрес не меняется), «N selected», затем выдача с фильтрами как у API,
 * шторка закрыта, фокус — на кнопке, на ней счётчик; Reset чистит черновик, Esc закрывает без применения.
 * Там же axe открытой шторки.
 */
async function sheetProblems(
  browser: Browser,
  o: SearchCheckContext,
  shots: { title: string; png: string }[],
): Promise<string[]> {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const requests = searchRequests(page, o.api);
  await page.goto(`${o.base}/search?q=${SEARCH_QUERY}`, { waitUntil: "load" });
  const first = await waitFor(page, final(`?q=${SEARCH_QUERY}`));
  if (!first.ok) {
    await context.close();
    return [`шторка: выдача «${first.facts.state}»`];
  }
  const problems: string[] = [];
  const button = page.locator(".search-filter-button");
  const sheet = page.locator("dialog.filter-sheet[open]");
  const count = async () =>
    (await sheet.locator(".filter-sheet-count").textContent())?.trim() ?? "";
  await button.click();
  const opened = await sheet
    .waitFor({ timeout: SEARCH_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    await context.close();
    return ["шторка фильтра не открылась"];
  }
  await sheet.locator(".filter-option", { hasText: "Phosphor" }).click();
  await sheet.locator(".filter-option", { hasText: "Filled" }).click();
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => location.search)) !== `?q=${SEARCH_QUERY}`) {
    problems.push("шторка: адрес сменился до Show results");
  }
  const picked = await count();
  if (picked !== "2 selected") {
    problems.push(`шторка: «${picked}» вместо «2 selected»`);
  }
  shots.push({
    title: "/search — шторка фильтра (375 px)",
    png: await shot(page, seen),
  });
  const axePages: { path: string; violations: AxeViolation[] }[] = [];
  await runAxe(page, await axe(), "/search — шторка фильтра", axePages);
  const access = axeVerdict(axePages);
  if (access.ok === false) problems.push(`шторка, axe: ${access.note}`);
  await sheet.locator(".filter-sheet-show").click();
  const target = `?q=${SEARCH_QUERY}&style=filled&set=ph`;
  const { facts, ok } = await waitFor(page, final(target));
  if (!ok) {
    problems.push(`шторка: адрес «${facts.search}», выдача «${facts.state}»`);
  } else {
    const api = await matchesApi("шторка", facts, requests, (p) =>
      p.get("prefixes") === "ph" && p.get("style") === "filled"
        ? undefined
        : "фильтры не дошли",
    );
    if (api) problems.push(api);
  }
  if ((await page.locator("dialog.filter-sheet[open]").count()) > 0) {
    problems.push("шторка не закрылась после Show results");
  }
  const focus = await page.evaluate(
    () => document.activeElement?.className ?? "",
  );
  if (!focus.includes("search-filter-button")) {
    problems.push(`шторка: фокус на «${focus}», а не на кнопке фильтра`);
  }
  const badge =
    (await page.locator(".search-filter-count").textContent())?.trim() ?? "";
  if (badge !== "2") problems.push(`шторка: на кнопке «${badge}» вместо 2`);
  await button.click();
  await sheet.waitFor({ timeout: SEARCH_WAIT_MS }).catch(() => {});
  await sheet.locator(".filter-sheet-reset").click();
  const reset = await count();
  if (reset !== "0 selected") problems.push(`шторка: после Reset «${reset}»`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if ((await page.locator("dialog.filter-sheet[open]").count()) > 0) {
    problems.push("шторка не закрылась по Esc");
  }
  if ((await page.evaluate(() => location.search)) !== target) {
    problems.push("шторка: Esc применил черновик");
  }
  problems.push(
    ...(await allViolations(page)).map((x) => `шторка, CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `шторка, ошибка: ${x}`),
  );
  await context.close();
  return problems;
}

/** Гидратация закончилась — у main есть данные React. */
async function waitForHydration(page: Page) {
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector("main");
        return (
          main !== null &&
          Object.keys(main).some((k) => k.startsWith("__react"))
        );
      },
      undefined,
      { timeout: SEARCH_WAIT_MS },
    )
    .catch(() => {});
}

/**
 * Сценарий «Поиск»: набор с главной и шапка по макету, Ctrl K и «Поиск» верхней полосы, фильтры левой
 * панели и «назад», вторая страница, ссылка с фильтрами в чистом окне, шторка фильтра на телефоне,
 * неполная выдача без сдвигов, пустые ответы и 429; axe и ширина телефона на выдаче; ошибки страницы и
 * нарушения CSP — тоже проблемы.
 */
export async function checkSearchPage(
  browser: Browser,
  o: SearchCheckContext,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const problems: string[] = [];
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const requests = searchRequests(page, o.api);
  // Превью без смысла отвечает «только по словам» (text), а память вкладки хранит лишь полные
  // ответы: здесь ответы — полные, как у живого API, иначе «назад» не из чего брать.
  const api = new URL(o.api);
  await page.route(
    (url) => url.origin === api.origin && url.pathname === "/search",
    guarded(problems, async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...json, semantic: "full" } });
    }),
  );
  problems.push(...(await homeProblems(page, o, requests)));
  if (problems.length === 0) {
    problems.push(...(await filterProblems(page, requests)));
  }
  shots.push({
    title: "/search — выдача с фильтрами",
    png: await shot(page, seen),
  });
  problems.push(...(await pageProblems(page, o, requests)));
  problems.push(...(await headerProblems(page, o)));
  problems.push(
    ...(await allViolations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();

  // Ссылка с фильтрами в чистом окне — та же выдача; там же axe и телефон.
  const fresh = await browser.newContext({ viewport: DESKTOP });
  const freshPage = await fresh.newPage();
  const freshRequests = searchRequests(freshPage, o.api);
  const deep = `?q=${SEARCH_QUERY}&style=filled&set=ph`;
  await freshPage.goto(`${o.base}/search${deep}`, { waitUntil: "load" });
  const link = await waitFor(freshPage, final(deep));
  if (!link.ok) {
    problems.push(`ссылка с фильтрами: выдача «${link.facts.state}»`);
  } else {
    const api = await matchesApi(
      "ссылка с фильтрами",
      link.facts,
      freshRequests,
      (p) =>
        p.get("style") === "filled" && p.get("prefixes") === "ph"
          ? undefined
          : "фильтры не дошли",
    );
    if (api) problems.push(api);
  }
  const axePages: { path: string; violations: AxeViolation[] }[] = [];
  await runAxe(freshPage, await axe(), `/search${deep}`, axePages);
  const access = axeVerdict(axePages);
  if (access.ok === false) problems.push(`axe: ${access.note}`);
  await freshPage.setViewportSize(PHONE);
  const width = await freshPage.evaluate(
    () => document.documentElement.scrollWidth,
  );
  if (width > PHONE.width) problems.push(`телефон: ширина ${width} px`);
  await fresh.close();

  problems.push(...(await sheetProblems(browser, o, shots)));
  problems.push(...(await pendingProblems(browser, o)));
  problems.push(...(await emptyProblems(browser, o)));
  return problems.length === 0
    ? pass(
        "набор с главной, Ctrl K и «Поиск» в верхней полосе — без перезагрузки, фокус в поле; шапка «Search Results»; стиль и набор в левой панели, «назад» из памяти, страница 2 целыми рядами, ссылка с фильтрами — как у API; шторка фильтра на телефоне; по словам → полная без сдвигов; «ничего», «по смыслу», «с фильтрами пусто», 429; axe и 375 px",
      )
    : fail(problems.slice(0, 4).join("; "));
}

/** Контрольный запуск: выдача навсегда неполная — сценарий обязан это заметить. */
export async function searchCanaryCaught(
  browser: Browser,
  o: SearchCheckContext,
): Promise<boolean> {
  const problems = await pendingProblems(browser, o, { pendingForever: true });
  return problems.some((p) => p.startsWith("поиск без полной выдачи"));
}
