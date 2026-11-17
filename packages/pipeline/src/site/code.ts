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
  CODE_SIZE,
  DESKTOP,
  iconPath,
  PANEL_WAIT_MS,
  PNG_CHECK_SCALES,
} from "./config.js";
import { type CrawledPage, readmeImport, readmeScript } from "./crawl.js";
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

/** Текст из буфера: на Windows Chrome пишет переводы строк как \r\n — приводим к \n. */
const clipText = (page: Page) =>
  page
    .evaluate(() => navigator.clipboard.readText())
    .then((text) => text.replaceAll("\r\n", "\n"));

/** Блоки генератора кода (редизайн): панель, если открыта, иначе вкладка «Код» страницы иконки. */
const CODE_ROOT = "aside.icon-panel .panel-code, #ip-tabpanel .panel-code";

/** Текст блока кода по подписи; ждёт ожидаемый текст, если он задан. */
async function codeBlock(
  page: Page,
  label: string,
  expect?: string,
): Promise<string> {
  const read = ([root, l]: readonly [string, string]) =>
    [
      ...(document.querySelector(root)?.querySelectorAll("figure.code-block") ??
        []),
    ]
      .find((f) => f.querySelector(".code-block-label")?.textContent === l)
      ?.querySelector(".code-block-code")?.textContent ?? "";
  await page
    .waitForFunction(
      ([root, l, e]) => {
        const text =
          [
            ...(document
              .querySelector(root)
              ?.querySelectorAll("figure.code-block") ?? []),
          ]
            .find(
              (f) => f.querySelector(".code-block-label")?.textContent === l,
            )
            ?.querySelector(".code-block-code")?.textContent ?? "";
        return e === null ? text !== "" : text === e;
      },
      [CODE_ROOT, label, expect ?? null] as const,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  return page.evaluate(read, [CODE_ROOT, label] as const);
}

/** «Пилюля» генератора (вид кода, менеджер пакетов) или его подвкладка — по тексту, кроме «Soon». */
const choose = (page: Page, kind: "pill" | "tab", name: string) =>
  page
    .locator(CODE_ROOT)
    .first()
    .locator(
      kind === "pill" ? ".pill-option:not(.soon)" : ".panel-tab:not(.soon)",
      {
        hasText: new RegExp(`^${name}$`),
      },
    )
    .first()
    .click();

/** Имя в поле Name генератора; ждёт ожидаемое. */
async function nameShown(page: Page, expect: string): Promise<string> {
  await page
    .waitForFunction(
      (e) =>
        (document.querySelector("button.panel-name .panel-control-text")
          ?.textContent ?? "") === e,
      expect,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  return page.evaluate(
    () =>
      document.querySelector("button.panel-name .panel-control-text")
        ?.textContent ?? "",
  );
}

/** Страница иконки с настройками из адреса, вкладка «Код». */
async function openWithSettings(page: Page, base: string, path?: string) {
  await page.goto(
    `${base}${path ?? `${iconPath(CODE_ICON)}?${CODE_SETTINGS}`}`,
  );
  await hydrated(page);
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await page
    .waitForFunction(
      () =>
        document.querySelector("#ip-tabpanel")?.getAttribute("data-tab") ===
        "code",
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
}

/** Скрипт тега этой ветки — один раз на прогон. */
let script: Promise<string> | undefined;
const tagScript = (root: string) => {
  script ??= bundleIconScript(root);
  return script;
};

/**
 * Код тега в чистой странице без сайта: скрипт тега этой ветки, хосты — превью API. Иконка нарисована с
 * размером, цветом и толщиной из кода, без предупреждений о неверных атрибутах.
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
  }
  const warned = seen.warnings.filter((w) => w.includes("Iconavo"));
  if (warned.length > 0) problems.push(`код тега: ${warned[0]}`);
  await context.close();
  return problems;
}

/**
 * Генератор кода (редизайн) на вкладке «Код» страницы иконки с настройками из адреса и в панели: HTML —
 * установка npm, pnpm и yarn и подключение из README, «Script» — строки скрипта из README; React; SVG без
 * украшений — как ответ edge API; CSS; CSS · URL — адрес SVG edge API; поле Name с форматами; выбор вида,
 * менеджера пакетов и формата имени после перезагрузки; копирование (Chrome) и метки аналитики.
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
  const link = `${o.api}${iconPath(CODE_ICON)}.svg?${CODE_EXPECT.query}`;
  const api = await fetch(link);
  const apiSvg = await api.text();
  no(api.status === 200, `превью API: SVG с настройками — ${api.status}`);

  await openWithSettings(page, o.base);
  // HTML (веб-компонент): установка и подключение из README; менеджер пакетов — npm по умолчанию.
  await choose(page, "pill", "HTML");
  same(
    "установка тега",
    await codeBlock(page, "Install", "npm install @iconavo-ui/icon"),
    "npm install @iconavo-ui/icon",
  );
  const tagUsage = `${readmeImport(readme)}\n\n${CODE_EXPECT.tag}`;
  same("код тега", await codeBlock(page, "Usage", tagUsage), tagUsage);
  await choose(page, "pill", "pnpm");
  same(
    "установка через pnpm",
    await codeBlock(page, "Install", "pnpm add @iconavo-ui/icon"),
    "pnpm add @iconavo-ui/icon",
  );
  await choose(page, "tab", "Script");
  const scriptCode = `${readmeScript(readme)}\n\n${CODE_EXPECT.tag}`;
  same("без сборщика", await codeBlock(page, "HTML", scriptCode), scriptCode);
  // React: установка через yarn и код.
  await choose(page, "pill", "React");
  await choose(page, "pill", "yarn");
  same(
    "установка React через yarn",
    await codeBlock(page, "Install", "yarn add @iconavo-ui/react"),
    "yarn add @iconavo-ui/react",
  );
  same(
    "код React",
    await codeBlock(page, "Usage", CODE_EXPECT.react),
    CODE_EXPECT.react,
  );
  // Копирование — только Chrome: доступ к буферу. Метка — до перезагрузки: события живут до неё.
  if (clipboard) {
    await page
      .locator(CODE_ROOT)
      .first()
      .locator("figure.code-block", { hasText: "Usage" })
      .locator("button")
      .last()
      .click();
    await page.waitForTimeout(300);
    same("скопированный код React", await clipText(page), CODE_EXPECT.react);
    no(
      (await tracked(page)).some(
        (e) => e.name === "copy" && e.what === "react",
      ),
      "нет метки аналитики copy у кода React",
    );
  }
  // SVG без украшений (Prettify, пустой прямоугольник, комментарий) — побайтно ответ edge API.
  await choose(page, "pill", "SVG");
  for (const option of await page
    .locator(CODE_ROOT)
    .first()
    .locator(".panel-option")
    .all()) {
    if (await option.locator("input").isChecked()) await option.click();
  }
  same("код SVG — ответ API", await codeBlock(page, "SVG", apiSvg), apiSvg);
  // CSS: класс иконки с размером, цветом и толщиной в рисунке.
  await choose(page, "pill", "CSS");
  const css = await codeBlock(page, "CSS");
  no(
    css.includes(".lucide--house {") &&
      css.includes("width: 64px;") &&
      css.includes("background-color: #e11d48;") &&
      css.includes("stroke-width='1.5'"),
    `код CSS без класса, размера, цвета или толщины: «${css.slice(0, 160)}»`,
  );
  same(
    "HTML к CSS",
    await codeBlock(page, "HTML", '<span class="lucide--house"></span>'),
    '<span class="lucide--house"></span>',
  );
  // CSS · URL: адрес SVG edge API с настройками — и он отвечает.
  await choose(page, "tab", "URL");
  same("ссылка", await codeBlock(page, "SVG URL", link), link);
  if (clipboard) {
    await page
      .locator(CODE_ROOT)
      .first()
      .locator("figure.code-block", { hasText: "SVG URL" })
      .locator("button")
      .last()
      .click();
    await page.waitForTimeout(300);
    same("скопированная ссылка", await clipText(page), link);
  }

  // Name: по умолчанию — набор/иконка, формат — из списка, как у Iconify (решения владельца 3 ноября 2026).
  same(
    "имя по умолчанию",
    await nameShown(page, "lucide/house"),
    "lucide/house",
  );
  await page.locator("button.panel-name").click();
  await page
    .getByRole("menuitemradio")
    .filter({ has: page.locator("code", { hasText: /^lucide:house$/ }) })
    .click();
  same("имя в формате Iconavo", await nameShown(page, CODE_ICON), CODE_ICON);
  if (clipboard) {
    await page
      .locator(".panel-name-row button")
      .filter({ hasNot: page.locator(".panel-control-text") })
      .last()
      .click();
    await page.waitForTimeout(300);
    same("скопированное имя", await clipText(page), CODE_ICON);
  }

  // Выбор после перезагрузки: вид — CSS · URL, менеджер пакетов — yarn, формат имени — lucide:house.
  await openWithSettings(page, o.base);
  same(
    "вид кода после перезагрузки",
    await codeBlock(page, "SVG URL", link),
    link,
  );
  await choose(page, "pill", "HTML");
  await choose(page, "tab", "Package");
  same(
    "менеджер пакетов после перезагрузки",
    await codeBlock(page, "Install", "yarn add @iconavo-ui/icon"),
    "yarn add @iconavo-ui/icon",
  );
  same(
    "формат имени после перезагрузки",
    await nameShown(page, CODE_ICON),
    CODE_ICON,
  );

  // Цветной набор — без цвета и толщины; заливка — без толщины.
  for (const { path, tag } of [CODE_PALETTE, CODE_FILLED]) {
    await openWithSettings(page, o.base, path);
    await choose(page, "pill", "HTML");
    const usage = `${readmeImport(readme)}\n\n${tag}`;
    same(`код тега ${path}`, await codeBlock(page, "Usage", usage), usage);
  }

  // Панель: тот же генератор; настройки новой страницы — по умолчанию, размер 24 px (решение владельца 3
  // ноября 2026).
  await page.goto(`${o.base}/${CATALOG_SET}?icon=${CODE_ICON}`);
  await hydrated(page);
  await choose(page, "pill", "HTML");
  const plain = `${readmeImport(readme)}\n\n<iconavo-icon icon="${CODE_ICON}" width="24"></iconavo-icon>`;
  same("код тега в панели", await codeBlock(page, "Usage", plain), plain);
  // SVG в панели — побайтно ответ edge API с размером 24 px. Страница иконки получает рисунок в серверном
  // HTML, а панели его грузит браузер пачкой edge API (иконки нет на первой странице сетки): подменённую
  // пачку видит только эта сверка — контрольный запуск.
  const panelSvg = await (
    await fetch(`${o.api}${iconPath(CODE_ICON)}.svg?width=24`)
  ).text();
  await choose(page, "pill", "SVG");
  for (const option of await page
    .locator(CODE_ROOT)
    .first()
    .locator(".panel-option")
    .all()) {
    if (await option.locator("input").isChecked()) await option.click();
  }
  same(
    "код SVG в панели — ответ API",
    await codeBlock(page, "SVG", panelSvg),
    panelSvg,
  );
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
        `HTML и «Script» из README, React, SVG (как у edge API), CSS и ссылка с настройками; npm, pnpm и yarn; Name с форматами; выбор после перезагрузки; цветной набор и заливка; панель; код тега рисует иконку${name === "chrome" ? "; копирование" : ""}`,
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

/**
 * Скачивание и копирование одной иконки (редизайн): «Download ▾» — файл SVG с комментарием об авторе и
 * лицензии и PNG 1× и 4× размера из настроек; «Copy SVG ▾» (Chrome) — SVG как ответ edge API и картинка
 * PNG в буфере; метки аналитики.
 */
export async function filesProblems(
  page: Page,
  o: CodeCheckOptions,
  clipboard: boolean,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const apiSvg = await (
    await fetch(`${o.api}${iconPath(CODE_ICON)}.svg?${CODE_EXPECT.query}`)
  ).text();
  await page.goto(`${o.base}${iconPath(CODE_ICON)}?${CODE_SETTINGS}`);
  await hydrated(page);
  // Пункт меню «Download ▾»: Radix ставит пункты после открытия.
  const fromMenu = (item: RegExp) => async () => {
    await page.locator("button.ip-download").click();
    await page.getByRole("menuitem", { name: item }).click();
  };

  const svg = await downloaded(page, fromMenu(/^SVG file/));
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

  for (const scale of PNG_CHECK_SCALES) {
    const px = CODE_SIZE * scale;
    const png = await downloaded(
      page,
      fromMenu(new RegExp(`^PNG ${scale}× · ${px} px`)),
    );
    if (png === undefined) {
      problems.push(`PNG ${scale}× не скачался`);
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

  // Буфер — только Chrome. «Copy SVG» — SVG с настройками, как ответ edge API (в Figma — вектором); затем
  // «PNG image» — картинка размера из настроек.
  if (clipboard) {
    await page.locator("button.ip-split-main").click();
    await page.waitForTimeout(300);
    no(
      (await clipText(page)) === apiSvg,
      "«Copy SVG»: в буфере не SVG как у edge API",
    );
    await page.locator("button.ip-split-arrow").click();
    await page.getByRole("menuitem", { name: /^PNG image/ }).click();
    // Картинку рисует canvas, и в буфер она попадает не сразу: «Copied» на кнопке ещё может быть от
    // «Copy SVG» — ждём саму картинку в буфере.
    let copied: string | undefined;
    for (let t = 0; t < PANEL_WAIT_MS && copied === undefined; t += 250) {
      copied = await page
        .evaluate(async () => {
          const [item] = await navigator.clipboard.read();
          if (!item?.types.includes("image/png")) return undefined;
          const bytes = new Uint8Array(
            await (await item.getType("image/png")).arrayBuffer(),
          );
          let text = "";
          for (const byte of bytes) text += String.fromCharCode(byte);
          return btoa(text);
        })
        .catch(() => undefined);
      if (copied === undefined) await page.waitForTimeout(250);
    }
    let size = "";
    try {
      const f =
        typeof copied === "string"
          ? pngFacts(Buffer.from(copied, "base64"))
          : undefined;
      size = f === undefined ? "" : `${f.width}×${f.height}`;
      no(f !== undefined && f.painted > 0, "«PNG image»: в буфере пусто");
    } catch (e) {
      problems.push(`«PNG image»: ${(e as Error).message}`);
    }
    no(
      size === `${CODE_SIZE}×${CODE_SIZE}`,
      `«PNG image»: в буфере ${size || "нет картинки"}`,
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
  if (clipboard) {
    no(
      events.some((e) => e.name === "copy" && e.icon === CODE_ICON),
      "нет метки аналитики copy у «Copy SVG»",
    );
  }
  return problems;
}

/** Строка «Скачивание»: сценарий, CSP и консоль. */
export async function checkFiles(
  browser: Browser,
  name: BrowserName,
  o: CodeCheckOptions,
  shots: { title: string; png: string }[],
): Promise<Verdict> {
  const context = await browser.newContext({
    viewport: DESKTOP,
    acceptDownloads: true,
  });
  if (name === "chrome") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: o.base,
    });
  }
  await recordTrack(context);
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems = await filesProblems(page, o, name === "chrome");
  shots.push({ title: "Скачивание", png: await shot(page, seen) });
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();
  return problems.length === 0
    ? pass(
        `«Download ▾»: SVG с комментарием об авторе и лицензии — рисунок как у edge API; PNG 1× и 4× нужного размера и цвета${name === "chrome" ? "; «Copy SVG» как у edge API и картинка PNG в буфере" : ""}; метки аналитики`,
      )
    : fail(problems.slice(0, 4).join("; "));
}
