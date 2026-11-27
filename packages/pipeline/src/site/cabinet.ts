// Кабинет в проверке сайта (шаг 3 фазы 5, PR 4; ADR-0055): страница /account против превью сервиса аккаунтов —
// с его базой, бакетом фото и письмами в памяти.
//
// Сценарий на компьютере: в закрытом режиме — «скоро» и ни одного запроса к сервису; гостю — «Log In» без
// запросов. После регистрации «My account» в меню ведёт на /account в той же вкладке: почта и «Verified»,
// пароль «Changed today», Google не подключён, сводка включена, новости выключены. Имя: Enter — «Name saved»,
// новое имя в «Your Plan»; второе имя и «Undo» — прежнее; пустое — «Enter a name». Фото: PNG → окно обрезки
// (фокус в окне, стрелки двигают), «Save photo» — фото загрузилось в кабинете и в кнопке аккаунта, «Undo» —
// снова буква; маленькое — «This file can’t be used…». Письма: новости — «Email settings saved» и после
// перезагрузки включены. Почта: Esc — фокус на «Change email»; неверный пароль — ошибка; код на новую почту —
// второй шаг того же окна с фокусом в коде; неверный код — ошибка; верный — «Email changed», новая почта в
// кабинете, письмо о смене — на прежнюю. Пароль: неверный текущий — ошибка; верный — «Password updated», после
// перезагрузки вход на месте, письмо о смене, вход новым паролем. Google: «Connect» ведёт к Google с адресом
// возврата сервиса, отказ Google — сообщение. Удаление: чужая почта — «Doesn’t match your email»; верно —
// главная, «Your account was deleted», «Log In», прежний пароль не входит. Плюс axe в обеих темах (страница
// и окно), телефон (без прокрутки вбок, окно — шторка снизу), CSP и консоль.

import type { Browser, BrowserContext, Page } from "playwright";
import { PREVIEW_GOOGLE_CLIENT } from "../account/config.js";
import { encodePng } from "../qc/png.js";
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
  accountRequests,
  codeFor,
  focused,
  logIn,
  NEW_PASSWORD,
  PASSWORD,
  photo,
  register,
  type Shots,
  SIGNED_KEY,
  settle,
} from "./account.js";
import { DESKTOP, PANEL_WAIT_MS, PHONE } from "./config.js";
import { hydrated } from "./panel.js";

const WAIT = PANEL_WAIT_MS;

/** Окно кабинета по имени (data-dialog), открытое. */
const dialog = (page: Page, name: string) =>
  page.locator(`dialog.cabinet-dialog[data-dialog="${name}"][open]`);

const closed = (page: Page) =>
  page.waitForFunction(
    () => document.querySelector("dialog.cabinet-dialog[open]") === null,
    undefined,
    { timeout: WAIT },
  );

const rowButton = (page: Page, text: string) =>
  page.locator(".cabinet-row button", { hasText: text }).first();

/**
 * Фокус пришёл куда надо — за 3 с: окно переводит фокус в эффекте после отрисовки, а WebKit отрисовывает
 * позже Chrome и Firefox.
 */
const focusOn = (page: Page, where: () => boolean) =>
  page.waitForFunction(where, undefined, { timeout: 3_000 }).then(
    () => true,
    () => false,
  );

/** Сообщение с текстом появилось; true — да. */
const toast = (page: Page, text: string) =>
  page
    .locator(".toast", { hasText: text })
    .waitFor({ timeout: WAIT })
    .then(
      () => true,
      () => false,
    );

/** PNG w × h — «фото» для загрузки: градиент, чтобы обрезку было видно. */
export function testPhoto(width: number, height: number): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = Math.round((x / width) * 255);
      rgba[i + 1] = Math.round((y / height) * 200);
      rgba[i + 2] = 180;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(rgba, width, height);
}

/** Картинка загрузилась и нарисована (а не пустая рамка с подписью). */
const loaded = (page: Page, selector: string) =>
  page
    .waitForFunction(
      (s) => {
        const img = document.querySelector<HTMLImageElement>(s);
        return img?.complete === true && img.naturalWidth > 0;
      },
      selector,
      { timeout: WAIT },
    )
    .then(
      () => true,
      () => false,
    );

