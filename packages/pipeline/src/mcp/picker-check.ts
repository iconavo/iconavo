// Проверка сетки выбора в браузерах (шаг 11 фазы 4, ADR-0045, ADR-0035): страница-хост с AppBridge SDK —
// как у клиента MCP Apps — и вид в рамке sandbox="allow-scripts" со строгой политикой спецификации
// заголовком. Ожидания считает конвейер из тех же данных сетки теми же функциями общего модуля
// (pickerChoice, pickerContextText, pickerMessage), поэтому «что ушло ассистенту» сверяется побайтно.
// Каждый сценарий открывается отдельно (?only=…): рамки за краем экрана Chrome не рисует и не меряет.
// Контрольный запуск подкладывает пять поломок (picker-host.ts, CANARIES) — каждую обязана заметить
// своя строка.

import type { Format } from "@iconavo-ui/snippets/look";
import {
  cardHasStroke,
  PICKER_META_KEY,
  type PickerCard,
  type PickerPayload,
  parsePickerPayload,
  pickerChoice,
  pickerContextText,
  pickerMessage,
} from "@iconavo-ui/snippets/picker";
import type { Browser, Frame, Page } from "playwright";
import { type AxeViolation, axe, axeVerdict, runAxe } from "../sandbox/axe.js";
import {
  BROWSER_TITLES,
  type BrowserName,
  launchBrowser,
} from "../sandbox/browser.js";
import {
  fail,
  pass,
  recordViolations,
  shot,
  type Verdict,
  violations,
} from "../sandbox/verdict.js";
import type { PickerScenario } from "./picker-fixtures.js";
import { type Canary, startPickerHost } from "./picker-host.js";

export const PICKER_ROWS = [
  "render",
  "theme",
  "format",
  "color",
  "stroke",
  "select",
  "keyboard",
  "tell",
  "empty",
  "resize",
  "policy",
  "a11y",
  "canary",
] as const;
export type PickerRowId = (typeof PICKER_ROWS)[number];

export const PICKER_ROW_TITLES: Record<PickerRowId, string> = {
  render: "Карточки нарисованы",
  theme: "Тема чата, всё по-английски",
  format: "Формат кода, Soon неактивны",
  color: "Цвет — только монохромным",
  stroke: "Толщина линии — только линиям",
  select: "Select: контекст и просьба о коде",
  keyboard: "Клавиатура",
  tell: "Клиент без сообщений",
  empty: "Ничего не нашлось",
  resize: "Высота рамки",
  policy: "Политика рамки и ошибки",
  a11y: "Доступность (axe)",
  canary: "Контрольный запуск",
};

export interface PickerShot {
  title: string;
  png: string;
}

export interface PickerCheckResult {
  browser: BrowserName;
  rows: Record<PickerRowId, Verdict>;
  shots: PickerShot[];
  error?: string;
}

/** Цвет #e11d48 в вычисленном стиле. */
const PICK_COLOR = "rgb(225, 29, 72)";
/** Фон страницы сетки — токен bg-page светлой и тёмной темы. */
const PAGE_LIGHT = "rgb(255, 255, 255)";
const PAGE_DARK = "rgb(15, 19, 26)";

const bareOf = (name: string) => name.slice(name.indexOf(":") + 1);

interface Ctx {
  page: Page;
  base: string;
  scenarios: Map<string, PickerScenario>;
  /** Нарушения и ошибки рамки сетки по всем сценариям без поломок. */
  problems: string[];
  /** Ошибки консоли рамки сетки: запись — у страницы, адрес — /view.html. */
  console: string[];
}

function payloadOf(ctx: Ctx, id: string): PickerPayload {
  const payload = parsePickerPayload(
    ctx.scenarios.get(id)?.result._meta[PICKER_META_KEY],
  );
  if (payload === undefined) throw new Error(`нет данных сетки у ${id}`);
  return payload;
}

