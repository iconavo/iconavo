// Обратная связь в проверке сайта (шаг 3 фазы 5, PR 6а; кадры K2–K6): окна из меню аккаунта против превью
// сервиса аккаунтов — письма превью собирает в памяти, вместе с Reply-To и вложениями.
//
// Сценарий на компьютере: «Report a bug» — фокус в поле, пустое — «Describe what went wrong», GIF —
// «This file can’t be used…», PNG — имя файла, «We’ll reply to почта»; «Send report» — окно закрылось,
// «Thanks! We got your report», фокус на кнопке аккаунта, письмо на support@ с Reply-To человека,
// скриншотом вложением, страницей и браузером. «Request new icons» — набор из меню внутри окна (Esc
// закрывает только меню), письмо с набором. «Request a feature» — письмо. «Send feedback» — без оценки —
// «Choose a rating», звёзды с клавиатуры, письмо со звёздами. Плюс телефон (меню-шторка → окно-шторка),
// axe в обеих темах, CSP и консоль. Контрольный запуск: ответ сервиса подменён «успехом», а письма нет.

import type { Browser, BrowserContext, Page } from "playwright";
import { type AxeViolation, axe, axeVerdict, runAxe } from "../sandbox/axe.js";
import {
  allViolations,
  fail,
  pass,
  recordViolations,
  type Verdict,
  watch,
} from "../sandbox/verdict.js";
import {
  type AccountCheckOptions,
  focused,
  photo,
  register,
  type Shots,
  settle,
} from "./account.js";
import { testPhoto } from "./cabinet.js";
import { DESKTOP, PANEL_WAIT_MS, PHONE } from "./config.js";
import { hydrated } from "./panel.js";

const WAIT = PANEL_WAIT_MS;
const SUPPORT = "support@iconavo.dev";

const dialog = (page: Page, kind: string) =>
  page.locator(`dialog.cabinet-dialog[data-dialog="feedback-${kind}"][open]`);

const closed = (page: Page) =>
  page.waitForFunction(
    () => document.querySelector("dialog.cabinet-dialog[open]") === null,
    undefined,
    { timeout: WAIT },
  );

/** Пункт меню аккаунта по тексту — на компьютере. */
async function openFromMenu(page: Page, label: string): Promise<void> {
  await page.locator("#account-button").click();
  await page
    .locator(".account-menu .account-menu-item", { hasText: label })
    .click();
}

/** Новое письмо в поддержку после n-го — ждём до 10 с. */
async function letterAfter(o: AccountCheckOptions, after: number) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const letter = (o.account?.mail() ?? [])
      .slice(after)
      .find((m) => m.to === SUPPORT);
    if (letter !== undefined) return letter;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const toast = (page: Page, text: string) =>
  page
    .locator(".toast", { hasText: text })
    .waitFor({ timeout: WAIT })
    .then(
      () => true,
      () => false,
    );

const errorIn = async (page: Page, kind: string) => {
  const note = dialog(page, kind).locator(".auth-note-error").first();
  return note
    .waitFor({ timeout: WAIT })
    .then(() => note.textContent())
    .catch(() => null);
};