/** Открыть кабинет пунктом меню «My account» и дождаться данных. */
async function openCabinet(page: Page): Promise<void> {
  await page.locator("#account-button").click();
  await page
    .locator(".account-menu a.account-menu-item", { hasText: "My account" })
    .click();
  await page.waitForURL(/\/account$/, { timeout: WAIT });
  await page.locator(".cabinet").waitFor({ timeout: WAIT });
}

/** Перезагрузить кабинет и дождаться данных. */
async function reloadCabinet(page: Page): Promise<void> {
  await page.reload();
  await hydrated(page);
  await page.locator(".cabinet").waitFor({ timeout: WAIT });
}

/** Закрытый режим и гость: «скоро» без запросов, потом «Log In» — тоже без запросов. */
async function guestProblems(
  browser: Browser,
  o: AccountCheckOptions,
): Promise<string[]> {
  const problems: string[] = [];
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const sent = accountRequests(page, o.account?.origin ?? "-");
  await page.goto(`${o.base}/account`);
  await hydrated(page);
  await page.waitForTimeout(300);
  const soon = (await page.locator(".cabinet-note").textContent()) ?? "";
  if (!soon.includes("coming soon")) {
    problems.push(`в закрытом режиме на /account — «${soon}»`);
  }
  if (
    (await page.locator("meta[name=robots]").getAttribute("content")) !==
    "noindex, nofollow"
  ) {
    problems.push("у /account нет noindex");
  }
  await page.goto(`${o.base}/account?accounts=on`);
  await hydrated(page);
  const guest = await page
    .locator(".cabinet-note button.auth-primary")
    .waitFor({ timeout: WAIT })
    .then(
      () => true,
      () => false,
    );
  if (!guest) problems.push("гостю на /account нет кнопки «Log In»");
  await page.waitForTimeout(300);
  if (sent.length > 0) {
    problems.push(
      `гость или закрытый режим спросили сервис: ${sent.map((s) => s.path).join(", ")}`,
    );
  }
  await context.close();
  return problems;
}

/** Что видно сразу после регистрации. */
async function firstLookProblems(page: Page, email: string): Promise<string[]> {
  const problems: string[] = [];
  const text = (await page.locator(".cabinet").textContent()) ?? "";
  for (const part of [
    email,
    "Verified",
    "Changed today",
    "Not connected",
    "Always available",
  ]) {
    if (!text.includes(part)) problems.push(`в кабинете нет «${part}»`);
  }
  const toggles = await page
    .locator(".cabinet-toggle")
    .evaluateAll((list) =>
      list.map(
        (t) =>
          `${t.getAttribute("data-field")}=${t.getAttribute("aria-checked")}`,
      ),
    );
  if (toggles.join(",") !== "digest=true,news=false") {
    problems.push(`письма по умолчанию: ${toggles.join(",")}`);
  }
  return problems;
}