async function openScenario(
  ctx: Ctx,
  id: string,
  canary?: Canary,
): Promise<Frame> {
  const params = new URLSearchParams({
    delay: "0",
    only: id,
    ...(canary === undefined ? {} : { canary }),
  });
  ctx.console.length = 0;
  await ctx.page.goto(`${ctx.base}/?${params}`);
  await ctx.page.waitForSelector(`section[id="${id}"][data-ready]`, {
    timeout: 20_000,
  });
  // Рамка — по элементу этого сценария: в списке рамок страницы ещё может висеть рамка прошлой.
  const element = await ctx.page.$(`section[id="${id}"] iframe`);
  const frame = await element?.contentFrame();
  if (frame === null || frame === undefined) {
    throw new Error("нет рамки сетки");
  }
  await frame.waitForFunction(
    () => {
      const status = document.getElementById("picker")?.dataset.status;
      return status !== undefined && status !== "waiting";
    },
    null,
    { timeout: 10_000 },
  );
  // Высоту рамки клиент ставит по сообщению вида — после отрисовки.
  await ctx.page.waitForTimeout(250);
  return frame;
}

/** Нарушения политики и ошибки в рамке после сценария: копятся для строки «Политика». */
async function problemsOf(ctx: Ctx, frame: Frame, id: string): Promise<void> {
  const found = [
    ...(await violations(frame)),
    ...(await frame.evaluate(
      () => (window as unknown as { errors?: string[] }).errors ?? [],
    )),
    ...ctx.console,
  ];
  ctx.problems.push(...found.map((p) => `${id}: ${p}`));
}

async function cardsOf(frame: Frame) {
  return frame.$$eval(".card[data-n]", (buttons) =>
    buttons.map((b) => {
      const svg = b.querySelector("svg")?.getBoundingClientRect();
      const box = b.getBoundingClientRect();
      return {
        n: Number((b as HTMLElement).dataset.n),
        icon: (b as HTMLElement).dataset.icon ?? "",
        name: b.querySelector(".card-name")?.textContent ?? "",
        svg: svg === undefined ? 0 : svg.width * svg.height,
        disabled: b.getAttribute("aria-disabled") === "true",
        checked: b.getAttribute("aria-checked") === "true",
        left: box.left,
        top: box.top,
      };
    }),
  );
}

async function renderVerdict(frame: Frame, p: PickerPayload): Promise<Verdict> {
  const cards = await cardsOf(frame);
  if (cards.length !== p.cards.length || cards.length === 0) {
    return fail(`карточек ${cards.length} из ${p.cards.length}`);
  }
  const blank = cards.filter((c) => c.svg === 0).map((c) => c.n);
  if (blank.length > 0) return fail(`без рисунка: ${blank.join(", ")}`);
  const wrong = cards.filter(
    (c, i) => c.name !== bareOf((p.cards[i] as PickerCard).icon),
  );
  if (wrong.length > 0) {
    return fail(`не те имена: ${wrong.map((c) => c.name).join(", ")}`);
  }
  return pass(`${cards.length} карточек с рисунками, имена как в выдаче`);
}

/** Тема — как у чата, язык сетки — всегда английский (решение владельца 20 ноября 2026). */
async function themeVerdict(
  frame: Frame,
  theme: "light" | "dark",
): Promise<Verdict> {
  const seen = await frame.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    lang: document.documentElement.lang,
    background: getComputedStyle(document.body).backgroundColor,
    text: document.body.innerText,
  }));
  const background = theme === "dark" ? PAGE_DARK : PAGE_LIGHT;
  if (seen.theme !== theme) return fail(`тема ${seen.theme} вместо ${theme}`);
  if (seen.background !== background) {
    return fail(`фон ${seen.background} вместо ${background}: токены сайта?`);
  }
  if (seen.lang !== "en" || /[а-яё]/i.test(seen.text)) {
    return fail(`не по-английски: язык ${seen.lang}`);
  }
  return pass(`${theme}, фон токена bg-page, по-английски`);
}

