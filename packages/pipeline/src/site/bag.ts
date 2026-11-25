// Сценарий выделения и рюкзака проверки сайта (шаг 5 фазы 4, ADR-0042; редизайн — решения владельца 13
// ноября 2026): чекбоксы карточек и «Download N icons», «в рюкзак» на карточке, в панели иконки и в выдаче
// поиска, число на «Bag» и рюкзак после перезагрузки, рюкзак с клавиатуры, «Clear» и «Undo», «Remove», axe с
// открытым рюкзаком в обеих темах и телефон; ZIP — файлы, контрольные суммы, полные тексты лицензий как у
// /collection?info=true и README с указанием авторства; спрайт — символы, ID, комментарий и каждая <use>
// рисует иконку. ZIP читается своим разбором с CRC из node:zlib — независимо от записи на сайте
// (apps/site/lib/zip.ts).

import { readFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import type { Browser, Page } from "playwright";
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

/** Число на кнопке «Bag» верхней полосы. */
const badge = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector(".topbar .bag-button .bag-count")?.textContent ??
      "0",
  );

async function badgeIs(page: Page, count: number): Promise<string> {
  await page
    .waitForFunction(
      (n) =>
        (document.querySelector(".topbar .bag-button .bag-count")
          ?.textContent ?? "0") === String(n),
      count,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  return badge(page);
}

/** Файл скачивания по щелчку. */
async function downloaded(page: Page, click: () => Promise<void>) {
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: PANEL_WAIT_MS * 2 }),
      click(),
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

/** Карточка сетки по номеру: ячейка (кнопки карточки — её дети), имя иконки. */
async function card(page: Page, cells: string, n: number) {
  const cell = page.locator(cells).nth(n);
  const name =
    (await cell.locator("a.icon-card-link").getAttribute("data-icon")) ?? "";
  await cell.hover();
  return { cell, name };
}

/** Тексты лицензий наборов — как у /collection?info=true превью API. */
async function licensesOf(api: string, sets: string[]) {
  const licenses: Record<string, string> = {};
  for (const set of sets) {
    const info = (await (
      await fetch(`${api}/collection?prefix=${set}&info=true`)
    ).json()) as { info: { license: { text: string } } };
    licenses[set] = info.info.license.text;
  }
  return licenses;
}