/** Имя, фото и письма. */
export async function profileProblems(
  page: Page,
  shots?: Shots,
  seen?: { errors: string[] },
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const plan = page.locator(".sidebar-plan .account-plan-name");
  const name = page.locator('.cabinet input[autocomplete="name"]');

  // Имя: Enter — сохранено, «Your Plan» показывает его; второе имя и «Undo» — прежнее.
  await name.fill("Ann Lee");
  await name.press("Enter");
  no(await toast(page, "Name saved"), "после Enter нет «Name saved»");
  await page
    .waitForFunction(
      () =>
        document.querySelector(".sidebar-plan .account-plan-name")
          ?.textContent === "Ann Lee",
      undefined,
      { timeout: WAIT },
    )
    .catch(async () =>
      problems.push(
        `в «Your Plan» — «${await plan.textContent()}», а не новое имя`,
      ),
    );
  await name.fill("Ann B");
  await name.press("Enter");
  await page
    .locator(".toast", { hasText: "Name saved" })
    .locator(".toast-action")
    .waitFor({ timeout: WAIT });
  await page.locator(".toast .toast-action", { hasText: "Undo" }).click();
  await page
    .waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>(
          '.cabinet input[autocomplete="name"]',
        )?.value === "Ann Lee",
      undefined,
      { timeout: WAIT },
    )
    .catch(async () =>
      problems.push(`«Undo» имени: в поле «${await name.inputValue()}»`),
    );
  await name.fill("");
  await name.press("Enter");
  const empty = page.locator(".cabinet .auth-input[data-invalid] .auth-note");
  const emptyText = await empty
    .waitFor({ timeout: WAIT })
    .then(() => empty.textContent());
  no(emptyText === "Enter a name", `пустое имя: «${emptyText}»`);
  await name.fill("Ann Lee");

  // Фото: файл → обрезка → сохранено и видно в кабинете и в кнопке аккаунта; «Undo» — снова буква.
  await page.locator(".cabinet-file").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: testPhoto(800, 500),
  });
  const crop = dialog(page, "crop");
  await crop.waitFor({ timeout: WAIT });
  no(
    await page.evaluate(
      () => document.activeElement?.closest("dialog.cabinet-dialog") !== null,
    ),
    "в окне обрезки фокус не в окне",
  );
  await crop.locator("canvas.crop-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await crop.locator('input[type="range"]').fill("2");
  if (shots !== undefined && seen !== undefined) {
    await photo(page, seen, shots, "Кабинет: обрезка фото");
  }
  await crop.locator("button.auth-primary").click();
  await closed(page);
  no(await toast(page, "Photo updated"), "после «Save photo» нет сообщения");
  no(
    await loaded(page, ".cabinet img.cabinet-avatar"),
    "фото в кабинете не загрузилось",
  );
  no(
    await loaded(page, "#account-button img"),
    "фото в кнопке аккаунта не загрузилось",
  );
  if (shots !== undefined && seen !== undefined) {
    await photo(page, seen, shots, "Кабинет: фото сохранено");
  }
  await page
    .locator(".toast", { hasText: "Photo updated" })
    .locator(".toast-action")
    .click();
  await page
    .locator(".cabinet span.cabinet-avatar")
    .waitFor({ timeout: WAIT })
    .catch(() => problems.push("«Undo» фото не вернул букву"));
  await page.locator(".cabinet-file").setInputFiles({
    name: "small.png",
    mimeType: "image/png",
    buffer: testPhoto(120, 120),
  });
  const wrongFile = await page
    .locator(".cabinet-photo .auth-note-error")
    .waitFor({ timeout: WAIT })
    .then(() => page.locator(".cabinet-photo .auth-note-error").textContent());
  no(
    (wrongFile ?? "").startsWith("This file can’t be used"),
    `маленькое фото: «${wrongFile}»`,
  );

  // Письма: новости включены и остаются после перезагрузки.
  await page.locator('.cabinet-toggle[data-field="news"]').click();
  no(
    await toast(page, "Email settings saved"),
    "после переключателя нет «Email settings saved»",
  );
  await reloadCabinet(page);
  no(
    (await page
      .locator('.cabinet-toggle[data-field="news"]')
      .getAttribute("aria-checked")) === "true",
    "после перезагрузки новости снова выключены",
  );
  no(
    (await name.inputValue()) === "Ann Lee",
    `после перезагрузки имя — «${await name.inputValue()}»`,
  );
  return problems;
}

