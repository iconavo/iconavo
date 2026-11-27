// Вход в проверке сайта (шаг 3 фазы 5, PR 3; ADR-0055): окно входа против превью сервиса аккаунтов — с его
// базой node:sqlite, письмами в памяти, подставным Turnstile (скрипт /__preview/turnstile.js и проверка
// ответа) и подставным Google (переход к Google перехватывается, возврат с ошибкой — как у Google).
//
// Сценарий на компьютере: в закрытом режиме — «Soon» и ни одного запроса к сервису; ?accounts=on — «Log In»,
// гость сервис не спрашивает; окно — фокус в поле, Esc и фокус назад; регистрация: почта → Turnstile → код
// (неверный — ошибка) → короткий пароль — ошибка → пароль → «You’re all set», аватар и «Logged in as»;
// перезагрузка — тот же вход одним запросом сеанса; меню и выход — сообщение, «Log In», фокус; почта
// занята; три неверных пароля → четвёртый вход с Turnstile; восстановление кодом → вход новым паролем;
// Google — адрес Google с ключом и адресом возврата сервиса, отказ Google → окно с ошибкой. Плюс axe в
// обеих темах, телефон (шторка окна и меню) и CSP. Контрольный запуск портит Turnstile и память о входе.

import type { Browser, BrowserContext, Page } from "playwright";
import { PREVIEW_GOOGLE_CLIENT } from "../account/config.js";
import type { PreviewMail } from "../account/preview.js";
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
import { DESKTOP, PANEL_WAIT_MS, PHONE } from "./config.js";
import { hydrated } from "./panel.js";

export interface AccountCheckOptions {
  base: string;
  /** Превью сервиса аккаунтов: адрес и письма по порядку. */
  account?: {
    origin: string;
    mail: () => readonly PreviewMail[];
  };
}

/** Пометка «здесь входили» сайта (apps/site/lib/account.ts). */
export const SIGNED_KEY = "iconavo-signed-in";

const WAIT = PANEL_WAIT_MS;
export const PASSWORD = "correct horse 1";
export const NEW_PASSWORD = "brand new pass 2";
const WRONG = "wrong password 0";

export type Shots = { title: string; png: string }[];

export interface Sent {
  path: string;
  method: string;
  captcha: boolean;
}

/** Запросы страницы к сервису: адрес, метод, был ли ответ Turnstile. */
export function accountRequests(page: Page, origin: string): Sent[] {
  const list: Sent[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(origin) || r.method() === "OPTIONS") return;
    list.push({
      path: new URL(r.url()).pathname,
      method: r.method(),
      captcha: r.headers()["x-captcha-response"] !== undefined,
    });
  });
  return list;
}