/**
 * Выделение и рюкзак (редизайн, решения владельца 13 ноября 2026): чекбоксы карточек — полоса выделения
 * и «Download N icons» (ZIP исходных SVG с лицензиями и README), «Cancel Selection», панель при этом не
 * открывается; «в рюкзак» на карточке и в панели иконки, число на «Bag» и после перезагрузки; рюкзак с
 * клавиатуры, «Remove», «Clear» и «Undo», общий цвет, ZIP и спрайт, Esc и фокус; карточки поиска; метки.
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
  const cells = ".icon-grid > li.icon-cell";

  // Выделение: два чекбокса — полоса с числом; панель не открылась.
  await page.goto(`${o.base}/${CATALOG_SET}`);
  await hydrated(page);
  await page
    .locator(cells)
    .first()
    .waitFor({ timeout: PANEL_WAIT_MS })
    .catch(() => {});
  const picked: string[] = [];
  for (const n of [0, 1]) {
    const { cell, name } = await card(page, cells, n);
    await cell.locator("input.card-check-input").check();
    picked.push(name);
  }
  const status = page.locator(".select-bar .select-count");
  await status.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  no(
    ((await status.textContent().catch(() => "")) ?? "").startsWith("2/100"),
    `полоса выделения: «${await status.textContent().catch(() => "нет")}»`,
  );
  no(
    (await page.locator("aside.icon-panel").count()) === 0,
    "выбор чекбоксом открыл панель",
  );
  // «Download N icons» — ZIP исходных SVG с лицензиями и README (решение владельца 13 ноября 2026).
  const lucideLicense = await licensesOf(o.api, [CATALOG_SET]);
  const selected = await downloaded(page, () =>
    page.locator(".select-bar .select-actions button").first().click(),
  );
  if (selected === undefined) {
    problems.push("ZIP выделенных не скачался");
  } else {
    no(selected.name === "iconavo-icons.zip", `имя ZIP — ${selected.name}`);
    try {
      problems.push(
        ...zipProblems(readZip(selected.body), {
          icons: picked,
          licenses: lucideLicense,
        }).map((p) => `выделенные: ${p}`),
      );
    } catch (e) {
      problems.push(`ZIP выделенных не читается: ${(e as Error).message}`);
    }
  }
  await page.locator(".select-bar .select-cancel").click();
  await page
    .locator(".select-bar")
    .waitFor({ state: "detached", timeout: PANEL_WAIT_MS })
    .catch(() => {});
  no(
    (await page.locator(".select-bar").count()) === 0,
    "«Cancel Selection» не сняла выделение",
  );

  // «В рюкзак» на карточке и в панели иконки.
  const third = await card(page, cells, 2);
  await third.cell.locator("button.card-bag").click();
  no(
    (await badgeIs(page, 1)) === "1",
    "«в рюкзак» на карточке не положила иконку",
  );
  no(
    (await third.cell
      .locator("button.card-bag")
      .getAttribute("aria-pressed")) === "true",
    "кнопка рюкзака на карточке не отмечена",
  );
  const fourth = await card(page, cells, 3);
  await fourth.cell.locator("a.icon-card-link").click();
  const add = page.locator("aside.icon-panel button.panel-bag");
  await add.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  await add.click().catch(() => {});
  no((await badgeIs(page, 2)) === "2", "«В сумку» в панели не положила иконку");
  no(
    (await add.getAttribute("aria-pressed").catch(() => null)) === "true",
    "«В сумку» в панели не отмечена",
  );
  await page.goto(`${o.base}/ph?icon=ph:house-bold`);
  await hydrated(page);
  const addPh = page.locator("aside.icon-panel button.panel-bag");
  await addPh.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  await addPh.click().catch(() => {});
  no(
    (await badgeIs(page, 3)) === "3",
    "«В сумку» в панели /ph не положила иконку",
  );

  // Перезагрузка: рюкзак на месте.
  await page.reload();
  await hydrated(page);
  const kept = (await badgeIs(page, 3)) === "3";
  no(kept, `после перезагрузки на «Bag» ${await badge(page)}, а ждали 3`);
  // Рюкзак пропал — дальше сценарию не с чем работать: щелчок по «Clear» пустого рюкзака ждал бы 30 с
  // и останавливал строку вместо понятного «нет».
  if (!kept) return problems;

  // Рюкзак с клавиатуры: Enter на «Bag», фокус в панели, список по порядку.
  const button = page.locator(".topbar .bag-button");
  await button.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("dialog#bag-panel[open]");
  await panel.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  no(
    await page.evaluate(
      () =>
        document
          .querySelector("dialog#bag-panel")
          ?.contains(document.activeElement) === true,
    ),
    "фокус не в рюкзаке",
  );
  const listed = () =>
    panel
      .locator("li.bag-item[data-icon]")
      .evaluateAll((items) =>
        items.map((i) => i.getAttribute("data-icon") ?? ""),
      );
  const bag = [third.name, fourth.name, "ph:house-bold"];
  no(
    (await listed()).join(" ") === bag.join(" "),
    `в рюкзаке ${(await listed()).join(", ")}`,
  );

  // «Clear» — сразу пусто и «Undo»; «Undo» возвращает всё.
  await panel.locator("button.bag-clear").click();
  await badgeIs(page, 0);
  await panel
    .locator("button.bag-undo")
    .waitFor({ timeout: PANEL_WAIT_MS })
    .catch(() => {});
  await panel
    .locator("button.bag-undo")
    .click()
    .catch(() => {});
  no((await badgeIs(page, 3)) === "3", "«Undo» не вернул рюкзак после «Clear»");

  // «Remove» у первой — две иконки.
  await panel
    .getByRole("button", { name: `Remove ${third.name}`, exact: true })
    .click();
  await badgeIs(page, 2);
  const left = [fourth.name, "ph:house-bold"];

  // Общий цвет (поле Color рюкзака) — по одной букве, как набирает человек: неполный код поле не стирает
  // (ревизия фазы 5, С-4; раньше работала только вставка целиком, а fill её и делал).
  const hex = panel.locator("input.color-hex");
  await hex.click();
  await hex.pressSequentially(BAG_COLOR.slice(1).toUpperCase());
  // Список — как в файлах: иконка в нём берёт общий цвет рюкзака (правка владельца 25 ноября 2026).
  const listed4 = panel.locator(`li.bag-item[data-icon="${fourth.name}"] svg`);
  no(
    (await listed4
      .first()
      .getAttribute("color")
      .catch(() => null)) === BAG_COLOR,
    `иконка ${fourth.name} в списке рюкзака не перекрасилась в общий цвет`,
  );

  // ZIP: файлы, суммы, тексты лицензий и README; общий цвет — в SVG.
  const zip = await downloaded(page, () =>
    panel.locator("button.bag-download", { hasText: "Download ZIP" }).click(),
  );
  if (zip === undefined) {
    problems.push("ZIP рюкзака не скачался");
  } else {
    no(zip.name === "iconavo-icons.zip", `имя ZIP — ${zip.name}`);
    try {
      const files = readZip(zip.body);
      problems.push(
        ...zipProblems(files, {
          icons: left,
          licenses: await licensesOf(o.api, [CATALOG_SET, "ph"]),
        }),
      );
      const colored = files
        .find((f) => f.path === `${fourth.name.replace(":", "/")}.svg`)
        ?.data.toString("utf8");
      no(
        colored?.includes(BAG_COLOR) === true,
        "общий цвет рюкзака не дошёл до SVG в ZIP",
      );
    } catch (e) {
      problems.push(`ZIP рюкзака не читается: ${(e as Error).message}`);
    }
  }

  // Спрайт: комментарий, символы, ID и каждая <use> рисует иконку.
  const sprite = await downloaded(page, () =>
    panel
      .locator("button.bag-download", { hasText: "Download SVG Sprite" })
      .click(),
  );
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
    const ids = left.map((n) => n.replace(":", "-"));
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

  // Esc закрывает рюкзак, фокус — на «Bag».
  await page.keyboard.press("Escape");
  await page
    .locator("dialog#bag-panel[open]")
    .waitFor({ state: "detached", timeout: PANEL_WAIT_MS })
    .catch(() => {});
  no(
    (await page.locator("dialog#bag-panel[open]").count()) === 0,
    "Esc не закрыл рюкзак",
  );
  no(
    await page.evaluate(
      () =>
        document.activeElement
          ?.closest(".topbar")
          ?.querySelector(".bag-button") === document.activeElement,
    ),
    "после Esc фокус не на «Bag»",
  );

  // Выдача поиска: те же кнопки карточек.
  await page.goto(`${o.base}/search?q=${SEARCH_QUERY}`);
  await hydrated(page);
  const results = ".result-grid li.result-cell";
  // Ждём настоящую карточку: скелетоны выдачи — тоже li.result-cell, но без ссылки.
  await page
    .locator(`${results} a.icon-card-link`)
    .first()
    .waitFor({ timeout: PANEL_WAIT_MS })
    .catch(() => {});
  const names = await page
    .locator(`${results} a.icon-card-link`)
    .evaluateAll((cards) =>
      cards.map((c) => c.getAttribute("data-icon") ?? ""),
    );
  // Иконка не из рюкзака: щелчок по той, что уже в нём, вынул бы её, а не положил.
  const fresh = names.findIndex((n) => !left.includes(n));
  if (fresh === -1) {
    problems.push(
      names.length === 0
        ? "выдача поиска не пришла"
        : "в выдаче поиска нет иконки не из рюкзака",
    );
    return problems;
  }
  const result = await card(page, results, fresh);
  await result.cell
    .locator("button.card-bag")
    .click()
    .catch(() => {});
  no(
    (await badgeIs(page, 3)) === "3",
    "в поиске «в рюкзак» на карточке не положила иконку",
  );
  return problems;
}

/** Имена набора из /collection превью API — для полного рюкзака из настоящих иконок. */
async function setNames(api: string, prefix: string): Promise<string[]> {
  const c = (await (
    await fetch(`${api}/collection?prefix=${prefix}`)
  ).json()) as {
    categories?: Record<string, string[]>;
    uncategorized?: string[];
  };
  const names = [
    ...Object.values(c.categories ?? {}).flat(),
    ...(c.uncategorized ?? []),
  ];
  return [...new Set(names)].map((name) => `${prefix}:${name}`);
}

