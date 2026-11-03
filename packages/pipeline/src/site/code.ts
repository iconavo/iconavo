// Сценарии генератора кода и скачивания проверки сайта (шаг 5 фазы 4, ADR-0042): код каждого вида на
// странице иконки с настройками из адреса и в панели — как записано в ожиданиях, как строки README тега
// и как ответ превью edge API; выбор вида кода и менеджера пакетов после перезагрузки; код тега рисует
// иконку в чистой странице со скриптом тега этой ветки; копирование (Chrome); файлы SVG и PNG; метки
// аналитики (ADR-0043). Ошибки сценария — список «не так»; контрольный запуск подкладывает поломки
// скриптом до страницы или подменой ответа API и ждёт, что список не пуст.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { bundleIconScript } from "../icon/build.js";
import { decodePng } from "../qc/png.js";
import type { BrowserName } from "../sandbox/browser.js";
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
  CODE_EXPECT,
  CODE_FILLED,
  CODE_ICON,
  CODE_PALETTE,
  CODE_SETTINGS,
  DESKTOP,
  iconPath,
  PANEL_WAIT_MS,
  PNG_CHECK_SIZES,
} from "./config.js";
import {
  type CrawledPage,
  codeHtmlProblems,
  readmeImport,
  readmeScript,
} from "./crawl.js";
import { hydrated } from "./panel.js";

export interface CodeCheckOptions {
  base: string;
  /** Превью edge API: с ним сверяются SVG, ссылка и CSS. */
  api: string;
  /** Корень репозитория: README тега и скрипт тега этой ветки. */
  root: string;
  /** Страницы обхода: серверный HTML страниц иконок. */
  pages: CrawledPage[];
}

/** Метки аналитики — событие страницы iconavo:track (apps/site/lib/analytics.ts), до её скриптов. */
export async function recordTrack(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const list: unknown[] = [];
    (window as unknown as { tracked: unknown[] }).tracked = list;
    document.addEventListener("iconavo:track", (e) =>
      list.push((e as CustomEvent).detail),
    );
  });
}

interface Tracked {
  name: string;
  what?: string;
  format?: string;
  icon?: string;
  size?: number;
}

const tracked = (page: Page): Promise<Tracked[]> =>
  page.evaluate(
    () => (window as unknown as { tracked?: Tracked[] }).tracked ?? [],
  );

/** Текст блока генератора: панель, если открыта, иначе страница; ждёт ожидаемый текст, если он задан. */
async function snippet(
  page: Page,
  name: string,
  expect?: string,
): Promise<string> {
  const read = ([n, e]: readonly [string, string | null]) => {
    const root =
      document.querySelector("aside.icon-panel .icon-code") ??
      document.querySelector("main .icon-code");
    const text =
      root?.querySelector(`figure.code[data-snippet="${n}"] pre`)
        ?.textContent ?? null;
    return e === null ? text !== null && text !== "" : text === e;
  };
  await page
    .waitForFunction(read, [name, expect ?? null] as const, {
      timeout: PANEL_WAIT_MS,
    })
    .catch(() => {});
  return page.evaluate((n) => {
    const root =
      document.querySelector("aside.icon-panel .icon-code") ??
      document.querySelector("main .icon-code");
    return (
      root?.querySelector(`figure.code[data-snippet="${n}"] pre`)
        ?.textContent ?? ""
    );
  }, name);
}

/** Кнопка генератора: вид кода, менеджер пакетов, размер PNG. */
const press = (page: Page, scope: string, name: string) =>
  page
    .locator(scope)
    .first()
    .getByRole("button", { name, exact: true })
    .click();

/** Страница иконки с настройками из адреса: ждём, пока настройки дойдут до кода тега. */
async function openWithSettings(page: Page, base: string) {
  await page.goto(`${base}${iconPath(CODE_ICON)}?${CODE_SETTINGS}`);
  await hydrated(page);
}

/** Скрипт тега этой ветки — один раз на прогон. */
let script: Promise<string> | undefined;
const tagScript = (root: string) => {
  script ??= bundleIconScript(root);
  return script;
};

/**
 * Код тега в чистой странице без сайта: скрипт тега этой ветки, хосты — превью API. Иконка нарисована с
 * размером, цветом, толщиной и поворотом из кода, без предупреждений о неверных атрибутах.
 */