/** Код из письма на почту — среди писем после n-го. */
export async function codeFor(
  o: AccountCheckOptions,
  email: string,
  after: number,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const mail = o.account?.mail() ?? [];
    for (let i = mail.length - 1; i >= after; i--) {
      const m = mail[i];
      const code = m?.to === email ? /\b\d{6}\b/.exec(m.subject)?.[0] : "";
      if (code) return code;
    }
    if (Date.now() > deadline)
      throw new Error(`нет письма с кодом на ${email}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const open = "dialog.auth-dialog[open]";

/** Окно на этом экране. */
const screenIs = (page: Page, screen: string) =>
  page.locator(`${open}[data-screen="${screen}"]`).waitFor({ timeout: WAIT });

/** Окно перешло на экран — или показало ошибку: тогда её текст. */
async function reached(
  page: Page,
  screen: string,
): Promise<string | undefined> {
  const outcome = await Promise.race([
    screenIs(page, screen).then(
      () => "screen",
      () => "timeout",
    ),
    errorText(page)
      .waitFor({ timeout: WAIT })
      .then(
        () => "error",
        () => "timeout",
      ),
  ]);
  if (outcome === "screen") return undefined;
  const text = await errorText(page)
    .textContent({ timeout: 1_000 })
    .catch(() => null);
  return text ?? "ни экрана, ни ошибки";
}

const closedDialog = (page: Page) =>
  page.waitForFunction(
    () =>
      document.querySelector<HTMLDialogElement>("dialog.auth-dialog")?.open !==
      true,
    undefined,
    { timeout: WAIT },
  );

const emailInput = (page: Page) =>
  page.locator(`${open} input.auth-field-input[type="email"]`);
const passwordInput = (page: Page) =>
  page.locator(`${open} input.auth-field-input[autocomplete$="password"]`);
const primary = (page: Page) => page.locator(`${open} button.auth-primary`);
const footerLink = (page: Page) =>
  page.locator(`${open} .auth-footer button.auth-link`);
const errorText = (page: Page) =>
  page.locator(`${open} .auth-note-error`).first();

/** id элемента в фокусе (и в окне ли он). */
export const focused = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return {
      id: a?.id ?? "",
      tag: a?.tagName ?? "",
      type: a instanceof HTMLInputElement ? a.type : "",
      inDialog: a?.closest("dialog.auth-dialog") !== null,
    };
  });

/** Анимации появления закончились (бесконечные — каретка — не в счёт): снимок — уже готового окна. */
export const settle = (page: Page) =>
  page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== "running" ||
              a.effect?.getComputedTiming().iterations ===
                Number.POSITIVE_INFINITY,
          ),
      undefined,
      { timeout: 3_000 },
    )
    .catch(() => {});

/** Снимок после анимаций. */
export async function photo(
  page: Page,
  seen: { errors: string[] },
  shots: Shots,
  title: string,
): Promise<void> {
  await settle(page);
  shots.push({ title, png: await shot(page, seen) });
}

/** Сколько раз подставной Turnstile рисовал виджет. */
const turnstileRenders = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __previewTurnstile?: number })
        .__previewTurnstile ?? 0,
  );

/** Интерфейс аккаунтов включён (?accounts=on), страница готова. */
export async function enable(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/?accounts=on`);
  await hydrated(page);
  await page
    .locator("#account-log-in, #account-button")
    .first()
    .waitFor({ timeout: WAIT });
}

async function openLogIn(page: Page): Promise<void> {
  await page.locator("#account-log-in").click();
  await screenIs(page, "login");
}

/** Выйти через меню аккаунта. */
export async function logOut(page: Page): Promise<void> {
  await page.locator("#account-button").click();
  await page
    .locator(".account-menu .account-menu-item", { hasText: "Log Out" })
    .click();
  await page.locator("#account-log-in").waitFor({ timeout: WAIT });
}

/** Регистрация коротким путём (кабинет, PR 4): «Log In» → «Sign up» → почта → код → пароль → готово. */
export async function register(
  page: Page,
  o: AccountCheckOptions,
  email: string,
  password = PASSWORD,
): Promise<void> {
  const account = o.account;
  if (account === undefined) throw new Error("нет превью сервиса аккаунтов");
  await enable(page, o.base);
  await openLogIn(page);
  await footerLink(page).click();
  await screenIs(page, "signup");
  await emailInput(page).fill(email);
  const before = account.mail().length;
  await primary(page).click();
  const refused = await reached(page, "signup-code");
  if (refused !== undefined) throw new Error(`регистрация: «${refused}»`);
  await page
    .locator(`${open} input.auth-code-input`)
    .fill(await codeFor(o, email, before));
  await primary(page).click();
  await screenIs(page, "signup-password");
  await passwordInput(page).fill(password);
  await primary(page).click();
  await screenIs(page, "signup-done");
  await primary(page).click();
  await closedDialog(page);
}