/** Кнопки формата: как в панели сайта; выбранная — нажата, «Soon» — неактивны и выбор не меняют. */
async function formatVerdict(frame: Frame, p: PickerPayload): Promise<Verdict> {
  const pills = () =>
    frame.$$eval(".pill", (list) =>
      list.map((b) => ({
        label: b.textContent ?? "",
        pressed: b.getAttribute("aria-pressed") === "true",
        soon: b.getAttribute("aria-disabled") === "true",
      })),
    );
  const before = await pills();
  const labels = before.map((x) => x.label).join(",");
  if (labels !== "SVG,SVG+CSS,CSS,HTML,React,Vue,Svelte,Solid,Astro") {
    return fail(`кнопки ${labels}`);
  }
  const soon = before
    .filter((x) => x.soon)
    .map((x) => x.label)
    .join(",");
  if (soon !== "SVG+CSS,Vue,Svelte,Solid,Astro") return fail(`Soon: ${soon}`);
  const pressed = before.filter((x) => x.pressed).map((x) => x.label);
  const initial = { html: "HTML", react: "React", svg: "SVG", css: "CSS" }[
    p.format
  ];
  if (pressed.join() !== initial) {
    return fail(`нажата ${pressed.join()} вместо ${initial}`);
  }
  // Playwright сам не нажимает кнопку с aria-disabled — нажимаем силой: выбор формата не меняется.
  await frame.click('.pill[aria-disabled="true"] >> nth=1', { force: true });
  const still = (await pills()).filter((x) => x.pressed).map((x) => x.label);
  if (still.join() !== initial)
    return fail(`Soon поменяла выбор: ${still.join()}`);
  await frame.click('.pill[data-format="css"]');
  const after = (await pills()).filter((x) => x.pressed).map((x) => x.label);
  if (after.join() !== "CSS")
    return fail(`после щелчков нажата ${after.join()}`);
  return pass(
    `две группы, как в панели; Soon — ${soon.split(",").length}; сначала ${initial}`,
  );
}

async function colorVerdict(ctx: Ctx): Promise<Verdict> {
  const frame = await openScenario(ctx, "share-en-light");
  await frame.fill(".color-hex", "E11D48");
  await ctx.page.waitForTimeout(100);
  const colors = await frame.$$eval(".card .card-svg svg", (svgs) =>
    svgs.map((svg) => ({
      mono: (svg.closest(".card") as HTMLElement).classList.contains("mono"),
      color: getComputedStyle(svg).color,
    })),
  );
  await problemsOf(ctx, frame, "share-en-light");
  const mono = colors.filter((c) => c.mono);
  if (mono.length === 0) return fail("нет монохромных карточек");
  const off = mono.filter((c) => c.color !== PICK_COLOR);
  if (off.length > 0) return fail(`цвет не у ${off.length} карточек`);
  const emoji = await openScenario(ctx, "heart-emoji");
  const hidden = await emoji.evaluate(() => {
    const field = document
      .querySelector(".color-swatch")
      ?.closest(".picker-field");
    return (
      field !== null &&
      field !== undefined &&
      getComputedStyle(field).display === "none"
    );
  });
  await problemsOf(ctx, emoji, "heart-emoji");
  if (!hidden) return fail("у эмодзи есть поле цвета");
  return pass(`#E11D48 у ${mono.length} монохромных; у эмодзи поля цвета нет`);
}

/**
 * Толщина: ползунок меняет превью линейных иконок и только их; у эмодзи ползунка нет. Сверка — по
 * ожидаемым линейным карточкам, а не по тем, что нашлись на странице: ненарисованная — «нет»; у
 * остальных рисунок не меняется (ревизия фазы 5, И-22).
 */