/**
 * Края рюкзака (ревизия фазы 5): иконка, которой нет, не попадает в ZIP, и рюкзак её называет (С-11);
 * полный рюкзак — «в рюкзак» на карточке, в панели и на странице иконки так и говорит (С-14).
 */
export async function bagEdgeProblems(
  page: Page,
  o: BagCheckOptions,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const setBag = (names: string[]) =>
    page.evaluate(
      ([key, list]) => localStorage.setItem(key, JSON.stringify(list)),
      [BAG_KEY, names] as const,
    );
  // Перед перезагрузкой и переходом — пока у страницы нет запросов в пути: иначе оборвалась бы загрузка
  // иконок рюкзака, и WebKit записал бы отмену ошибкой страницы.
  let inFlight = 0;
  const finished = () => {
    inFlight = Math.max(0, inFlight - 1);
  };
  page.on("request", () => {
    inFlight += 1;
  });
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  const idle = async () => {
    // Иконки, которые ещё грузятся (заглушка React — iconavo-loading), — и те, что начались до счёта.
    await page
      .waitForFunction(
        () => document.querySelector(".iconavo-loading") === null,
        null,
        { timeout: PANEL_WAIT_MS },
      )
      .catch(() => {});
    let calm = 0;
    for (let t = 0; t < PANEL_WAIT_MS && calm < 300; t += 100) {
      calm = inFlight === 0 ? calm + 100 : 0;
      await page.waitForTimeout(100);
    }
  };

  // Иконка, которой нет: ZIP — только с загруженной, сообщение называет пропавшую. Загруженная — с
  // длинным именем: оно обрезается многоточием, список не прокручивается вбок (правка владельца
  // 25 ноября 2026).
  await idle();
  await page.goto(`${o.base}/${CATALOG_SET}`);
  await hydrated(page);
  const lost = `${CATALOG_SET}:no-such-icon`;
  const long = "align-horizontal-distribute-center";
  await idle();
  await setBag([`${CATALOG_SET}:${long}`, lost]);
  await page.reload();
  await hydrated(page);
  await badgeIs(page, 2);
  await page.locator(".topbar .bag-button").click();
  const panel = page.locator("dialog#bag-panel[open]");
  await panel.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  const fit = await page.evaluate(() => {
    const list = document.querySelector("dialog#bag-panel .bag-panel-list");
    const name = document.querySelector("dialog#bag-panel .bag-item-name");
    return {
      wide: list === null || list.scrollWidth > list.clientWidth,
      cut: name !== null && name.scrollWidth > name.clientWidth,
    };
  });
  no(
    !fit.wide && fit.cut,
    `длинное имя в рюкзаке: ${fit.wide ? "список прокручивается вбок" : "имя не обрезано многоточием"}`,
  );
  const zip = await downloaded(page, () =>
    panel.locator("button.bag-download", { hasText: "Download ZIP" }).click(),
  );
  if (zip === undefined) {
    problems.push("ZIP рюкзака с иконкой, которой нет, не скачался");
  } else {
    try {
      const svgs = readZip(zip.body)
        .map((f) => f.path)
        .filter((path) => path.endsWith(".svg"));
      no(
        svgs.join(" ") === `${CATALOG_SET}/${long}.svg`,
        `в ZIP с иконкой, которой нет, — ${svgs.join(", ") || "ни одной иконки"}`,
      );
    } catch (e) {
      problems.push(
        `ZIP с иконкой, которой нет, не читается: ${(e as Error).message}`,
      );
    }
  }
  const note = panel.locator(".bag-missing");
  await note.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  no(
    ((await note.textContent().catch(() => "")) ?? "").includes(lost),
    "рюкзак не назвал иконку, которая не вошла в ZIP",
  );
  await page.keyboard.press("Escape");

  // Полный рюкзак (500 иконок Phosphor): на карточке Lucide, в её панели и на странице иконки кнопка
  // говорит, что рюкзак полон, и ничего не кладёт.
  const full = (await setNames(o.api, "ph")).slice(0, 500);
  if (full.length < 500) {
    problems.push(`для полного рюкзака мало имён ph: ${full.length}`);
    return problems;
  }
  await idle();
  await setBag(full);
  await page.reload();
  await hydrated(page);
  await badgeIs(page, 500);
  const fullText = "Backpack is full: 500 icons";
  const cells = ".icon-grid > li.icon-cell";
  await page
    .locator(cells)
    .first()
    .waitFor({ timeout: PANEL_WAIT_MS })
    .catch(() => {});
  const first = await card(page, cells, 0);
  const cardBag = first.cell.locator("button.card-bag");
  no(
    (await cardBag.getAttribute("aria-label")) === fullText &&
      (await cardBag.getAttribute("aria-disabled")) === "true",
    `полный рюкзак: кнопка карточки — «${await cardBag.getAttribute("aria-label")}»`,
  );
  // У кнопки aria-disabled — Playwright ждал бы, пока она «включится»; щелчок — без этой проверки.
  await cardBag.click({ force: true });
  no(
    (await badge(page)) === "500",
    "полный рюкзак: щелчок по кнопке карточки что-то изменил",
  );
  await first.cell.locator("a.icon-card-link").click();
  const add = page.locator("aside.icon-panel button.panel-bag");
  await add.waitFor({ timeout: PANEL_WAIT_MS }).catch(() => {});
  no(
    (await add.getAttribute("aria-label").catch(() => null)) === fullText,
    `полный рюкзак: кнопка панели — «${await add.getAttribute("aria-label").catch(() => "нет")}»`,
  );
  await idle();
  await page.goto(`${o.base}/${CATALOG_SET}/house`);
  await hydrated(page);
  const pageBag = page.locator("button.ip-bag");
  // Рюкзак страница читает после гидратации — надпись ждём, а не читаем один раз (WebKit медленнее).
  await page
    .waitForFunction(
      () =>
        document
          .querySelector("button.ip-bag")
          ?.textContent?.includes("Backpack is full") === true,
      null,
      { timeout: PANEL_WAIT_MS },
    )
    .catch(() => {});
  no(
    ((await pageBag.textContent().catch(() => "")) ?? "").includes(
      "Backpack is full",
    ),
    `полный рюкзак: кнопка страницы иконки — «${await pageBag.textContent().catch(() => "нет")}»`,
  );
  await idle();
  await setBag([]);
  return problems;
}

