// Проверка тега в трёх браузерах (фаза 3, шаг 5; ADR-0035): pnpm sandbox --check открывает страницы
// «Тег» и «5000 иконок» в Chrome, Firefox и WebKit — по очереди, чтобы не съесть память, — и проверяет
// обещания шага: регистрацию двух копий, стили и Trusted Types при строгой CSP, заглушки, рамку,
// перекраску, подпись, место до загрузки и ленивую загрузку. Сеть не нужна: API и статика — превью
// на этом компьютере (pnpm api preview), песочница — тоже. Подпись проверяется только в Chrome — по
// дереву доступности браузера: у Firefox и WebKit Playwright его не даёт; Firefox проверяют Экранным
// диктором вручную, Safari — VoiceOver на Mac. Чистые части — разбор предупреждений, раскладки и
// ошибок — проверяются тестами без браузера.

import type { Browser, Page } from "playwright";
import { BROWSERS, type BrowserName, launchBrowser } from "./browser.js";
import { checkNetwork, NET_CHECKS } from "./net-check.js";
import {
  fail,
  layoutVerdict,
  pass,
  recordViolations,
  shot,
  type Verdict,
  violations,
  watch,
} from "./verdict.js";

export const CHECKS = [
  [
    "copies",
    "Две копии на странице: тег зарегистрирован один раз, вторая копия — без ошибок",
  ],
  ["styles", "Стили тега действуют при строгой CSP (adoptedStyleSheets)"],
  ["trusted", "Trusted Types включены; политика iconavo одна на две копии"],
  ["errors", "Ни ошибок страницы, ни нарушений CSP"],
  [
    "warnings",
    "Предупреждения — по одному на неверное значение и на иконку, которой нет",
  ],
  ["delay", "Заглушка: первые 150 мс скрыта, потом видна и анимирована"],
  ["motion", "Без анимации в системе заглушки не мерцают и не крутятся"],
  ["frame", "Иконки нет — пунктирная рамка в режиме разработки"],
  ["recolor", "Иконка перекрашивается вслед за цветом текста"],
  ["label", "Подпись: обе кнопки из README называются «Delete»"],
  ["reserve", "Место до загрузки: имена рядом с иконками не сдвигаются"],
  ["lazy", "Лениво: сначала только иконки у экрана, после прокрутки — все"],
  ...NET_CHECKS,
] as const;

export type CheckId = (typeof CHECKS)[number][0];

export interface BrowserResult {
  browser: BrowserName;
  /** Браузер не запустился или страница не открылась — почему. */
  failure?: string;
  verdicts: Partial<Record<CheckId, Verdict>>;
  /** Снимки: подпись и PNG в base64. */
  shots: { title: string; png: string }[];
}

export interface SandboxCheckOptions {
  /** Песочница: http://127.0.0.1:порт. */
  base: string;
  /** Хост API превью — для ?api=. */
  api: string;
  /** Второе превью — второй хост статики страницы сбоев сети. */
  static2: string;
  browsers?: readonly BrowserName[];
  log?: (line: string) => void;
}

/**
 * Предупреждения страницы тега — по одному на текст: неверные значения из раздела «Атрибуты» и
 * иконки, которых нет (tag-page.ts).
 */
export const EXPECTED_WARNINGS = [
  'Iconavo: invalid rotate "45deg", use 90deg, 180deg, 270deg or 1, 2, 3',
  'Iconavo: invalid width "50%", use a number, a CSS length or auto',
  'Iconavo: invalid color "bogus", use a CSS color',
  'Iconavo: icon "lucide:no-such-icon" not found',
  'Iconavo: icon "nope:house" not found',
  'Iconavo: invalid icon name "Lucide:House"',
];

/** Каждое ожидаемое предупреждение — ровно один раз, чужих предупреждений пакета нет. */
export function warningsVerdict(messages: string[]): Verdict {
  const ours = messages.filter((m) => m.startsWith("Iconavo:"));
  const problems = [
    ...EXPECTED_WARNINGS.map(
      (text) => [text, ours.filter((m) => m === text).length] as const,
    )
      .filter(([, count]) => count !== 1)
      .map(([text, count]) => `${count} раз: ${text}`),
    ...[...new Set(ours.filter((m) => !EXPECTED_WARNINGS.includes(m)))].map(
      (m) => `лишнее: ${m}`,
    ),
  ];
  return problems.length === 0
    ? {
        ok: true,
        note: `${EXPECTED_WARNINGS.length} предупреждений, по одному`,
      }
    : { ok: false, note: problems.join("; ") };
}