/** Ошибка со скриншотом: от пустого поля до письма в поддержку. */
export async function bugProblems(
  page: Page,
  o: AccountCheckOptions,
  email: string,
  shots?: Shots,
  seen?: { errors: string[] },
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  await openFromMenu(page, "Report a bug");
  const box = dialog(page, "bug");
  await box.waitFor({ timeout: WAIT });
  no(
    await page
      .waitForFunction(
        () =>
          document.activeElement?.matches(
            'dialog[data-dialog="feedback-bug"] textarea',
          ) === true,
        undefined,
        { timeout: 3_000 },
      )
      .then(
        () => true,
        () => false,
      ),
    `при открытии фокус не в поле: ${(await focused(page)).tag}`,
  );
  await box.locator("button.auth-primary").click();
  const empty = await errorIn(page, "bug");
  no(empty === "Describe what went wrong", `пустое сообщение: «${empty}»`);
  await box.locator("textarea").fill("The Copy SVG button does nothing");
  await box.locator("input.feedback-drop-input").setInputFiles({
    name: "clip.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  const wrong = await errorIn(page, "bug");
  no(
    (wrong ?? "").startsWith("This file can’t be used"),
    `GIF вместо скриншота: «${wrong}»`,
  );
  await box.locator("input.feedback-drop-input").setInputFiles({
    name: "screen.png",
    mimeType: "image/png",
    buffer: testPhoto(640, 360),
  });
  await box
    .locator(".feedback-shot", { hasText: "screen.png" })
    .waitFor({ timeout: WAIT })
    .catch(() => problems.push("выбранного скриншота не видно в окне"));
  no(
    ((await box.textContent()) ?? "").includes(`We’ll reply to ${email}`),
    "в окне нет «We’ll reply to почта»",
  );
  if (shots !== undefined && seen !== undefined) {
    await photo(page, seen, shots, "Обратная связь: ошибка со скриншотом");
  }
  const before = o.account?.mail().length ?? 0;
  await box.locator("button.auth-primary").click();
  await closed(page);
  no(
    await toast(page, "Thanks! We got your report"),
    "нет сообщения «Thanks! We got your report»",
  );
  no(
    (await page.locator(".toast .toast-success").count()) === 1,
    "у сообщения нет галочки успеха",
  );
  no(
    await page
      .waitForFunction(
        () => document.activeElement?.id === "account-button",
        undefined,
        { timeout: 3_000 },
      )
      .then(
        () => true,
        () => false,
      ),
    `после отправки фокус не на кнопке аккаунта: ${(await focused(page)).tag}`,
  );
  const letter = await letterAfter(o, before);
  if (letter === undefined) return [...problems, "письма в поддержку нет"];
  no(letter.replyTo === email, `Reply-To письма — ${letter.replyTo}`);
  no(
    letter.subject === "[Ошибка] The Copy SVG button does nothing",
    `тема письма: «${letter.subject}»`,
  );
  no(
    letter.attachments?.[0]?.filename === "screenshot.png",
    `вложения письма: ${JSON.stringify(letter.attachments ?? [])}`,
  );
  no(
    letter.text.includes(`Страница: ${o.base}`) &&
      letter.text.includes("Браузер: "),
    "в письме нет страницы или браузера",
  );
  return problems;
}

/** Запрос иконок с набором, запрос функции и отзыв со звёздами. */
async function requestProblems(
  page: Page,
  o: AccountCheckOptions,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  // Иконки: набор — из меню внутри окна; Esc закрывает только меню.
  await openFromMenu(page, "Request new icons");
  const icons = dialog(page, "icons");
  await icons.waitFor({ timeout: WAIT });
  await icons.locator("input.auth-field-input").fill("chef hat, whisk");
  const select = icons.locator("button.feedback-select");
  await select.click();
  const menu = page.locator(".feedback-menu");
  await menu.waitFor({ timeout: WAIT });
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached", timeout: WAIT }).catch(() => {});
  no(
    (await icons.count()) === 1,
    "Esc в меню набора закрыл и окно запроса иконок",
  );
  await select.click();
  await menu.locator(".feedback-menu-item", { hasText: "Lucide" }).click();
  no(
    ((await select.textContent()) ?? "").includes("Lucide"),
    `в поле набора — «${await select.textContent()}», а не Lucide`,
  );
  await icons.locator("textarea").fill("A recipe app");
  let before = o.account?.mail().length ?? 0;
  await icons.locator("button.auth-primary").click();
  await closed(page);
  no(
    await toast(page, "Thanks! We got your request"),
    "после запроса иконок нет «Thanks! We got your request»",
  );
  const iconsLetter = await letterAfter(o, before);
  no(
    iconsLetter?.subject === "[Иконки] chef hat, whisk" &&
      iconsLetter.text.includes("Набор: lucide"),
    `письмо о запросе иконок: «${iconsLetter?.subject}»`,
  );

  // Функция.
  await openFromMenu(page, "Request new features");
  const feature = dialog(page, "feature");
  await feature.waitFor({ timeout: WAIT });
  await feature
    .locator("input.auth-field-input")
    .fill("Export a set as a Figma library");
  before = o.account?.mail().length ?? 0;
  await feature.locator("button.auth-primary").click();
  await closed(page);
  const featureLetter = await letterAfter(o, before);
  no(
    featureLetter?.subject === "[Функция] Export a set as a Figma library",
    `письмо о функции: «${featureLetter?.subject}»`,
  );

  // Отзыв: без оценки — ошибка; звёзды — с клавиатуры.
  await openFromMenu(page, "Send feedback");
  const review = dialog(page, "feedback");
  await review.waitFor({ timeout: WAIT });
  await review.locator("button.auth-primary").click();
  const noRating = await errorIn(page, "feedback");
  no(noRating === "Choose a rating", `отзыв без оценки: «${noRating}»`);
  await review.locator('input[type="radio"]').first().focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  const checked = await review
    .locator('input[type="radio"]:checked')
    .getAttribute("value")
    .catch(() => null);
  no(checked === "4", `стрелки поставили оценку ${checked}, а не 4`);
  await review.locator("textarea").fill("Search is great");
  before = o.account?.mail().length ?? 0;
  await review.locator("button.auth-primary").click();
  await closed(page);
  const reviewLetter = await letterAfter(o, before);
  no(
    reviewLetter?.subject === "[Отзыв ★★★★☆] Search is great",
    `письмо с отзывом: «${reviewLetter?.subject}»`,
  );

  // Esc закрывает окно, фокус — на кнопке аккаунта.
  await openFromMenu(page, "Report a bug");
  await dialog(page, "bug").waitFor({ timeout: WAIT });
  await page.keyboard.press("Escape");
  await closed(page);
  no(
    await page
      .waitForFunction(
        () => document.activeElement?.id === "account-button",
        undefined,
        { timeout: 3_000 },
      )
      .then(
        () => true,
        () => false,
      ),
    "после Esc фокус не на кнопке аккаунта",
  );
  return problems;
}

/** Телефон: меню аккаунта — шторка, окно — шторка снизу во всю ширину. */
async function phoneProblems(
  browser: Browser,
  o: AccountCheckOptions,
  name: string,
  shots: Shots,
): Promise<string[]> {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems: string[] = [];
  await register(page, o, `${name}-fb-phone@example.com`);
  await page.locator("#account-button").click();
  const sheet = page.locator("dialog.account-sheet[open]");
  await sheet.waitFor({ timeout: WAIT });
  await sheet
    .locator(".account-menu-item", { hasText: "Send feedback" })
    .click();
  await dialog(page, "feedback").waitFor({ timeout: WAIT });
  await settle(page);
  const box = await page.evaluate(() => {
    const r = document
      .querySelector('dialog[data-dialog="feedback-feedback"][open]')
      ?.getBoundingClientRect();
    return r === undefined
      ? null
      : {
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          width: document.documentElement.clientWidth,
          viewport: innerWidth,
          height: innerHeight,
          sheetOpen:
            document.querySelector<HTMLDialogElement>("dialog.account-sheet")
              ?.open === true,
        };
  });
  if (
    box === null ||
    box.sheetOpen ||
    Math.abs(box.left) > 1 ||
    box.right < box.width - 1 ||
    box.right > box.viewport + 1 ||
    Math.abs(box.bottom - box.height) > 1
  ) {
    problems.push(
      `на телефоне окно отзыва — не шторка снизу: ${JSON.stringify(box)}`,
    );
  }
  await photo(page, seen, shots, "Обратная связь на телефоне");
  problems.push(
    ...(await allViolations(page)).map((x) => `телефон, CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `телефон, ошибка: ${x}`),
  );
  await context.close();
  return problems;
}

/** axe с открытыми окнами ошибки и отзыва — в светлой и тёмной теме. */
async function accessProblems(
  browser: Browser,
  o: AccountCheckOptions,
  name: string,
): Promise<string[]> {
  const pages: { path: string; violations: AxeViolation[] }[] = [];
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: DESKTOP,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await register(page, o, `${name}-fb-axe-${scheme}@example.com`);
    await openFromMenu(page, "Report a bug");
    await dialog(page, "bug").waitFor({ timeout: WAIT });
    await settle(page);
    await runAxe(page, await axe(), `ошибка, ${scheme}`, pages);
    await page.keyboard.press("Escape");
    await closed(page);
    await openFromMenu(page, "Send feedback");
    await dialog(page, "feedback").waitFor({ timeout: WAIT });
    await settle(page);
    await runAxe(page, await axe(), `отзыв, ${scheme}`, pages);
    await context.close();
  }
  const verdict = axeVerdict(pages);
  return verdict.ok === false ? [`axe: ${verdict.note}`] : [];
}

/** Строка «Обратная связь». */
export async function checkFeedback(
  browser: Browser,
  name: string,
  o: AccountCheckOptions,
  shots: Shots,
): Promise<Verdict> {
  if (o.account === undefined) {
    return fail("у проверки нет превью сервиса аккаунтов");
  }
  const problems: string[] = [];
  const run = async (title: string, scenario: () => Promise<string[]>) =>
    problems.push(
      ...(await scenario().catch((e: Error) => [
        `${title} остановился: ${e.message.split("\n")[0]}`,
      ])),
    );
  const email = `${name}-fb@example.com`;
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  await run("обратная связь", async () => {
    await register(page, o, email);
    await hydrated(page);
    const found = await bugProblems(page, o, email, shots, seen);
    found.push(...(await requestProblems(page, o)));
    return found;
  });
  problems.push(
    ...(await allViolations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();
  await run("телефон", () => phoneProblems(browser, o, name, shots));
  await run("axe", () => accessProblems(browser, o, name));
  return problems.length === 0
    ? pass(
        "ошибка — фокус в поле, пустое и GIF — ошибки, PNG — имя файла, «We’ll reply to», «Thanks! We got your report» с галочкой, фокус на кнопке аккаунта, письмо на support@ с Reply-To, скриншотом, страницей и браузером; иконки — набор из меню в окне, Esc закрывает только меню, письмо с набором; функция; отзыв — без оценки ошибка, звёзды стрелками, письмо со звёздами; Esc и фокус; телефон — шторки; axe в обеих темах; CSP",
      )
    : fail(problems.slice(0, 5).join("; "));
}

/**
 * Контрольная поломка: ответ сервиса подменён «успехом», а сама форма до сервиса не доходит — строка
 * обязана заметить, что письма в поддержку нет.
 */
export async function spoilFeedback(
  context: BrowserContext,
  origin: string,
  site: string,
): Promise<void> {
  await context.route(`${origin}/api/account/feedback`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": site,
        "access-control-allow-credentials": "true",
      },
      body: JSON.stringify({ ok: true }),
    }),
  );
}