/** Строка «Рюкзак»: сценарий, CSP и консоль, axe с открытым рюкзаком в обеих темах, телефон. */
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
  // Сбой краёв — своей строкой, а не остановкой шага: иначе контекст с полным рюкзаком остался бы
  // открытым до конца прогона.
  problems.push(
    ...(await bagEdgeProblems(page, o).catch((e: Error) => [
      `края рюкзака остановились: ${e.message.split("\n")[0]}`,
    ])),
  );
  problems.push(
    ...(await allViolations(page)).map((x) => `CSP: ${x}`),
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
    await p.locator(".topbar .bag-button").click();
    await p
      .locator("dialog#bag-panel li.bag-item[data-icon]")
      .nth(1)
      .waitFor({ timeout: PANEL_WAIT_MS })
      .catch(() => {});
    if (viewport === PHONE) {
      const wide = await p.evaluate(() => {
        const box = document
          .querySelector("dialog#bag-panel")
          ?.getBoundingClientRect();
        return (
          document.documentElement.scrollWidth > innerWidth ||
          box === undefined ||
          box.right > innerWidth ||
          box.left < 0
        );
      });
      if (wide) problems.push("на телефоне рюкзак шире экрана");
      shots.push({ title: "Рюкзак на телефоне", png: await shot(p, pageSeen) });
    } else {
      await runAxe(
        p,
        await axe(),
        `/${CATALOG_SET}, рюкзак, ${scheme}`,
        axePages,
      );
      if (scheme === "light") {
        shots.push({ title: "Рюкзак", png: await shot(p, pageSeen) });
      }
    }
    problems.push(...(await allViolations(p)).map((x) => `CSP: ${x}`));
    await themed.close();
  }
  const access = axeVerdict(axePages);
  if (access.ok === false) problems.push(`axe: ${access.note}`);
  return problems.length === 0
    ? pass(
        "выделение — «Download N icons» (ZIP с лицензиями) и «Cancel Selection»; «в рюкзак» на карточке, в панели и в поиске, число на «Bag» после перезагрузки; рюкзак с клавиатуры, «Clear» и «Undo», «Remove», общий цвет; ZIP с текстами лицензий и README, спрайт рисует; Esc; axe в обеих темах, телефон",
      )
    : fail(problems.slice(0, 4).join("; "));
}