/** Ошибки страницы и нарушения CSP. */
export function errorsVerdict(errors: string[], violations: string[]): Verdict {
  const all = [...errors, ...violations.map((v) => `CSP: ${v}`)];
  return all.length === 0
    ? { ok: true, note: "нет" }
    : { ok: false, note: [...new Set(all)].slice(0, 5).join("; ") };
}

/** Замер заглушки в браузере (measurePlaceholder). */
export interface PlaceholderMeasure {
  /** Видимость при вставке — на 0 мс анимации задержки h. */
  startVisibility: string;
  /** Время анимации h в первом кадре после её старта; null — анимации задержки нет. */
  earlyAt: number | null;
  earlyVisibility: string;
  /** Видимость после конца задержки. */
  lateVisibility: string;
  /** Анимации скелетона и спиннера после задержки (animation-name). */
  skeleton: string;
  spinner: string;
}

/**
 * Задержка заглушки: при вставке и в первом кадре после старта анимации h скрыта, после её конца —
 * видна и анимирована (скелетон мерцает — p, спиннер крутится — s). Первый кадр позже 140 мс не
 * судится: на медленной машине задержка к нему уже прошла. null — класс skeleton не появился.
 */
export function delayVerdict(p: PlaceholderMeasure | null): Verdict {
  if (!p) return fail("класс skeleton не появился за 10 с");
  if (p.earlyAt === null) {
    return fail(`у заглушки нет анимации задержки h; анимации ${p.skeleton}`);
  }
  const at = Math.round(p.earlyAt);
  const early = p.earlyAt < 140 ? p.earlyVisibility === "hidden" : null;
  const animated = p.skeleton.includes("p") && p.spinner.includes("s");
  if (
    p.startVisibility !== "hidden" ||
    early === false ||
    p.lateVisibility !== "visible" ||
    !animated
  ) {
    return fail(
      `при вставке — ${p.startVisibility}, на ${at} мс анимации — ${p.earlyVisibility}, после задержки — ${p.lateVisibility}; анимации ${p.skeleton} / ${p.spinner}`,
    );
  }
  return early === null
    ? {
        ok: null,
        note: `при вставке скрыта, первый кадр анимации пришёл поздно (${at} мс), после задержки — видна; анимации ${p.skeleton} / ${p.spinner}`,
      }
    : pass(
        `при вставке и на ${at} мс анимации скрыта, после 150 мс видна; анимации ${p.skeleton} / ${p.spinner}`,
      );
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, {
    timeout: 60_000,
  });
}