async function tagRenders(
  browser: Browser,
  o: CodeCheckOptions,
  code: string,
): Promise<string[]> {
  const body = await tagScript(o.root);
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  const origin = `${o.base}/__iconavo-check`;
  await page.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return path.endsWith("/iconavo-icon.js")
      ? route.fulfill({ contentType: "text/javascript", body })
      : route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="en"><head><script type="module">import { configure } from "./iconavo-icon.js"; configure({ api: ["${o.api}"], cdn: ["${o.api}/_static"] });</script></head><body>${code}</body></html>`,
        });
  });
  // Запросы к превью API — через Playwright: документ, который отдал route, Chrome считает чужим и не
  // пускает его запросы к адресам этого компьютера (Local Network Access).
  await page.route(
    (url) => url.href.startsWith(o.api),
    async (route) => {
      // Окно могут закрыть, пока ответ ещё идёт: тогда он не нужен.
      try {
        await route.fulfill({ response: await route.fetch() });
      } catch {
        // Окно закрыто.
      }
    },
  );
  await page.goto(`${origin}/`);
  const drawn = await page
    .waitForFunction(
      () => {
        const svg = document
          .querySelector("iconavo-icon")
          ?.shadowRoot?.querySelector("svg");
        return svg && svg.childNodes.length > 0
          ? {
              width: svg.getAttribute("width") ?? "",
              color: getComputedStyle(svg).color,
              body: svg.innerHTML,
            }
          : false;
      },
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => undefined);
  const problems: string[] = [];
  if (drawn === undefined || drawn === false) {
    problems.push("код тега в чистой странице не нарисовал иконку");
  } else {
    const [r, g, b] = CODE_EXPECT.rgb;
    if (drawn.width !== "64") {
      problems.push(`код тега: ширина ${drawn.width}, а ждали 64`);
    }
    if (drawn.color !== `rgb(${r}, ${g}, ${b})`) {
      problems.push(`код тега: цвет ${drawn.color}`);
    }
    if (!drawn.body.includes('stroke-width="1.5"')) {
      problems.push("код тега: толщина линии не применена");
    }
    if (!drawn.body.includes("rotate(90")) {
      problems.push("код тега: поворот не применён");
    }
  }
  const warned = seen.warnings.filter((w) => w.includes("Iconavo"));
  if (warned.length > 0) problems.push(`код тега: ${warned[0]}`);
  await context.close();
  return problems;
}

/**
 * Генератор кода на странице иконки с настройками из адреса и в панели: тег, React, SVG, CSS и ссылка;
 * установка npm, pnpm и yarn; выбор после перезагрузки; строки README; копирование (Chrome); метки.
 */
export async function codeProblems(
  page: Page,
  o: CodeCheckOptions,
  clipboard: boolean,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const same = (what: string, got: string, want: string) =>
    no(
      got === want,
      `${what}: «${got.slice(0, 160)}», а ждали «${want.slice(0, 160)}»`,
    );
  const readme = await readFile(
    join(o.root, "packages", "icon", "README.md"),
    "utf8",
  );
  problems.push(...codeHtmlProblems(o.pages, readme));
  const api = await fetch(
    `${o.api}${iconPath(CODE_ICON)}.svg?${CODE_EXPECT.query}`,
  );
  const apiSvg = await api.text();
  no(api.status === 200, `превью API: SVG с настройками — ${api.status}`);

  await openWithSettings(page, o.base);
  same(
    "код тега",
    await snippet(page, "code", CODE_EXPECT.tag),
    CODE_EXPECT.tag,
  );
  same(
    "установка тега",
    await snippet(page, "install"),
    "npm install @iconavo-ui/icon",
  );
  same("подключение тега", await snippet(page, "import"), readmeImport(readme));
  same("без сборщика", await snippet(page, "script"), readmeScript(readme));
  await press(page, ".icon-code", "pnpm");
  same(
    "установка через pnpm",
    await snippet(page, "install", "pnpm add @iconavo-ui/icon"),
    "pnpm add @iconavo-ui/icon",
  );
  await press(page, ".icon-code", "yarn");
  await press(page, ".icon-code", "React");
  same(
    "установка React через yarn",
    await snippet(page, "install", "yarn add @iconavo-ui/react"),
    "yarn add @iconavo-ui/react",
  );
  same(
    "код React",
    await snippet(page, "code", CODE_EXPECT.react),
    CODE_EXPECT.react,
  );
  await press(page, ".icon-code", "SVG");
  same("код SVG — ответ API", await snippet(page, "code", apiSvg), apiSvg);
  await press(page, ".icon-code", "CSS");
  const css = CODE_EXPECT.css(o.api);
  same("код CSS", await snippet(page, "code", css), css);
  const href = /href="([^"]+)"/.exec(css)?.[1] ?? "";
  const sheet = await fetch(href);
  const sheetText = await sheet.text();
  no(
    sheet.status === 200 &&
      sheetText.includes(".icon--lucide--house") &&
      sheetText.includes("stroke-width='1.5'"),
    `CSS по ссылке из кода: ${sheet.status}, без класса иконки или толщины`,
  );
  await press(page, ".icon-code", "URL");
  const link = `${o.api}${iconPath(CODE_ICON)}.svg?${CODE_EXPECT.query}`;
  same("ссылка", await snippet(page, "code", link), link);

  // Копирование — только Chrome: доступ к буферу. Метка — до перезагрузки: события живут до неё.
  if (clipboard) {
    await page.locator(".icon-code figure.code button.copy").first().click();
    await page.waitForTimeout(300);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    same("скопировано", copied, link);
    no(
      (await tracked(page)).some((e) => e.name === "copy" && e.what === "link"),
      "нет метки аналитики copy",
    );
  }

  // Выбор после перезагрузки: вид кода — «Ссылка», менеджер пакетов — yarn. Из хранилища выбор
  // приходит после гидратации.
  await page.reload();
  await hydrated(page);
  await page
    .waitForFunction(
      () =>
        document.querySelector(".icon-code")?.getAttribute("data-code") ===
        "link",
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  same(
    "вид кода после перезагрузки",
    await page.evaluate(
      () =>
        document.querySelector(".icon-code")?.getAttribute("data-code") ?? "",
    ),
    "link",
  );
  await press(page, ".icon-code", "Tag");
  same(
    "менеджер пакетов после перезагрузки",
    await snippet(page, "install", "yarn add @iconavo-ui/icon"),
    "yarn add @iconavo-ui/icon",
  );

  // Цветной набор — без цвета и толщины; заливка — без толщины.
  for (const { path, tag } of [CODE_PALETTE, CODE_FILLED]) {
    await page.goto(`${o.base}${path}`);
    await hydrated(page);
    same(`код тега ${path}`, await snippet(page, "code", tag), tag);
  }

  // Панель: тот же генератор, настройки вкладки — по умолчанию.
  await page.goto(`${o.base}/${CATALOG_SET}?icon=${CODE_ICON}`);
  await hydrated(page);
  const plain = `<iconavo-icon icon="${CODE_ICON}"></iconavo-icon>`;
  same("код тега в панели", await snippet(page, "code", plain), plain);
  return problems;
}

/** Строка «Код»: сценарий, код тега в чистой странице, CSP и консоль. */
export async function checkCode(
  browser: Browser,
  name: BrowserName,
  o: CodeCheckOptions,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const context = await browser.newContext({ viewport: DESKTOP });
  if (name === "chrome") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: o.base,
    });
  }
  await recordTrack(context);
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems = await codeProblems(page, o, name === "chrome");
  shots.push({ title: "Генератор кода в панели", png: await shot(page, seen) });
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
    ...(await tagRenders(browser, o, CODE_EXPECT.tag)),
  );
  await context.close();
  return problems.length === 0
    ? pass(
        `тег, React, SVG (как у edge API), CSS и ссылка с настройками; npm, pnpm и yarn; выбор после перезагрузки; строки README; код тега рисует иконку${name === "chrome" ? "; копирование" : ""}`,
      )
    : fail(problems.slice(0, 4).join("; "));
}

/** Файл скачивания: имя и содержимое. */
async function downloaded(
  page: Page,
  click: () => Promise<void>,
): Promise<{ name: string; body: Buffer } | undefined> {
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: PANEL_WAIT_MS }),
      click(),
    ]);
    const path = await download.path();
    return { name: download.suggestedFilename(), body: await readFile(path) };
  } catch {
    return undefined;
  }
}

/** PNG: размер, закрашенные точки и средний цвет закрашенного. */
export function pngFacts(body: Uint8Array) {
  const image = decodePng(body);
  let painted = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < image.data.length; i += 4) {
    if ((image.data[i + 3] ?? 0) < 128) continue;
    painted++;
    for (let c = 0; c < 3; c++)
      sum[c] = (sum[c] ?? 0) + (image.data[i + c] ?? 0);
  }
  return {
    width: image.width,
    height: image.height,
    painted,
    rgb: sum.map((v) => (painted === 0 ? 0 : Math.round(v / painted))),
  };
}

/** Скачивание одной иконки: SVG с комментарием и PNG 16 и 512 px; метки аналитики. */
export async function filesProblems(
  page: Page,
  o: CodeCheckOptions,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const apiSvg = await (
    await fetch(`${o.api}${iconPath(CODE_ICON)}.svg?${CODE_EXPECT.query}`)
  ).text();
  await openWithSettings(page, o.base);
  await snippet(page, "code", CODE_EXPECT.tag);
  await page
    .getByRole("button", { name: "Download SVG", exact: true })
    .waitFor({ timeout: PANEL_WAIT_MS })
    .catch(() => {});

  const svg = await downloaded(page, () =>
    page.getByRole("button", { name: "Download SVG", exact: true }).click(),
  );
  if (svg === undefined) {
    problems.push("SVG не скачался");
  } else {
    const [comment = "", drawing = ""] = svg.body.toString("utf8").split("\n");
    no(svg.name === "lucide-house.svg", `имя файла SVG — ${svg.name}`);
    no(
      /^<!-- lucide:house\. Icons: Lucide by .+ License text: https:\/\/iconavo\.dev\/licenses#lucide -->$/.test(
        comment,
      ) && !comment.slice(4, -3).includes("--"),
      `комментарий SVG: «${comment.slice(0, 120)}»`,
    );
    no(drawing === apiSvg, "рисунок SVG-файла — не как ответ edge API");
  }

  for (const px of PNG_CHECK_SIZES) {
    await press(page, ".icon-export", String(px));
    const png = await downloaded(page, () =>
      page.getByRole("button", { name: "Download PNG", exact: true }).click(),
    );
    if (png === undefined) {
      problems.push(`PNG ${px} не скачался`);
      continue;
    }
    no(png.name === `lucide-house-${px}.png`, `имя файла PNG — ${png.name}`);
    let f: ReturnType<typeof pngFacts> | undefined;
    try {
      f = pngFacts(png.body);
    } catch (e) {
      problems.push(`PNG ${px} не читается: ${(e as Error).message}`);
      continue;
    }
    no(f.width === px && f.height === px, `PNG ${px}: ${f.width}×${f.height}`);
    no(f.painted > 0, `PNG ${px} пустой`);
    const off = f.rgb.map((v, i) => Math.abs(v - (CODE_EXPECT.rgb[i] ?? 0)));
    no(
      f.painted === 0 || Math.max(...off) <= 40,
      `PNG ${px}: цвет rgb(${f.rgb.join(", ")}), а ждали rgb(${CODE_EXPECT.rgb.join(", ")})`,
    );
  }

  const events = await tracked(page);
  no(
    events.some((e) => e.name === "download" && e.format === "svg"),
    "нет метки аналитики download для SVG",
  );
  no(
    events.some((e) => e.name === "download" && e.format === "png"),
    "нет метки аналитики download для PNG",
  );
  return problems;
}

/** Строка «Скачивание»: сценарий, CSP и консоль. */
export async function checkFiles(
  browser: Browser,
  o: CodeCheckOptions,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const context = await browser.newContext({
    viewport: DESKTOP,
    acceptDownloads: true,
  });
  await recordTrack(context);
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems = await filesProblems(page, o);
  shots.push({ title: "Скачивание", png: await shot(page, seen) });
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();
  return problems.length === 0
    ? pass(
        "SVG с комментарием об авторе и лицензии — рисунок как у edge API; PNG 16 и 512 px нужного цвета; метки аналитики",
      )
    : fail(problems.slice(0, 4).join("; "));
}