/** Войти почтой и паролем; true — вошли. */
export async function logIn(
  page: Page,
  email: string,
  password: string,
): Promise<boolean> {
  await openLogIn(page);
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
  await primary(page).click();
  // Вошли — кнопка аккаунта; нет — ошибка в окне (ждать весь срок не нужно).
  const outcome = await Promise.race([
    page
      .locator("#account-button")
      .waitFor({ timeout: WAIT })
      .then(
        () => "in",
        () => "timeout",
      ),
    errorText(page)
      .waitFor({ timeout: WAIT })
      .then(
        () => "error",
        () => "timeout",
      ),
  ]);
  return outcome === "in";
}

/**
 * Регистрация от «Log In» до «You’re all set» и перезагрузка. Общая с контрольным запуском: порча
 * Turnstile или памяти о входе ломает её.
 */
export async function signUpProblems(
  page: Page,
  o: AccountCheckOptions,
  email: string,
  shots?: Shots,
  seen?: { errors: string[] },
): Promise<string[]> {
  const account = o.account;
  if (account === undefined) return ["у проверки нет превью сервиса аккаунтов"];
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const sent = accountRequests(page, account.origin);
  await enable(page, o.base);
  await page
    .waitForFunction(() => !location.search.includes("accounts="), undefined, {
      timeout: WAIT,
    })
    .catch(() => problems.push("?accounts=on осталось в адресе"));
  no(
    await page.locator("#account-log-in").isVisible(),
    "после ?accounts=on нет кнопки «Log In»",
  );
  await page.waitForTimeout(300);
  no(
    sent.length === 0,
    `гость спросил сервис: ${sent.map((s) => s.path).join(", ")}`,
  );

  // Окно: фокус в поле почты, Esc закрывает, фокус — на «Log In».
  await openLogIn(page);
  const first = await focused(page);
  no(
    first.inDialog && first.type === "email",
    `при открытии фокус не в поле почты: ${first.tag} ${first.type}`,
  );
  if (shots !== undefined && seen !== undefined) {
    await photo(page, seen, shots, "Окно входа");
  }
  await page.keyboard.press("Escape");
  await closedDialog(page);
  await page.waitForTimeout(100);
  no(
    (await focused(page)).id === "account-log-in",
    `после Esc фокус не на «Log In»: ${(await focused(page)).tag}`,
  );

  // Регистрация: почта → Turnstile → код.
  await openLogIn(page);
  await footerLink(page).click();
  await screenIs(page, "signup");
  await emailInput(page).fill(email);
  const mailBefore = account.mail().length;
  const renders = await turnstileRenders(page);
  await primary(page).click();
  const refused = await reached(page, "signup-code");
  if (refused !== undefined) {
    return [...problems, `регистрация не дошла до кода: «${refused}»`];
  }
  no(
    (await turnstileRenders(page)) > renders,
    "перед регистрацией Turnstile не рисовался",
  );
  const signUp = sent.filter((s) => s.path === "/api/account/sign-up");
  no(
    signUp.length === 1 && signUp[0]?.captcha === true,
    `регистрация ушла без ответа Turnstile или не один раз: ${JSON.stringify(signUp)}`,
  );
  const resend =
    (await page.locator(`${open} .auth-resend`).textContent()) ?? "";
  no(
    /Resend in 0:[0-5]\d/.test(resend),
    `нет отсчёта «Resend in 0:59»: «${resend}»`,
  );
  const code = await codeFor(o, email, mailBefore);
  const wrong = code === "000000" ? "111111" : "000000";
  await page.locator(`${open} input.auth-code-input`).fill(wrong);
  await primary(page).click();
  await errorText(page).waitFor({ timeout: WAIT });
  const wrongText = (await errorText(page).textContent()) ?? "";
  no(
    wrongText.startsWith("Wrong code"),
    `неверный код: «${wrongText}» вместо «Wrong code…»`,
  );
  if (shots !== undefined && seen !== undefined) {
    await photo(page, seen, shots, "Неверный код");
  }
  await page.locator(`${open} input.auth-code-input`).fill(code);
  await primary(page).click();
  await screenIs(page, "signup-password");

  // Пароль: короткий — ошибка, нормальный — «You’re all set».
  await passwordInput(page).fill("short");
  await primary(page).click();
  await errorText(page).waitFor({ timeout: WAIT });
  no(
    ((await errorText(page).textContent()) ?? "").includes("8 to 128"),
    "короткий пароль принят без ошибки «Use 8 to 128 characters»",
  );
  await passwordInput(page).fill(PASSWORD);
  await primary(page).click();
  await screenIs(page, "signup-done");
  no(
    ((await page.locator(open).textContent()) ?? "").includes(email),
    "на «You’re all set» нет почты",
  );
  await page.locator("#account-button").waitFor({ timeout: WAIT });
  if (shots !== undefined && seen !== undefined) {
    await photo(page, seen, shots, "Регистрация готова");
  }
  await primary(page).click();
  await closedDialog(page);
  await page.waitForTimeout(100);
  no(
    (await focused(page)).id === "account-button",
    "после «Start exploring» фокус не на кнопке аккаунта",
  );
  const avatar = (await page.locator("#account-button").textContent()) ?? "";
  no(
    avatar.trim() === email[0]?.toUpperCase(),
    `буква аватара — «${avatar.trim()}», а не «${email[0]?.toUpperCase()}»`,
  );
  const plan =
    (await page.locator(".sidebar-plan .account-plan-name").textContent()) ??
    "";
  no(plan === email, `в «Your Plan» — «${plan}», а не почта`);

  // Перезагрузка: тот же вход, одним запросом сеанса.
  const before = sent.length;
  await page.reload();
  await hydrated(page);
  const back = await page
    .locator("#account-button")
    .waitFor({ timeout: WAIT })
    .then(
      () => true,
      () => false,
    );
  no(back, "после перезагрузки вход потерян");
  const sessions = sent
    .slice(before)
    .filter((s) => s.path === "/api/auth/get-session").length;
  no(
    sessions === 1,
    `после перезагрузки запросов сеанса — ${sessions}, а не 1`,
  );
  return problems;
}