/** Прокрутить страницу до конца шагами в полэкрана — теги подходят к видимой части по очереди. */
const scrollThrough = (page: Page, pause: number) =>
  page.evaluate(async (ms) => {
    for (let y = 0; y <= document.body.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  }, pause);

/**
 * Заглушка в первом теге раздела после «Показать заново» — по её собственной анимации задержки h (Web
 * Animations API). Заглушку ловит наблюдатель shadow root тега в той же задаче, где тег её вставил, до
 * отрисовки кадра: там берутся анимация h и видимость на её 0 мс. Опрос по кадрам замечал заглушку на
 * кадр позже, а WebKit ведёт время анимации от прошлого кадра, то есть от вставки: в CI кадр дольше
 * 150 мс съедал всю задержку, и анимации h к замеру уже не было (ADR-0035). Дальше — видимость в первом
 * кадре после старта анимации, после её конца и анимации. Таймером от смены класса мерить нельзя:
 * WebKit запускает CSS-анимацию на ближайшей отрисовке кадра. earlyAt — время анимации в этом кадре;
 * null — анимации задержки нет.
 */
function measurePlaceholder(page: Page): Promise<PlaceholderMeasure | null> {
  return page.evaluate(async () => {
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    const within = (promise: Promise<unknown>, ms: number) =>
      Promise.race([
        promise.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, ms)),
      ]);
    document.getElementById("placeholders")?.scrollIntoView();
    (document.getElementById("again") as HTMLButtonElement).click();
    const tags = [
      ...document.querySelectorAll<HTMLElement>(
        "#placeholder-cells iconavo-icon",
      ),
    ];
    const svg = (tag: HTMLElement | undefined) =>
      tag?.shadowRoot?.querySelector("svg") ?? null;
    const skeleton = tags[0];
    const spinner = tags.find(
      (t) => t.getAttribute("placeholder") === "spinner",
    );
    const caught = await new Promise<{
      node: SVGElement;
      hide: Animation | undefined;
      visibility: string;
    } | null>((resolve) => {
      const take = () => {
        const node = svg(skeleton);
        if (node?.getAttribute("class") !== "skeleton") return;
        observer.disconnect();
        clearTimeout(timer);
        // getAnimations сначала пересчитывает стили: анимация h создаётся здесь, ещё не начатой.
        const hide = node
          .getAnimations()
          .find((a) => (a as CSSAnimation).animationName === "h");
        resolve({ node, hide, visibility: getComputedStyle(node).visibility });
      };
      const observer = new MutationObserver(take);
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, 10_000);
      // Тег вставляет новый <svg>, но и смена класса у прежнего не пройдёт мимо.
      if (skeleton?.shadowRoot) {
        observer.observe(skeleton.shadowRoot, {
          childList: true,
          subtree: true,
          attributeFilter: ["class"],
        });
      }
      take();
    });
    if (!caught) return null;
    const { node, hide } = caught;
    let earlyAt: number | null = null;
    let earlyVisibility = "";
    if (hide) {
      await within(hide.ready, 5000);
      await frame();
      earlyAt = Number(hide.currentTime ?? 0);
      earlyVisibility = getComputedStyle(node).visibility;
      await within(hide.finished, 5000);
      await frame();
    }
    const late = svg(skeleton);
    return {
      startVisibility: caught.visibility,
      earlyAt,
      earlyVisibility,
      lateVisibility: late ? getComputedStyle(late).visibility : "",
      skeleton: late ? getComputedStyle(late).animationName : "",
      spinner: (() => {
        const element = svg(spinner);
        return element ? getComputedStyle(element).animationName : "";
      })(),
    };
  });
}