/** Смена почты: окно в два шага, ошибки, письмо на прежнюю почту. */
async function emailProblems(
  page: Page,
  o: AccountCheckOptions,
  email: string,
  next: string,
  shots: Shots,
  seen: { errors: string[] },
): Promise<string[]> {
  const account = o.account;
  if (account === undefined) return [];
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  // Esc закрывает окно, фокус — на кнопке, которая его открыла.
  await rowButton(page, "Change email").click();
  await dialog(page, "email").waitFor({ timeout: WAIT });
  await page.keyboard.press("Escape");
  await closed(page);
  no(
    await focusOn(
      page,
      () => document.activeElement?.textContent === "Change email",
    ),
    `после Esc фокус не на «Change email»: ${(await focused(page)).tag}`,
  );

  await rowButton(page, "Change email").click();
  const step1 = dialog(page, "email");
  await step1.waitFor({ timeout: WAIT });
  await step1.locator('input[type="email"]').fill(next);
  await step1
    .locator('input[autocomplete="current-password"]')
    .fill("nope nope 9");
  await step1.locator("button.auth-primary").click();
  const wrong = step1.locator(".auth-note-error").first();
  await wrong.waitFor({ timeout: WAIT });
  no(
    ((await wrong.textContent()) ?? "").startsWith("Wrong password"),
    `неверный пароль при смене почты: «${await wrong.textContent()}»`,
  );
  await step1.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  const before = account.mail().length;
  await step1.locator("button.auth-primary").click();
  const step2 = dialog(page, "email-code");
  const reached = await step2.waitFor({ timeout: WAIT }).then(
    () => true,
    () => false,
  );
  if (!reached) {
    return [...problems, "после «Send code» нет шага с кодом"];
  }
  no(
    await focusOn(
      page,
      () =>
        document.activeElement?.matches(
          "dialog.cabinet-dialog[open] input.auth-code-input",
        ) === true,
    ),
    `на шаге кода фокус не в поле кода: ${(await focused(page)).tag}`,
  );
  await photo(page, seen, shots, "Кабинет: код на новую почту");
  const code = await codeFor(o, next, before);
  await step2
    .locator("input.auth-code-input")
    .fill(code === "000000" ? "111111" : "000000");
  await step2.locator("button.auth-primary").click();
  const wrongCode = step2.locator(".auth-note-error").first();
  await wrongCode.waitFor({ timeout: WAIT });
  no(
    ((await wrongCode.textContent()) ?? "").startsWith("Wrong code"),
    `неверный код: «${await wrongCode.textContent()}»`,
  );
  await step2.locator("input.auth-code-input").fill(code);
  await step2.locator("button.auth-primary").click();
  await closed(page);
  no(await toast(page, "Email changed"), "нет сообщения «Email changed»");
  await page
    .locator(".cabinet-row", { hasText: next })
    .first()
    .waitFor({ timeout: WAIT })
    .catch(() => problems.push("новой почты нет в кабинете"));
  const notice = account
    .mail()
    .slice(before)
    .find((m) => m.to === email && m.subject.includes("email"));
  no(notice !== undefined, "письма о смене почты на прежний адрес нет");
  return problems;
}

/** Смена пароля: неверный текущий — ошибка; верный — вход на месте после перезагрузки и письмо. */
export async function passwordProblems(
  page: Page,
  o: AccountCheckOptions,
  email: string,
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  await rowButton(page, "Change password").click();
  const box = dialog(page, "password");
  await box.waitFor({ timeout: WAIT });
  const current = box.locator('input[autocomplete="current-password"]');
  const fresh = box.locator('input[autocomplete="new-password"]');
  await current.fill("nope nope 9");
  await fresh.fill(NEW_PASSWORD);
  await box.locator("button.auth-primary").click();
  const wrong = box.locator(".auth-note-error").first();
  await wrong.waitFor({ timeout: WAIT });
  no(
    ((await wrong.textContent()) ?? "").startsWith("Wrong password"),
    `неверный текущий пароль: «${await wrong.textContent()}»`,
  );
  await current.fill(PASSWORD);
  const before = o.account?.mail().length ?? 0;
  await box.locator("button.auth-primary").click();
  await closed(page);
  no(await toast(page, "Password updated"), "нет сообщения «Password updated»");
  // Сервис закрыл все сеансы и выдал этому новую cookie: после перезагрузки вход на месте.
  await page.reload();
  await hydrated(page);
  const still = await page
    .locator(".cabinet-row")
    .first()
    .waitFor({ timeout: WAIT })
    .then(
      () => true,
      () => false,
    );
  no(still, "после смены пароля вход потерян");
  no(
    (o.account?.mail() ?? [])
      .slice(before)
      .some((m) => m.to === email && m.subject.includes("password")),
    "письма о смене пароля нет",
  );
  return problems;
}

