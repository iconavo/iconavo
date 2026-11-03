// Сценарий сумки проверки сайта (шаг 5 фазы 4, ADR-0042; решения владельца 3 ноября 2026): режим «Выбрать
// несколько» в сетке набора и в выдаче поиска, «В сумку» в панели, число в шапке и сумка после
// перезагрузки, меню с клавиатуры, «Убрать», axe с открытым меню в обеих темах и телефон; ZIP — файлы,
// контрольные суммы, полные тексты лицензий как у /collection?info=true и README с указанием авторства;
// спрайт — символы, ID, комментарий и каждая <use> рисует иконку. ZIP читается своим разбором с CRC из
// node:zlib — независимо от записи на сайте (apps/site/lib/zip.ts).

import { readFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
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
import { recordTrack } from "./code.js";
import {
  CATALOG_SET,
  DESKTOP,
  PANEL_WAIT_MS,
  PHONE,
  SEARCH_QUERY,
} from "./config.js";
import { hydrated } from "./panel.js";

export interface BagCheckOptions {
  base: string;
  /** Превью edge API: полные тексты лицензий /collection?info=true. */
  api: string;
}

/** Ключ сумки в localStorage сайта (apps/site/lib/bag.ts). */
export const BAG_KEY = "iconavo-bag";
/** Свой цвет по умолчанию у поля цвета (COLOR_START сайта). */
const BAG_COLOR = "#2563eb";

export interface ZipEntry {
  path: string;
  data: Buffer;
}

/** Файлы ZIP по центральному каталогу; сжатие или неверная контрольная сумма — ошибка. */
export function readZip(body: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(body);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("нет конца центрального каталога");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) {
      throw new Error("битый центральный каталог");
    }
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const path = buf.toString("utf8", at + 46, at + 46 + nameLength);
    if (method !== 0) throw new Error(`${path}: сжатие ${method}`);
    if (buf.readUInt32LE(local) !== 0x04034b50) {
      throw new Error(`${path}: нет локального заголовка`);
    }
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`${path}: CRC не сходится`);
    files.push({ path, data });
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

/** Что не так в ZIP сумки: иконки, полные тексты лицензий, README с указанием авторства. */
export function zipProblems(
  files: ZipEntry[],
  expect: { icons: string[]; licenses: Record<string, string> },
): string[] {
  const text = new Map(files.map((f) => [f.path, f.data.toString("utf8")]));
  const problems: string[] = [];
  for (const name of expect.icons) {
    const path = `${name.replace(":", "/")}.svg`;
    if (!text.get(path)?.startsWith("<svg "))
      problems.push(`в ZIP нет ${path}`);
  }
  for (const [set, license] of Object.entries(expect.licenses)) {
    if (!text.get(`LICENSES/${set}.txt`)?.startsWith(license.trimEnd())) {
      problems.push(`в ZIP нет полного текста лицензии ${set}`);
    }
  }
  const readme = text.get("README.txt") ?? "";
  for (const set of Object.keys(expect.licenses)) {
    if (!readme.includes(`License text: LICENSES/${set}.txt`)) {
      problems.push(`в README.txt нет набора ${set}`);
    }
  }
  if (!readme.includes("Icons: ")) {
    problems.push("в README.txt нет указания авторства");
  }
  return problems;
}

/** Число в шапке: значок кнопки сумки. */
const badge = (page: Page) =>
  page.evaluate(
    () => document.querySelector(".bag-button .bag-count")?.textContent ?? "0",
  );

async function badgeIs(page: Page, count: number): Promise<string> {
  await page
    .waitForFunction(
      (n) =>
        (document.querySelector(".bag-button .bag-count")?.textContent ??
          "0") === String(n),
      count,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  return badge(page);
}

/** Файл скачивания из меню сумки. */
async function downloaded(page: Page, button: string) {
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: PANEL_WAIT_MS * 2 }),
      page
        .locator(".bag-menu")
        .getByRole("button", { name: button, exact: true })
        .click(),
    ]);
    return {
      name: download.suggestedFilename(),
      body: await readFile(await download.path()),
    };
  } catch {
    return undefined;
  }
}

const tracked = (page: Page): Promise<{ name: string; format?: string }[]> =>
  page.evaluate(
    () =>
      (window as unknown as { tracked?: { name: string; format?: string }[] })
        .tracked ?? [],
  );