async function strokeVerdict(ctx: Ctx, canary?: Canary): Promise<Verdict> {
  const id = "share-en-light";
  const p = payloadOf(ctx, id);
  const frame = await openScenario(ctx, id, canary);
  const read = () =>
    frame.$$eval(".card[data-n]", (list) =>
      list.map((b) => ({
        n: Number((b as HTMLElement).dataset.n),
        widths: [...b.querySelectorAll("[stroke-width]")].map((x) =>
          x.getAttribute("stroke-width"),
        ),
      })),
    );
  const before = new Map((await read()).map((c) => [c.n, c.widths.join()]));
  await frame.$eval(".stroke-range", (input) => {
    (input as HTMLInputElement).value = "1.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await ctx.page.waitForTimeout(100);
  const cards = new Map((await read()).map((c) => [c.n, c.widths]));
  await problemsOf(ctx, frame, id);
  const lines = p.cards.filter((c) => cardHasStroke(p, c)).map((c) => c.n);
  if (lines.length === 0) return fail("нет линейных иконок");
  const off = lines.filter((n) => {
    const widths = cards.get(n);
    return (
      widths === undefined ||
      widths.length === 0 ||
      widths.some((w) => w !== "1.5")
    );
  });
  if (off.length > 0) return fail(`толщина не у ${off.join(", ")}`);
  const others = [...cards].filter(
    ([n, widths]) => !lines.includes(n) && widths.join() !== before.get(n),
  );
  if (others.length > 0) {
    return fail(
      `толщина изменилась и у нелинейных: ${others.map(([n]) => n).join(", ")}`,
    );
  }
  const emoji = await openScenario(ctx, "heart-emoji");
  const hidden = await emoji.evaluate(() => {
    const field = document
      .querySelector(".stroke-range")
      ?.closest(".picker-field");
    return (
      field !== null &&
      field !== undefined &&
      getComputedStyle(field).display === "none"
    );
  });
  await problemsOf(ctx, emoji, "heart-emoji");
  if (!hidden) return fail("у эмодзи есть толщина линии");
  return pass(`1,5 у ${lines.length} линейных; у эмодзи ползунка нет`);
}

/**
 * Select: кнопка неактивна без выбора; ушло ровно то, что считает общий модуль, — контекст с кодом
 * выбранного формата и просьба о коде; кнопка — «Selected». Карточка — линейная, если нужна толщина.
 */
async function selectVerdict(
  ctx: Ctx,
  id: string,
  look: { format: Format; color?: string; stroke?: number },
): Promise<Verdict> {
  const p = payloadOf(ctx, id);
  const card =
    look.stroke === undefined
      ? (p.cards[1] ?? p.cards[0])
      : p.cards.find((c) => cardHasStroke(p, c));
  if (card === undefined) return fail("нет подходящей карточки");
  const frame = await openScenario(ctx, id);
  if (
    !(await frame.$eval(
      ".picker-select",
      (b) => (b as HTMLButtonElement).disabled,
    ))
  ) {
    return fail("Select активна без выбора");
  }
  await frame.click(`.pill[data-format="${look.format}"]`);
  if (look.color !== undefined)
    await frame.fill(".color-hex", look.color.slice(1));
  if (look.stroke !== undefined) {
    await frame.$eval(
      ".stroke-range",
      (input, value) => {
        (input as HTMLInputElement).value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      look.stroke,
    );
  }
  await frame.click(`.card[data-n="${card.n}"]`);
  await frame.click(".picker-select");
  await ctx.page.waitForFunction(
    (sid) =>
      ((window as unknown as { pickerLog?: Record<string, unknown[]> })
        .pickerLog?.[sid]?.length ?? 0) >= 2,
    id,
    { timeout: 10_000 },
  );
  const log = await ctx.page.evaluate(
    (sid) =>
      (
        window as unknown as {
          pickerLog: Record<string, { kind: string; text: string }[]>;
        }
      ).pickerLog[sid] ?? [],
    id,
  );
  const choice = pickerChoice(p, card, look);
  if (choice === undefined) return fail("выбор не считается");
  const expected = [
    { kind: "Контекст модели", text: pickerContextText(choice) },
    { kind: "Сообщение в чат", text: pickerMessage(choice, true) },
  ];
  await problemsOf(ctx, frame, id);
  if (JSON.stringify(log) !== JSON.stringify(expected)) {
    return fail(`ушло не то: ${JSON.stringify(log).slice(0, 160)}`);
  }
  await frame.waitForFunction(
    () => document.querySelector(".picker-select")?.textContent === "Selected",
  );
  return pass(`«${expected[1]?.text}»`);
}

async function keyboardVerdict(ctx: Ctx): Promise<Verdict> {
  const last = payloadOf(ctx, "share-en-light").cards.at(-1)?.n ?? 0;
  const frame = await openScenario(ctx, "share-en-light");
  await frame.focus('.card[tabindex="0"]');
  const cols = await frame.$eval(
    ".picker-grid",
    (g) =>
      getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length,
  );
  const at = () =>
    frame.evaluate(() => ({
      focus: Number((document.activeElement as HTMLElement | null)?.dataset.n),
      checked: Number(
        (
          document.querySelector(
            '.card[aria-checked="true"]',
          ) as HTMLElement | null
        )?.dataset.n,
      ),
    }));
  const steps: [string, number][] = [
    ["ArrowRight", 2],
    ["ArrowDown", 2 + cols],
    ["End", last],
    ["Home", 1],
  ];
  for (const [key, n] of steps) {
    await ctx.page.keyboard.press(key);
    const now = await at();
    if (now.focus !== n || now.checked !== n) {
      return fail(
        `${key}: фокус ${now.focus}, выбрана ${now.checked} вместо ${n}`,
      );
    }
  }
  await problemsOf(ctx, frame, "share-en-light");
  return pass(`стрелки, Home и End выбирают карточку, колонок ${cols}`);
}

/** Клиент без сообщений и контекста: ничего не ушло, сетка не сломалась, кнопка — «Selected». */
async function tellVerdict(ctx: Ctx): Promise<Verdict> {
  const id = "settings-no-message";
  const frame = await openScenario(ctx, id);
  await frame.click('.card[data-n="1"]');
  await frame.click(".picker-select");
  await frame.waitForFunction(
    () => document.querySelector(".picker-select")?.textContent === "Selected",
    null,
    { timeout: 15_000 },
  );
  const log = await ctx.page.evaluate(
    (sid) =>
      (window as unknown as { pickerLog: Record<string, unknown[]> }).pickerLog[
        sid
      ] ?? [],
    id,
  );
  await problemsOf(ctx, frame, id);
  if (log.length > 0) return fail("клиент без сообщений что-то получил");
  return pass("ничего не ушло, кнопка — Selected, надписей нет");
}

async function emptyVerdict(ctx: Ctx): Promise<Verdict> {
  const frame = await openScenario(ctx, "empty");
  const seen = await frame.evaluate(() => ({
    status: document.getElementById("picker")?.dataset.status,
    text: document.querySelector(".picker-note")?.textContent ?? "",
    grid: (document.querySelector(".picker-grid") as HTMLElement | null)
      ?.hidden,
  }));
  await problemsOf(ctx, frame, "empty");
  if (seen.status !== "empty" || seen.grid !== true || seen.text === "") {
    return fail(`состояние ${seen.status}, текст «${seen.text}»`);
  }
  return pass(`«${seen.text}»`);
}

/** Высота рамки у клиента — по сообщению вида: вся сетка видна, лишнего места нет. */
async function resizeVerdict(ctx: Ctx): Promise<Verdict> {
  const notes: string[] = [];
  for (const id of ["share-en-light", "basket-phone"]) {
    const frame = await openScenario(ctx, id);
    const outer = await ctx.page.$eval(
      "iframe",
      (f) => f.getBoundingClientRect().height,
    );
    const inner = await frame.evaluate(
      () => document.documentElement.getBoundingClientRect().height,
    );
    await problemsOf(ctx, frame, id);
    if (Math.abs(outer - inner) > 2) {
      return fail(`${id}: рамка ${outer} px, страница ${inner} px`);
    }
    notes.push(`${id} ${Math.round(inner)} px`);
  }
  return pass(notes.join(", "));
}

async function a11yVerdict(ctx: Ctx, source: string): Promise<Verdict> {
  const pages: { path: string; violations: AxeViolation[] }[] = [];
  for (const id of ["share-en-light", "share-ru-dark"]) {
    const frame = await openScenario(ctx, id);
    await frame.click('.card[data-n="1"]');
    await runAxe(frame, source, id, pages);
  }
  return axeVerdict(pages);
}

/** Контрольный запуск: каждая поломка замечена своей строкой. */
async function canaryVerdict(ctx: Ctx, source: string): Promise<Verdict> {
  const missed: string[] = [];
  const render = await openScenario(ctx, "share-en-light", "nometa");
  if ((await renderVerdict(render, payloadOf(ctx, "share-en-light"))).ok) {
    missed.push("nometa");
  }
  const tokens = await openScenario(ctx, "share-ru-dark", "notokens");
  if ((await themeVerdict(tokens, "dark")).ok) missed.push("notokens");
  const external = await openScenario(ctx, "share-en-light", "external");
  await ctx.page.waitForTimeout(500);
  if ((await violations(external)).length === 0) missed.push("external");
  const unlabeled = await openScenario(ctx, "share-en-light", "unlabeled");
  const pages: { path: string; violations: AxeViolation[] }[] = [];
  await runAxe(unlabeled, source, "canary", pages);
  if (axeVerdict(pages).ok) missed.push("unlabeled");
  if ((await strokeVerdict(ctx, "nolines")).ok) missed.push("nolines");
  return missed.length === 0
    ? pass(
        "замечены все 5 поломок: нет данных, нет токенов, чужая картинка, кнопка без подписи, линейные карточки не нарисованы",
      )
    : fail(`проверка слепая: не замечено — ${missed.join(", ")}`);
}

/** Строка с ошибкой — «нет»; остальные строки идут дальше. */
async function row(run: () => Promise<Verdict>): Promise<Verdict> {
  try {
    return await run();
  } catch (e) {
    return fail((e as Error).message.split("\n")[0] ?? "ошибка");
  }
}

async function checkBrowser(
  name: BrowserName,
  base: string,
  scenarios: readonly PickerScenario[],
  source: string,
  live: boolean,
): Promise<PickerCheckResult> {
  const rows = Object.fromEntries(
    PICKER_ROWS.map((id) => [id, { ok: null, note: "не проверялось" }]),
  ) as Record<PickerRowId, Verdict>;
  const shots: PickerShot[] = [];
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser(name, true);
    const context = await browser.newContext({
      viewport: { width: 1100, height: 1300 },
    });
    const page = await context.newPage();
    await recordViolations(page);
    await page.addInitScript(() => {
      const list: string[] = [];
      (window as unknown as { errors: string[] }).errors = list;
      window.addEventListener("error", (e) => list.push(e.message));
      window.addEventListener("unhandledrejection", (e) =>
        list.push(String(e.reason)),
      );
    });
    const ctx: Ctx = {
      page,
      base,
      scenarios: new Map(scenarios.map((s) => [s.id, s])),
      problems: [],
      console: [],
    };
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        message.location().url.includes("/view.html")
      ) {
        ctx.console.push(message.text());
      }
    });
    rows.render = await row(async () => {
      const frame = await openScenario(ctx, "share-en-light");
      await problemsOf(ctx, frame, "share-en-light");
      return renderVerdict(frame, payloadOf(ctx, "share-en-light"));
    });
    rows.theme = await row(async () => {
      // Русский чат: тема тёмная, сетка всё равно по-английски.
      const dark = await openScenario(ctx, "share-ru-dark");
      const darkVerdict = await themeVerdict(dark, "dark");
      await problemsOf(ctx, dark, "share-ru-dark");
      if (darkVerdict.ok !== true) return darkVerdict;
      const light = await openScenario(ctx, "share-en-light");
      const lightVerdict = await themeVerdict(light, "light");
      return lightVerdict.ok === true
        ? pass(`${darkVerdict.note} (русский чат); ${lightVerdict.note}`)
        : lightVerdict;
    });
    rows.format = await row(async () => {
      const frame = await openScenario(ctx, "share-en-light");
      const verdict = await formatVerdict(
        frame,
        payloadOf(ctx, "share-en-light"),
      );
      await problemsOf(ctx, frame, "share-en-light");
      return verdict;
    });
    rows.color = await row(() => colorVerdict(ctx));
    rows.stroke = await row(() => strokeVerdict(ctx));
    rows.select = await row(async () => {
      const html = await selectVerdict(ctx, "share-en-light", {
        format: "html",
      });
      if (html.ok !== true) return html;
      const react = await selectVerdict(ctx, "share-ru-dark", {
        format: "react",
        color: "#e11d48",
      });
      if (react.ok !== true) return react;
      const css = await selectVerdict(ctx, "share-en-light", {
        format: "css",
        stroke: 1.5,
      });
      return css.ok === true
        ? pass(`${html.note}; ${react.note}; ${css.note}`)
        : css;
    });
    rows.keyboard = await row(() => keyboardVerdict(ctx));
    rows.tell = await row(() => tellVerdict(ctx));
    rows.empty = live
      ? { ok: null, note: "живой поиск всегда находит ближайшие по смыслу" }
      : await row(() => emptyVerdict(ctx));
    rows.resize = await row(() => resizeVerdict(ctx));
    rows.a11y = await row(() => a11yVerdict(ctx, source));
    rows.policy =
      ctx.problems.length === 0
        ? pass("нарушений политики рамки и ошибок нет во всех сценариях")
        : fail(ctx.problems.slice(0, 4).join("; "));
    rows.canary = live
      ? { ok: null, note: "только у сборки этой ветки" }
      : await row(() => canaryVerdict(ctx, source));
    for (const [id, title] of [
      ["share-en-light", "Светлая тема"],
      ["share-ru-dark", "Тёмная тема, русский чат"],
      ["heart-emoji", "Только эмодзи"],
      ["basket-phone", "Узкая рамка"],
    ] as const) {
      if (!ctx.scenarios.has(id)) continue;
      const frame = await openScenario(ctx, id);
      await frame.click('.card[data-n="1"]').catch(() => undefined);
      shots.push({
        title,
        png: await shot(page, { errors: [] }, `section[id="${id}"] .chat`),
      });
    }
    await context.close();
    return { browser: name, rows, shots };
  } catch (e) {
    return {
      browser: name,
      rows,
      shots,
      error: (e as Error).message.split("\n")[0] ?? "ошибка",
    };
  } finally {
    await browser?.close();
  }
}

export async function checkPicker(options: {
  root: string;
  scenarios: readonly PickerScenario[];
  browsers: readonly BrowserName[];
  /** Живая страница сетки с сервера; нет — сборка этой ветки. */
  page?: { html: string; version: string };
  log: (line: string) => void;
}): Promise<PickerCheckResult[]> {
  const host = await startPickerHost({
    root: options.root,
    port: 0,
    scenarios: options.scenarios,
    ...(options.page === undefined ? {} : { page: options.page }),
  });
  const base = `http://127.0.0.1:${host.port}`;
  const source = await axe();
  const results: PickerCheckResult[] = [];
  try {
    for (const name of options.browsers) {
      options.log(`${BROWSER_TITLES[name]}…`);
      results.push(
        await checkBrowser(
          name,
          base,
          options.scenarios,
          source,
          options.page !== undefined,
        ),
      );
    }
  } finally {
    await host.close();
  }
  return results;
}

/** Проблемы: строка «нет» или браузер не дошёл до конца. */
export const pickerCheckFailed = (results: readonly PickerCheckResult[]) =>
  results.some(
    (r) =>
      r.error !== undefined ||
      Object.values(r.rows).some((v) => v.ok === false),
  );