async function checkTagPage(
  browser: Browser,
  name: BrowserName,
  o: SandboxCheckOptions,
  result: BrowserResult,
): Promise<{ errors: string[]; violations: string[] }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  await open(page, `${o.base}/tag?api=${encodeURIComponent(o.api)}`);
  const v = result.verdicts;

  const [first, second] = await Promise.all(
    ["#diag-first", "#diag-second"].map((s) => page.locator(s).innerText()),
  );
  v.copies =
    first?.includes("без сборщика") && second?.includes("пропустила")
      ? pass("регистрирует скрипт без сборщика, копия сборщика пропускает")
      : fail(`${first} / ${second}`);

  // Заглушка: класс при активации, скрыта первые 150 мс своей анимации, потом видна и анимирована.
  v.delay = delayVerdict(await measurePlaceholder(page));
  result.shots.push({
    title: "Тег: заглушки во время загрузки",
    png: await shot(page, seen, "#placeholders"),
  });

  // Все разделы: прокрутка до конца, затем ждём, пока каждый тег нарисован или «нет».
  await scrollThrough(page, 100);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll<HTMLElement>("iconavo-icon:not([hidden])")]
        .filter((tag) => !tag.closest("#placeholder-cells"))
        .every((tag) =>
          tag.shadowRoot?.querySelector("svg[viewBox], svg.missing"),
        ),
    null,
    { timeout: 60_000 },
  );

  // Тег в строке текста: внутри flex-клеток браузер делает его блоком — так велит CSS.
  const styles = await page.evaluate(() => {
    const tag = document.querySelector("#inline iconavo-icon");
    const svg = tag?.shadowRoot?.querySelector("svg");
    const hidden = document.querySelector("iconavo-icon[hidden]");
    return {
      host: tag ? getComputedStyle(tag).display : "",
      svg: svg ? getComputedStyle(svg).display : "",
      hidden: hidden ? getComputedStyle(hidden).display : "",
    };
  });
  v.styles =
    styles.host === "inline-block" &&
    styles.svg === "block" &&
    styles.hidden === "none"
      ? pass("тег — inline-block, <svg> — block, hidden прячет тег")
      : fail(
          `тег — ${styles.host}, <svg> — ${styles.svg}, hidden — ${styles.hidden}`,
        );

  const frame = await page.evaluate(() => {
    const tag = document.querySelector(
      '#missing-cells iconavo-icon[icon="nope:house"]',
    );
    const svg = tag?.shadowRoot?.querySelector("svg");
    return svg
      ? `${svg.getAttribute("class")} ${getComputedStyle(svg).outlineStyle}`
      : "";
  });
  v.frame =
    frame === "missing dashed"
      ? pass("пунктирная рамка на 127.0.0.1")
      : fail(`у резерва: ${frame || "ничего"}`);

  await page.locator('button[data-color="#2563eb"]').click();
  const color = await page.evaluate(() => {
    const tag = document.querySelector(
      '#recolor iconavo-icon[icon="lucide:heart"]',
    );
    const svg = tag?.shadowRoot?.querySelector("svg");
    return svg ? getComputedStyle(svg).color : "";
  });
  v.recolor =
    color === "rgb(37, 99, 235)"
      ? pass("синий текст — синяя иконка")
      : fail(`цвет иконки ${color || "не прочитан"}`);
  result.shots.push({
    title: "Тег: цвет и размер от текста (синий)",
    png: await shot(page, seen, "#color"),
  });
  await page.locator('button[data-color=""]').click();
  result.shots.push({
    title: "Тег: атрибуты и неверные значения",
    png: await shot(page, seen, "#attributes"),
  });

  if (name === "chrome") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Accessibility.enable");
    const tree = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: { role?: { value?: string }; name?: { value?: string } }[];
    };
    const buttons = tree.nodes
      .filter((n) => n.role?.value === "button")
      .map((n) => n.name?.value ?? "");
    // Пробелы по краям имени — от текста вокруг иконки; скринридер их не произносит.
    const named = buttons.filter((b) => b.trim() === "Delete").length;
    v.label =
      named === 2
        ? pass("по дереву доступности Chrome: обе кнопки — «Delete»")
        : fail(
            `кнопок «Delete» — ${named} из 2; имена кнопок: ${buttons.map((b) => `«${b}»`).join(", ")}`,
          );
  } else {
    v.label = {
      ok: null,
      note:
        name === "firefox"
          ? "вручную — Экранным диктором"
          : "не проверяется: дерево доступности есть только у Chrome, VoiceOver — на Mac",
    };
  }

  v.warnings = warningsVerdict(seen.warnings);
  const errors = [...seen.errors];
  const found = await violations(page);
  const policy = await page.locator("#diag-policy").innerText();
  // Последней — пробная запись строки в innerHTML: при включённых Trusted Types она запрещена, а её
  // нарушение в ошибки страницы не идёт — они уже сняты.
  const enforced = await page.evaluate(() => {
    try {
      document.createElement("div").innerHTML = "<b>probe</b>";
      return false;
    } catch {
      return true;
    }
  });
  v.trusted = !enforced
    ? {
        ok: null,
        note: `браузер не включил Trusted Types; политика: ${policy}`,
      }
    : policy.includes("«iconavo»") && policy.includes("— 1")
      ? pass(`включены; политика ${policy}`)
      : fail(`политика: ${policy}`);
  await context.close();
  return { errors, violations: found };
}

/** Без анимации: у заглушек остаётся только задержка показа. */
async function checkMotion(
  browser: Browser,
  o: SandboxCheckOptions,
  result: BrowserResult,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await open(page, `${o.base}/tag?api=${encodeURIComponent(o.api)}`);
  const placeholder = await measurePlaceholder(page);
  result.verdicts.motion = !placeholder
    ? fail("класс skeleton не появился за 10 с")
    : placeholder.earlyAt !== null &&
        placeholder.skeleton === "h" &&
        placeholder.spinner === "h"
      ? pass("остаётся только задержка показа")
      : fail(`анимации ${placeholder.skeleton} / ${placeholder.spinner}`);
  await context.close();
}