/** Меню, выход, занятая почта, три неверных пароля и Turnstile, восстановление, Google. */
async function afterSignUpProblems(
  page: Page,
  o: AccountCheckOptions,
  email: string,
  shots: Shots,
  seen: { errors: string[] },
): Promise<string[]> {
  const account = o.account;
  if (account === undefined) return [];
  const problems: string[] = [];
  const no = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const sent = accountRequests(page, account.origin);

  // Меню аккаунта и выход.
  await page.locator("#account-button").click();
  const menu = page.locator(".account-menu");
  await menu.waitFor({ timeout: WAIT });
  const items = (await menu.locator(".account-menu-item").allTextContents())
    .map((x) => x.trim())
    .join(" | ");
  for (const item of [
    "My account",
    "Help center",
    "Send feedback",
    "Log Out",
  ]) {
    no(items.includes(item), `в меню нет «${item}»: ${items}`);
  }
  const help = menu.locator("a.account-menu-item", { hasText: "Help center" });
  no(
    (await help.getAttribute("href")) === "/docs" &&
      (await help.getAttribute("target")) === "_blank",
    "«Help center» — не документация в новой вкладке",
  );
  const mine = menu.locator("a.account-menu-item", { hasText: "My account" });
  no(
    (await mine.getAttribute("href")) === "/account" &&
      (await mine.getAttribute("target")) === null,
    "«My account» — не страница /account в этой вкладке",
  );
  no(
    ((await menu.textContent()) ?? "").includes(email),
    "в меню нет «Logged in as» с почтой",
  );
  await photo(page, seen, shots, "Меню аккаунта");
  await menu.locator(".account-menu-item", { hasText: "Log Out" }).click();
  const toast = await page
    .locator(".toast", { hasText: "You’re logged out" })
    .waitFor({ timeout: WAIT })
    .then(
      () => true,
      () => false,
    );
  no(toast, "после выхода нет сообщения «You’re logged out»");
  await page.locator("#account-log-in").waitFor({ timeout: WAIT });
  await page.waitForTimeout(100);
  no(
    (await focused(page)).id === "account-log-in",
    "после выхода фокус не на «Log In»",
  );
  no(
    (await page.evaluate((key) => localStorage.getItem(key), SIGNED_KEY)) ===
      null,
    "после выхода браузер помнит вход",
  );
  no(
    sent.some((s) => s.path === "/api/auth/sign-out" && s.method === "POST"),
    "выход не дошёл до сервиса",
  );

  // Почта занята.
  await openLogIn(page);
  await footerLink(page).click();
  await screenIs(page, "signup");
  await emailInput(page).fill(email);
  await primary(page).click();
  await errorText(page).waitFor({ timeout: WAIT });
  const taken = (await errorText(page).textContent()) ?? "";
  no(
    taken === "An account with this email already exists",
    `занятая почта: «${taken}»`,
  );
  await page.keyboard.press("Escape");
  await closedDialog(page);

  // Три неверных пароля — четвёртый вход только с Turnstile.
  await openLogIn(page);
  await emailInput(page).fill(email);
  for (let i = 0; i < 3; i++) {
    await passwordInput(page).fill(WRONG);
    const reply = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/sign-in/email") &&
        r.request().method() === "POST",
      { timeout: WAIT },
    );
    await primary(page).click();
    await reply;
    await errorText(page).waitFor({ timeout: WAIT });
  }
  const wrongText = (await errorText(page).textContent()) ?? "";
  no(
    wrongText === "Incorrect email or password",
    `неверный пароль: «${wrongText}»`,
  );
  await photo(page, seen, shots, "Неверный пароль");
  const renders = await turnstileRenders(page);
  await passwordInput(page).fill(PASSWORD);
  await primary(page).click();
  await page.locator("#account-button").waitFor({ timeout: WAIT });
  await closedDialog(page);
  const signIns = sent.filter((s) => s.path === "/api/auth/sign-in/email");
  no(
    signIns.length === 4 &&
      signIns.slice(0, 3).every((s) => !s.captcha) &&
      signIns[3]?.captcha === true,
    `входы и Turnstile: ${JSON.stringify(signIns.map((s) => s.captcha))} — ждали [false, false, false, true]`,
  );
  no(
    (await turnstileRenders(page)) > renders,
    "перед четвёртым входом Turnstile не рисовался",
  );

  // Восстановление: почта → код → новый пароль → «Password Updated» и вход.
  await logOut(page);
  await openLogIn(page);
  await page.locator(`${open} button.auth-forgot`).click();
  await screenIs(page, "reset");
  await emailInput(page).fill(email);
  const mailBefore = account.mail().length;
  await primary(page).click();
  await screenIs(page, "reset-code");
  no(
    sent.some(
      (s) =>
        s.path === "/api/auth/email-otp/request-password-reset" && s.captcha,
    ),
    "новый пароль запрошен без Turnstile",
  );
  const code = await codeFor(o, email, mailBefore);
  await page.locator(`${open} input.auth-code-input`).fill(code);
  await primary(page).click();
  await screenIs(page, "reset-password");
  await passwordInput(page).fill(NEW_PASSWORD);
  await primary(page).click();
  await screenIs(page, "reset-done");
  await page.locator("#account-button").waitFor({ timeout: WAIT });
  await primary(page).click();
  await closedDialog(page);

  // Google: адрес Google собирает сервис; отказ Google возвращает на страницу с ошибкой в окне.
  await logOut(page);
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Google</title><p>Google",
    }),
  );
  await openLogIn(page);
  await Promise.all([
    page.waitForURL(/^https:\/\/accounts\.google\.com\//, { timeout: WAIT }),
    page.locator(`${open} button.auth-google`).click(),
  ]);
  const google = new URL(page.url());
  no(
    google.searchParams.get("client_id") === PREVIEW_GOOGLE_CLIENT,
    `у адреса Google не тот client_id: ${google.searchParams.get("client_id")}`,
  );
  no(
    google.searchParams.get("redirect_uri") ===
      `${account.origin}/api/auth/callback/google`,
    `у адреса Google не тот redirect_uri: ${google.searchParams.get("redirect_uri")}`,
  );
  const state = google.searchParams.get("state") ?? "";
  await page.goto(
    `${account.origin}/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state)}`,
  );
  await page.waitForURL((url) => url.href.startsWith(o.base), {
    timeout: WAIT,
  });
  await hydrated(page);
  await screenIs(page, "login");
  await errorText(page).waitFor({ timeout: WAIT });
  no(
    ((await errorText(page).textContent()) ?? "").startsWith(
      "Couldn’t log in with Google",
    ),
    `после отказа Google: «${await errorText(page).textContent()}»`,
  );
  await page
    .waitForFunction(
      () => !/[?&](account|error)=/.test(location.search),
      undefined,
      { timeout: WAIT },
    )
    .catch(() =>
      problems.push(`после Google в адресе остался возврат: ${page.url()}`),
    );
  await page.keyboard.press("Escape");
  await closedDialog(page);
  return problems;
}