/** Google: «Connect» ведёт к Google с возвратом через сервис; отказ Google — сообщение на этой странице. */
async function googleProblems(
  page: Page,
  o: AccountCheckOptions,
): Promise<string[]> {
  const account = o.account;
  if (account === undefined) return [];
  const problems: string[] = [];
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Google</title><p>Google",
    }),
  );
  await Promise.all([
    page.waitForURL(/^https:\/\/accounts\.google\.com\//, { timeout: WAIT }),
    rowButton(page, "Connect").click(),
  ]);
  const google = new URL(page.url());
  if (google.searchParams.get("client_id") !== PREVIEW_GOOGLE_CLIENT) {
    problems.push(
      `у адреса Google не тот client_id: ${google.searchParams.get("client_id")}`,
    );
  }
  const state = google.searchParams.get("state") ?? "";
  await page.goto(
    `${account.origin}/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state)}`,
  );
  await page.waitForURL((url) => url.href.startsWith(`${o.base}/account`), {
    timeout: WAIT,
  });
  await hydrated(page);
  if (!(await toast(page, "Couldn’t connect Google"))) {
    problems.push(
      "после отказа Google нет сообщения «Couldn’t connect Google»",
    );
  }
  await page
    .waitForFunction(
      () => !/[?&](account|error)=/.test(location.search),
      undefined,
      { timeout: WAIT },
    )
    .catch(() =>
      problems.push(`после Google в адресе остался возврат: ${page.url()}`),
    );
  await page.locator(".cabinet").waitFor({ timeout: WAIT });
  return problems;
}

/** Удаление: чужая почта — ошибка; верно — главная, сообщение, «Log In»; прежний пароль не входит. */
async function deleteProblems(
  page: Page,
  email: string,
  shots: Shots,
  seen: { errors: string[] },
): Promise<string[]> {
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  await page.locator(".cabinet-danger-outline").click();
  const box = dialog(page, "delete");
  await box.waitFor({ timeout: WAIT });
  await box.locator('input[type="email"]').fill("someone@example.com");
  await box
    .locator('input[autocomplete="current-password"]')
    .fill(NEW_PASSWORD);
  await box.locator("button.cabinet-danger").click();
  const mismatch = box.locator(".auth-note-error").first();
  await mismatch.waitFor({ timeout: WAIT });
  no(
    (await mismatch.textContent()) === "Doesn’t match your email",
    `чужая почта при удалении: «${await mismatch.textContent()}»`,
  );
  await photo(page, seen, shots, "Кабинет: удаление");
  await box.locator('input[type="email"]').fill(email);
  await box.locator("button.cabinet-danger").click();
  await page
    .waitForURL((url) => new URL(url).pathname === "/", { timeout: WAIT })
    .catch(() => problems.push(`после удаления не главная: ${page.url()}`));
  no(
    await toast(page, "Your account was deleted"),
    "нет сообщения «Your account was deleted»",
  );
  await page
    .locator("#account-log-in")
    .waitFor({ timeout: WAIT })
    .catch(() => problems.push("после удаления нет «Log In»"));
  no(
    (await page.evaluate((key) => localStorage.getItem(key), SIGNED_KEY)) ===
      null,
    "после удаления браузер помнит вход",
  );
  no(
    !(await logIn(page, email, NEW_PASSWORD)),
    "удалённый аккаунт входит прежним паролем",
  );
  await page.keyboard.press("Escape");
  return problems;
}

/** axe на странице кабинета и в окне — в светлой и тёмной теме. */
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
    await register(page, o, `${name}-axe-${scheme}@example.com`);
    await openCabinet(page);
    await settle(page);
    await runAxe(page, await axe(), `кабинет, ${scheme}`, pages);
    await rowButton(page, "Change password").click();
    await dialog(page, "password").waitFor({ timeout: WAIT });
    // Пока окно проявляется, цвета полупрозрачные — контраст мерить рано.
    await settle(page);
    await runAxe(page, await axe(), `окно пароля, ${scheme}`, pages);
    await context.close();
  }
  const verdict = axeVerdict(pages);
  return verdict.ok === false ? [`axe: ${verdict.note}`] : [];
}