/** Страница 5000 иконок: место до загрузки при задержанных ответах и ленивая загрузка. */
async function checkManyPage(
  browser: Browser,
  o: SandboxCheckOptions,
  result: BrowserResult,
): Promise<{ errors: string[]; violations: string[] }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().startsWith(o.api)) requests++;
  });
  // Ответы API и статики — на 800 мс позже: до них место держит резерв.
  const slow = `${o.api}/**`;
  await page.route(slow, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    // Задержку могли уже снять — тогда запрос ушёл сам.
    await route.continue().catch(() => {});
  });
  await open(page, `${o.base}/many?api=${encodeURIComponent(o.api)}`);
  const spots = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".c span")].slice(0, 300).map((span) => {
        const box = span.getBoundingClientRect();
        return { left: box.left, top: box.top };
      }),
    );
  const drawn = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll("iconavo-icon")].filter((tag) =>
          tag.shadowRoot?.querySelector("svg[viewBox]"),
        ).length,
    );
  const before = await spots();
  const drawnBefore = await drawn();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("iconavo-icon")].filter((tag) =>
        tag.shadowRoot?.querySelector("svg[viewBox]"),
      ).length >= 100,
    null,
    { timeout: 60_000 },
  );
  const after = await spots();
  const reserve = layoutVerdict(before, after);
  result.verdicts.reserve =
    drawnBefore === 0
      ? reserve
      : {
          ok: null,
          note: `иконки пришли раньше замера (${drawnBefore}); ${reserve.note}`,
        };
  result.shots.push({
    title: "5000 иконок: начало страницы",
    png: await shot(page, seen),
  });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const first = await drawn();
  const firstRequests = requests;
  await scrollThrough(page, 120);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("iconavo-icon")].every((tag) =>
        tag.shadowRoot?.querySelector("svg[viewBox]"),
      ),
    null,
    { timeout: 120_000 },
  );
  const total = await drawn();
  result.verdicts.lazy =
    first < total
      ? pass(
          `сначала ${first} иконок и ${firstRequests} запросов, после прокрутки — ${total} и ${requests}`,
        )
      : fail(`сразу нарисованы все ${total}: загрузка не ленивая`);
  const found = await violations(page);
  await context.close();
  return { errors: seen.errors, violations: found };
}

async function checkBrowser(
  name: BrowserName,
  o: SandboxCheckOptions,
): Promise<BrowserResult> {
  const result: BrowserResult = { browser: name, verdicts: {}, shots: [] };
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser(name, true);
    o.log?.(`${name}: страница «Тег»…`);
    const tag = await checkTagPage(browser, name, o, result);
    o.log?.(`${name}: без анимации…`);
    await checkMotion(browser, o, result);
    o.log?.(`${name}: 5000 иконок…`);
    const many = await checkManyPage(browser, o, result);
    result.verdicts.errors = errorsVerdict(
      [...tag.errors, ...many.errors],
      [...tag.violations, ...many.violations],
    );
    Object.assign(
      result.verdicts,
      await checkNetwork(browser, o, (line) => o.log?.(`${name}: ${line}`)),
    );
  } catch (e) {
    result.failure = (e as Error).message.split("\n")[0];
  } finally {
    await browser?.close();
  }
  return result;
}

/** Все браузеры по очереди. */
export async function checkSandbox(
  o: SandboxCheckOptions,
): Promise<BrowserResult[]> {
  const results: BrowserResult[] = [];
  for (const name of o.browsers ?? BROWSERS) {
    results.push(await checkBrowser(name, o));
  }
  return results;
}

/** Провал: браузер не прошёл до конца или хоть одна проверка — «нет». */
export const sandboxCheckFailed = (results: BrowserResult[]) =>
  results.some(
    (r) =>
      r.failure !== undefined ||
      Object.values(r.verdicts).some((v) => v.ok === false),
  );