/** В закрытом режиме — «Soon» и ни одного запроса к сервису. */
async function closedProblems(
  browser: Browser,
  o: AccountCheckOptions,
): Promise<string[]> {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const sent = accountRequests(page, o.account?.origin ?? "-");
  await page.goto(o.base);
  await hydrated(page);
  await page.waitForTimeout(500);
  const problems: string[] = [];
  if ((await page.locator(".topbar .topbar-account.soon").count()) !== 1) {
    problems.push("в закрытом режиме кнопка аккаунта — не «Soon»");
  }
  if ((await page.locator("#account-log-in").count()) !== 0) {
    problems.push("в закрытом режиме видна «Log In»");
  }
  if (sent.length > 0) {
    problems.push(
      `в закрытом режиме страница спросила сервис: ${sent.map((s) => s.path).join(", ")}`,
    );
  }
  await context.close();
  return problems;
}

/** Телефон: окно — шторка во всю ширину снизу, меню аккаунта — шторка. */
async function phoneProblems(
  browser: Browser,
  o: AccountCheckOptions,
  email: string,
  shots: Shots,
): Promise<string[]> {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const problems: string[] = [];
  await enable(page, o.base);
  await openLogIn(page);
  await settle(page);
  const box = await page.evaluate(() => {
    const r = document
      .querySelector("dialog.auth-dialog")
      ?.getBoundingClientRect();
    return r === undefined
      ? null
      : {
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          wide: document.documentElement.scrollWidth > innerWidth,
          // Ширина страницы без места под полосу прокрутки (у WebKit его вычитает clientWidth) и окна:
          // шторка — от левого края до правого края страницы или окна.
          width: document.documentElement.clientWidth,
          viewport: innerWidth,
          height: innerHeight,
        };
  });
  if (
    box === null ||
    box.wide ||
    Math.abs(box.left) > 1 ||
    box.right < box.width - 1 ||
    box.right > box.viewport + 1 ||
    Math.abs(box.bottom - box.height) > 1
  ) {
    problems.push(`на телефоне окно — не шторка снизу: ${JSON.stringify(box)}`);
  }
  await photo(page, seen, shots, "Окно входа на телефоне");
  await emailInput(page).fill(email);
  await passwordInput(page).fill(NEW_PASSWORD);
  await primary(page).click();
  await page.locator("#account-button").waitFor({ timeout: WAIT });
  await closedDialog(page);
  await page.locator("#account-button").click();
  const sheet = page.locator("dialog.account-sheet[open]");
  const opened = await sheet.waitFor({ timeout: WAIT }).then(
    () => true,
    () => false,
  );
  if (!opened) problems.push("на телефоне меню аккаунта — не шторка");
  else {
    await photo(page, seen, shots, "Меню аккаунта на телефоне");
    await sheet.locator("button.account-sheet-grabber").click();
    await page
      .waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("dialog.account-sheet")
            ?.open !== true,
        undefined,
        { timeout: WAIT },
      )
      .catch(() => problems.push("ручка не закрывает шторку меню"));
  }
  problems.push(
    ...(await allViolations(page)).map((x) => `телефон, CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `телефон, ошибка: ${x}`),
  );
  await context.close();
  return problems;
}

/** axe с открытым окном в светлой и тёмной теме. */
async function accessProblems(
  browser: Browser,
  o: AccountCheckOptions,
): Promise<string[]> {
  const pages: { path: string; violations: AxeViolation[] }[] = [];
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: DESKTOP,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await enable(page, o.base);
    await openLogIn(page);
    // Пока окно проявляется, цвета полупрозрачные — контраст мерить рано.
    await settle(page);
    await runAxe(page, await axe(), `окно входа, ${scheme}`, pages);
    await footerLink(page).click();
    await screenIs(page, "signup");
    await settle(page);
    await runAxe(page, await axe(), `регистрация, ${scheme}`, pages);
    await context.close();
  }
  const verdict = axeVerdict(pages);
  return verdict.ok === false ? [`axe: ${verdict.note}`] : [];
}

/** Строка «Вход». */
export async function checkAccount(
  browser: Browser,
  name: string,
  o: AccountCheckOptions,
  shots: Shots,
): Promise<Verdict> {
  if (o.account === undefined)
    return fail("у проверки нет превью сервиса аккаунтов");
  const email = `${name}-ann@example.com`;
  const problems = await closedProblems(browser, o);
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const seen = watch(page);
  await recordViolations(page);
  const run = async (title: string, scenario: () => Promise<string[]>) =>
    problems.push(
      ...(await scenario().catch((e: Error) => [
        `${title} остановился: ${e.message.split("\n")[0]}`,
      ])),
    );
  await run("вход", () => signUpProblems(page, o, email, shots, seen));
  await run("после входа", () =>
    afterSignUpProblems(page, o, email, shots, seen),
  );
  problems.push(
    ...(await allViolations(page)).map((x) => `CSP: ${x}`),
    ...[...new Set(seen.errors)].map((x) => `ошибка: ${x}`),
  );
  await context.close();
  await run("телефон", () => phoneProblems(browser, o, email, shots));
  await run("axe", () => accessProblems(browser, o));
  return problems.length === 0
    ? pass(
        "закрытый режим — «Soon» без запросов; ?accounts=on — «Log In», гость сервис не спрашивает; окно: фокус в поле, Esc; регистрация: Turnstile, неверный код, короткий пароль, «You’re all set», аватар и «Logged in as», перезагрузка — один запрос сеанса; меню, выход и сообщение; почта занята; три неверных пароля → вход с Turnstile; восстановление кодом и вход новым паролем; Google — адрес с ключом и возвратом, отказ — ошибка в окне; телефон — шторки окна и меню; axe в обеих темах; CSP",
      )
    : fail(problems.slice(0, 5).join("; "));
}

/** Контрольная поломка: ответ Turnstile не уходит в сервис — регистрация обязана упасть. */
export async function spoilCaptcha(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const send = window.fetch;
    window.fetch = function (input, init) {
      const headers = init?.headers;
      if (
        headers !== undefined &&
        !(headers instanceof Headers) &&
        !Array.isArray(headers)
      ) {
        const copy = { ...headers } as Record<string, string>;
        delete copy["x-captcha-response"];
        return send.call(this, input, { ...init, headers: copy });
      }
      return send.call(this, input, init);
    };
  });
}

/** Контрольная поломка: браузер не помнит «здесь входили» — перезагрузка обязана потерять вход. */
export async function spoilSignedMemory(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k !== key) set.call(this, k, value);
    };
  }, SIGNED_KEY);
}