/** Телефон: без прокрутки вбок, окно — шторка снизу во всю ширину. */
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
  await register(page, o, `${name}-phone@example.com`);
  await page.goto(`${o.base}/account`);
  await hydrated(page);
  await page.locator(".cabinet-row").first().waitFor({ timeout: WAIT });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  ) {
    problems.push("на телефоне кабинет шире окна");
  }
  await photo(page, seen, shots, "Кабинет на телефоне");
  await page.locator(".cabinet-danger-outline").click();
  await dialog(page, "delete").waitFor({ timeout: WAIT });
  await settle(page);
  const box = await page.evaluate(() => {
    const r = document
      .querySelector("dialog.cabinet-dialog[open]")
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
        };
  });
  if (
    box === null ||
    Math.abs(box.left) > 1 ||
    box.right < box.width - 1 ||
    box.right > box.viewport + 1 ||
    Math.abs(box.bottom - box.height) > 1
  ) {
    problems.push(`на телефоне окно — не шторка снизу: ${JSON.stringify(box)}`);
  }
  await photo(page, seen, shots, "Кабинет на телефоне: окно удаления");
  problems.push(
    ...(await allViolations(page)).map((x) => `телефон, CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `телефон, ошибка: ${x}`),
  );
  await context.close();
  return problems;
}

/** Строка «Кабинет». */
export async function checkCabinet(
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
  await run("гость", () => guestProblems(browser, o));

  const email = `${name}-cab@example.com`;
  const next = `${name}-cab-new@example.com`;
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  await run("кабинет", async () => {
    await register(page, o, email);
    await openCabinet(page);
    await photo(page, seen, shots, "Кабинет");
    const found = await firstLookProblems(page, email);
    found.push(...(await profileProblems(page, shots, seen)));
    found.push(...(await emailProblems(page, o, email, next, shots, seen)));
    found.push(...(await passwordProblems(page, o, next)));
    found.push(...(await googleProblems(page, o)));
    found.push(...(await deleteProblems(page, next, shots, seen)));
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
        "закрытый режим и гость — без запросов, noindex; «My account» → /account; почта, «Verified», пароль, Google, письма по умолчанию; имя — «Name saved», «Your Plan», «Undo», пустое — ошибка; фото — обрезка, видно в кабинете и в кнопке, «Undo», маленькое — ошибка; новости после перезагрузки; почта — Esc и фокус, неверный пароль, код вторым шагом, неверный код, «Email changed», письмо на прежнюю; пароль — неверный текущий, вход после перезагрузки, письмо; Google — адрес и отказ; удаление — чужая почта, главная, «Log In», прежний пароль не входит; телефон — шторка; axe в обеих темах; CSP",
      )
    : fail(problems.slice(0, 5).join("; "));
}

/**
 * Контрольная поломка: сервис не отдаёт файл фото — строка обязана заметить «фото не загрузилось».
 * Остальные адреса фото (загрузка, «Undo», «Remove») идут как обычно.
 */
export async function spoilPhoto(
  context: BrowserContext,
  origin: string,
): Promise<void> {
  await context.route(`${origin}/api/account/photo/**`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 401, body: "" })
      : route.fallback(),
  );
}

/**
 * Контрольная поломка: сервис меняет пароль, но новая cookie сеанса до браузера не доходит (как если бы
 * ответ Better Auth собирали заново без Set-Cookie) — «после смены пароля вход потерян» обязана заметить.
 */
export async function spoilPasswordCookie(
  context: BrowserContext,
  origin: string,
): Promise<void> {
  await context.route(
    `${origin}/api/account/password/change`,
    async (route) => {
      const request = route.request();
      const all = await request.allHeaders();
      const headers: Record<string, string> = {};
      for (const key of [
        "cookie",
        "origin",
        "content-type",
        "x-iconavo-locale",
      ]) {
        const value = all[key];
        if (value !== undefined) headers[key] = value;
      }
      const data = request.postDataBuffer();
      const res = await fetch(request.url(), {
        method: request.method(),
        headers,
        ...(data === null ? {} : { body: new Uint8Array(data) }),
      });
      const back: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        if (key !== "set-cookie") back[key] = value;
      });
      await route.fulfill({
        status: res.status,
        headers: back,
        body: Buffer.from(await res.arrayBuffer()),
      });
    },
  );
}

/** Сценарий контрольного запуска: регистрация, кабинет и одна его часть. */
export async function cabinetCanaryProblems(
  page: Page,
  o: AccountCheckOptions,
  email: string,
  part: "photo" | "password",
): Promise<string[]> {
  await register(page, o, email);
  await openCabinet(page);
  return part === "photo"
    ? profileProblems(page)
    : passwordProblems(page, o, email);
}