/** Каждая <use> спрайта рисует иконку: страница без сети, спрайт — прямо в ней. */
async function spriteDrawn(
  browser: Browser,
  sprite: string,
  ids: string[],
): Promise<boolean> {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html><body>${sprite}${ids.map((id) => `<svg width="48" height="48"><use href="#${id}"/></svg>`).join("")}</body></html>`,
  );
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll("use")].map((use) => {
      const box = use.getBBox();
      return box.width * box.height;
    }),
  );
  await context.close();
  return sizes.length === ids.length && sizes.every((s) => s > 0);
}

/**
 * Сумка: режим выбора на странице набора и в поиске, «В сумку» в панели, число в шапке и перезагрузка,
 * меню с клавиатуры, «Убрать», общий цвет, ZIP и спрайт, Esc и фокус, метки аналитики.
 */
export async function bagProblems(
  page: Page,
  browser: Browser,
  o: BagCheckOptions,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };

  // Режим «Выбрать несколько»: щелчок кладёт и убирает, панель не открывается.
  await page.goto(`${o.base}/${CATALOG_SET}`);
  await hydrated(page);
  await page
    .getByRole("button", { name: "Select several", exact: true })
    .click();
  const picks = page.locator("button.icon-card-pick");
  await picks
    .first()
    .waitFor({ timeout: PANEL_WAIT_MS })
    .catch(() => {});
  const first = (await picks.nth(0).getAttribute("data-icon")) ?? "";
  const second = (await picks.nth(1).getAttribute("data-icon")) ?? "";
  await picks.nth(0).click();
  await picks.nth(1).click();
  no(
    (await badgeIs(page, 2)) === "2",
    `после двух щелчков в шапке ${await badge(page)}`,
  );
  no(
    (await page.locator("aside.icon-panel").count()) === 0,
    "в режиме выбора щелчок открыл панель",
  );
  no(
    (await picks.nth(0).getAttribute("aria-pressed")) === "true",
    "выбранная карточка не отмечена",
  );
  await picks.nth(0).click();
  no((await badgeIs(page, 1)) === "1", "повторный щелчок не убрал иконку");
  await picks.nth(0).click();
  await badgeIs(page, 2);

  // «В сумку» в панели — после выключения режима карточки снова открывают панель.
  await page
    .getByRole("button", { name: "Select several", exact: true })
    .click();
  const link = page.locator("a.icon-card-link").nth(2);
  const third = (await link.getAttribute("data-icon")) ?? "";
  await link.click();
  const add = page
    .locator("aside.icon-panel")
    .getByRole("button", { name: "Add to bag", exact: true });
  await add.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  await add.click().catch(() => {});
  no((await badgeIs(page, 3)) === "3", "«В сумку» в панели не положила иконку");
  no(
    (await add.getAttribute("aria-pressed").catch(() => null)) === "true",
    "«В сумку» не отмечена",
  );
  await page.goto(`${o.base}/ph?icon=ph:house-bold`);
  await hydrated(page);
  const addPh = page
    .locator("aside.icon-panel")
    .getByRole("button", { name: "Add to bag", exact: true });
  await addPh.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  await addPh.click().catch(() => {});
  await badgeIs(page, 4);

  // Перезагрузка: сумка на месте.
  await page.reload();
  await hydrated(page);
  no(
    (await badgeIs(page, 4)) === "4",
    `после перезагрузки в шапке ${await badge(page)}, а ждали 4`,
  );

  // Меню с клавиатуры: Enter на кнопке, фокус внутри, «Убрать».
  const button = page.locator(".bag-button");
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.locator(".bag-menu");
  await menu.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  no(
    await page.evaluate(
      () =>
        document
          .querySelector(".bag-menu")
          ?.contains(document.activeElement) === true,
    ),
    "фокус не в меню сумки",
  );
  const listed = await menu
    .locator("li[data-icon]")
    .evaluateAll((items) =>
      items.map((i) => i.getAttribute("data-icon") ?? ""),
    );
  no(
    // Первую убрали и положили снова — она в конце.
    listed.join(" ") === [second, first, third, "ph:house-bold"].join(" "),
    `в меню ${listed.join(", ")}`,
  );
  await menu
    .getByRole("button", { name: `Remove ${first}`, exact: true })
    .click();
  await badgeIs(page, 3);
  const bag = [second, third, "ph:house-bold"];

  // Общий цвет — когда меню узнало, что в сумке есть монохромные.
  const custom = menu.getByLabel("Custom color");
  await custom.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  await custom.check().catch(() => {});

  // ZIP: файлы, суммы, тексты лицензий и README.
  const zip = await downloaded(page, "Download ZIP");
  if (zip === undefined) {
    problems.push("ZIP не скачался");
  } else {
    no(zip.name === "iconavo-icons.zip", `имя ZIP — ${zip.name}`);
    try {
      const files = readZip(zip.body);
      const licenses: Record<string, string> = {};
      for (const set of [CATALOG_SET, "ph"]) {
        const info = (await (
          await fetch(`${o.api}/collection?prefix=${set}&info=true`)
        ).json()) as { info: { license: { text: string } } };
        licenses[set] = info.info.license.text;
      }
      problems.push(...zipProblems(files, { icons: bag, licenses }));
      const colored = files
        .find((f) => f.path === `${second.replace(":", "/")}.svg`)
        ?.data.toString("utf8");
      no(
        colored?.includes(BAG_COLOR) === true,
        "общий цвет сумки не дошёл до SVG в ZIP",
      );
    } catch (e) {
      problems.push(`ZIP не читается: ${(e as Error).message}`);
    }
  }

  // Спрайт: комментарий, символы, ID и каждая <use> рисует иконку.
  const sprite = await downloaded(page, "Download sprite");
  if (sprite === undefined) {
    problems.push("спрайт не скачался");
  } else {
    no(sprite.name === "iconavo-sprite.svg", `имя спрайта — ${sprite.name}`);
    const text = sprite.body.toString("utf8");
    const comment = /^<!--\n([\s\S]*?)\n-->/.exec(text)?.[1] ?? "";
    no(
      comment.includes("Icons: Lucide by") &&
        comment.includes("Icons: Phosphor by") &&
        !comment.includes("--"),
      "комментарий спрайта без авторов и лицензий или с «--»",
    );
    const symbols = [...text.matchAll(/<symbol id="([^"]+)"/g)].map(
      (m) => m[1] ?? "",
    );
    const ids = bag.map((n) => n.replace(":", "-"));
    no(
      symbols.join(" ") === ids.join(" "),
      `символы спрайта: ${symbols.join(", ")}`,
    );
    const all = [...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    no(new Set(all).size === all.length, "в спрайте повторяются ID");
    no(await spriteDrawn(browser, text, ids), "<use> спрайта не рисует иконку");
  }
  const events = await tracked(page);
  no(
    events.some((e) => e.name === "download" && e.format === "zip") &&
      events.some((e) => e.name === "download" && e.format === "sprite"),
    "нет меток аналитики download для ZIP и спрайта",
  );

  // Esc закрывает меню, фокус — на кнопке.
  await page.keyboard.press("Escape");
  await menu
    .waitFor({ state: "detached", timeout: PANEL_WAIT_MS })
    .catch(() => {});
  no((await menu.count()) === 0, "Esc не закрыл меню сумки");
  no(
    await page.evaluate(
      () => document.activeElement?.classList.contains("bag-button") === true,
    ),
    "после Esc фокус не на кнопке сумки",
  );

  // Выдача поиска: тот же режим.
  await page.goto(`${o.base}/search?q=${SEARCH_QUERY}`);
  await hydrated(page);
  await page
    .locator(".result-grid a.icon-card-link")
    .first()
    .waitFor({ timeout: PANEL_WAIT_MS })
    .catch(() => {});
  await page
    .getByRole("button", { name: "Select several", exact: true })
    .click();
  const results = page.locator(".result-grid button.icon-card-pick");
  await results
    .first()
    .waitFor({ timeout: PANEL_WAIT_MS })
    .catch(() => {});
  const names = await results.evaluateAll((cards) =>
    cards.map((c) => c.getAttribute("data-icon") ?? ""),
  );
  const fresh = names.findIndex((n) => !bag.includes(n));
  await results
    .nth(Math.max(fresh, 0))
    .click()
    .catch(() => {});
  no(
    (await badgeIs(page, 4)) === "4",
    "в поиске режим выбора не положил иконку",
  );
  return problems;
}

/** Строка «Сумка»: сценарий, CSP и консоль, axe с открытым меню в обеих темах, телефон. */
export async function checkBag(
  browser: Browser,
  o: BagCheckOptions,
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
  const problems = await bagProblems(page, browser, o);
  problems.push(
    ...(await violations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();

  // Меню с сумкой: axe в обеих темах, на телефоне — без прокрутки вбок.
  const axePages: { path: string; violations: AxeViolation[] }[] = [];
  for (const [viewport, scheme] of [
    [DESKTOP, "light"],
    [DESKTOP, "dark"],
    [PHONE, "light"],
  ] as const) {
    const themed = await browser.newContext({ viewport, colorScheme: scheme });
    await themed.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [BAG_KEY, JSON.stringify(["lucide:house", "ph:house-bold"])] as const,
    );
    const p = await themed.newPage();
    const pageSeen = watch(p);
    await recordViolations(p);
    await p.goto(`${o.base}/${CATALOG_SET}`);
    await hydrated(p);
    await p.locator(".bag-button").click();
    await p
      .locator(".bag-menu li[data-icon]")
      .nth(1)
      .waitFor({ timeout: PANEL_WAIT_MS })
      .catch(() => {});
    if (viewport === PHONE) {
      const wide = await p.evaluate(() => {
        const box = document
          .querySelector(".bag-menu")
          ?.getBoundingClientRect();
        return (
          document.documentElement.scrollWidth > innerWidth ||
          box === undefined ||
          box.right > innerWidth ||
          box.left < 0
        );
      });
      if (wide) problems.push("на телефоне меню сумки шире экрана");
      shots.push({ title: "Сумка на телефоне", png: await shot(p, pageSeen) });
    } else {
      await runAxe(
        p,
        await axe(),
        `/${CATALOG_SET}, меню сумки, ${scheme}`,
        axePages,
      );
      if (scheme === "light") {
        shots.push({ title: "Меню сумки", png: await shot(p, pageSeen) });
      }
    }
    problems.push(...(await violations(p)).map((x) => `CSP: ${x}`));
    await themed.close();
  }
  const access = axeVerdict(axePages);
  if (access.ok === false) problems.push(`axe: ${access.note}`);
  return problems.length === 0
    ? pass(
        "режим выбора в сетке и поиске, «В сумку» в панели, число в шапке после перезагрузки; меню с клавиатуры, «Убрать», Esc; ZIP с текстами лицензий и README, спрайт рисует; axe в обеих темах, телефон",
      )
    : fail(problems.slice(0, 4).join("; "));
}
