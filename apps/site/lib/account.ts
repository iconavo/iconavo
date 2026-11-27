// Аккаунт на сайте (шаг 3 фазы 5, PR 3; ADR-0055): свой маленький клиент сервиса account.iconavo.dev —
// запросы с cookie (credentials: "include"), без клиента Better Auth. Сайт статический (ADR-0039):
// - гость сервис не спрашивает — браузер помнит только «здесь входили» (SIGNED_KEY) и лишь тогда узнаёт,
//   кто вошёл;
// - закрытый режим до /security-review (решение владельца 27 ноября 2026): у всех кнопка аккаунта —
//   «Soon», у владельца интерфейс включает ссылка ?accounts=on (браузер её помнит, ?accounts=off —
//   выключить); сервис всё равно регистрирует только почты из списка;
// - cookie сеанса сайту недоступна (HttpOnly у account.iconavo.dev): из ответов сайт берёт только почту
//   и имя.
// Окно входа (components/account/AuthDialog.tsx) и меню аккаунта ходят в сервис только через этот модуль.

import { useSyncExternalStore } from "react";
import {
  ACCOUNTS_OPEN,
  accountUrl,
  DEFAULT_ACCOUNT,
  DEFAULT_TURNSTILE,
} from "./account-config";
import type { Dictionary, Lang } from "./i18n";
import { menuStore } from "./menu";
import { createPanelStore } from "./panel-store";
import { touchesKey } from "./storage-event";

function env(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Сервис аккаунтов: свой — у проверки сайта и pnpm site --account (превью), иначе живой. */
export const ACCOUNT = accountUrl(
  env(() => process.env.NEXT_PUBLIC_ICONAVO_ACCOUNT),
  DEFAULT_ACCOUNT,
);

/** Скрипт Turnstile: у проверки — подставной из превью сервиса, иначе Cloudflare. */
export const TURNSTILE_SCRIPT = accountUrl(
  env(() => process.env.NEXT_PUBLIC_ICONAVO_TURNSTILE),
  DEFAULT_TURNSTILE,
);

/** localStorage: «on» — интерфейс аккаунтов включён в закрытом режиме. */
export const ACCOUNTS_KEY = "iconavo-accounts";
/** localStorage: в этом браузере входили — после загрузки спросить сервис, кто вошёл. */
export const SIGNED_KEY = "iconavo-signed-in";
/** ?accounts=on|off — включить или выключить интерфейс в закрытом режиме. */
export const ACCOUNTS_PARAM = "accounts";
/** ?account=welcome|google-error — возврат после Google (новый аккаунт или ошибка). */
export const RETURN_PARAM = "account";

/** Заголовки сервиса (apps/account/src/config.ts, http.ts). */
const CAPTCHA_HEADER = "x-captcha-response";
const LOCALE_HEADER = "x-iconavo-locale";
const CAPTCHA_STATE_HEADER = "x-iconavo-captcha";

/** Пределы сервиса: код — 6 цифр, повтор письма — через минуту, пароль — 8…128 знаков. */
export const CODE_LENGTH = 6;
export const RESEND_SECONDS = 60;
export const PASSWORD = { min: 8, max: 128 } as const;

/** Почта — как её принимает сервис (apps/account/src/account.ts, emailOf). */
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>".]{2,}$/;

export const normalEmail = (value: string): string =>
  value.trim().toLowerCase();

export function validEmail(value: string): boolean {
  const email = normalEmail(value);
  return email.length <= 254 && EMAIL.test(email);
}

/** Только цифры кода, не больше шести: вставка «482 913» и «482-913» тоже годится. */
export const digitsOnly = (value: string): string =>
  value.replace(/\D/g, "").slice(0, CODE_LENGTH);

/** Сколько секунд ждать повторной отправки кода. */
export const secondsLeft = (sentAt: number, now: number): number =>
  Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000));

/** 59 → «0:59». */
export const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export interface AccountUser {
  email: string;
  name: string;
  /** Адрес фото у сервиса (PR 4); нет фото — буква. */
  photo?: string;
}

/** Ключ фото из сеанса (photos/{человек}/{имя}) → адрес файла у сервиса; другое — нет фото. */
export function photoOf(key: unknown): string | undefined {
  if (typeof key !== "string") return undefined;
  const name = key.slice(key.lastIndexOf("/") + 1);
  return /^[0-9a-f]{32}\.(png|jpg)$/.test(name)
    ? `${ACCOUNT}/api/account/photo/${name}`
    : undefined;
}

/** Буква аватара без фото (решение владельца 27 ноября 2026): первая буква имени, иначе почты. */
export function initialOf(user: Pick<AccountUser, "email" | "name">): string {
  for (const source of [user.name, user.email]) {
    const first = Array.from(source.trim())[0];
    if (first !== undefined && /[\p{L}\p{N}]/u.test(first)) {
      return first.toLocaleUpperCase();
    }
  }
  return "?";
}

/** Из ответа сервиса — только почта, имя и фото. */
export function userOf(data: unknown): AccountUser | undefined {
  const user = (
    data as {
      user?: { email?: unknown; name?: unknown; photo?: unknown };
    } | null
  )?.user;
  if (typeof user?.email !== "string" || user.email === "") return undefined;
  const photo = photoOf(user.photo);
  return {
    email: user.email,
    name: typeof user.name === "string" ? user.name : "",
    ...(photo === undefined ? {} : { photo }),
  };
}

/** ?accounts=on|off в адресе. */
export function accountsSwitch(search: string): "on" | "off" | undefined {
  const value = new URLSearchParams(search).get(ACCOUNTS_PARAM);
  return value === "on" || value === "off" ? value : undefined;
}

/**
 * Возврат после Google: вход — новый аккаунт или ошибка с кодом Better Auth; подключение в кабинете
 * (PR 4) — подключён или ошибка.
 */
export type GoogleReturn =
  | { kind: "welcome" }
  | { kind: "error"; code: string }
  | { kind: "linked" }
  | { kind: "link-error"; code: string };

export function googleReturn(search: string): GoogleReturn | undefined {
  const params = new URLSearchParams(search);
  const value = params.get(RETURN_PARAM);
  if (value === "welcome") return { kind: "welcome" };
  if (value === "linked") return { kind: "linked" };
  if (value === "google-error" || value === "link-error") {
    return {
      kind: value === "google-error" ? "error" : "link-error",
      code: params.get("error") ?? "",
    };
  }
  return undefined;
}

/** Куда вернуться после подключения Google в кабинете: на эту же страницу, с отметкой исхода. */
export function linkUrls(href: string): {
  callbackURL: string;
  errorCallbackURL: string;
} {
  const base = new URL(withoutAccountParams(href));
  base.hash = "";
  const make = (value: string) => {
    const url = new URL(base);
    url.searchParams.set(RETURN_PARAM, value);
    return url.toString();
  };
  return { callbackURL: make("linked"), errorCallbackURL: make("link-error") };
}

/**
 * Адрес без служебных параметров аккаунта: ?accounts= и возврата после Google (с error и
 * error_description, которые дописывает Better Auth). В ссылке, которой поделятся, их быть не должно.
 */
export function withoutAccountParams(href: string): string {
  const url = new URL(href);
  const back = url.searchParams.has(RETURN_PARAM);
  const names = back
    ? [ACCOUNTS_PARAM, RETURN_PARAM, "error", "error_description"]
    : [ACCOUNTS_PARAM];
  if (!names.some((name) => url.searchParams.has(name))) return href;
  for (const name of names) url.searchParams.delete(name);
  return url.toString();
}

/**
 * Куда вернуться после Google: на эту же страницу (сервис пускает только страницы сайта), новый аккаунт —
 * с ?account=welcome (окно «You’re all set»), ошибка — с ?account=google-error (Better Auth допишет код).
 */
export function googleUrls(href: string): {
  callbackURL: string;
  errorCallbackURL: string;
  newUserCallbackURL: string;
} {
  const base = new URL(withoutAccountParams(href));
  base.hash = "";
  const make = (value?: string) => {
    const url = new URL(base);
    if (value !== undefined) url.searchParams.set(RETURN_PARAM, value);
    return url.toString();
  };
  return {
    callbackURL: make(),
    errorCallbackURL: make("google-error"),
    newUserCallbackURL: make("welcome"),
  };
}

export interface Reply<T = unknown> {
  ok: boolean;
  /** 0 — сервис не ответил (сеть). */
  status: number;
  /** Код ошибки сервиса ({ code } у Better Auth и своих адресов); у успеха — пустой. */
  code: string;
  data: T | null;
  /** Сервис просит Turnstile к следующему входу (заголовок x-iconavo-captcha). */
  captcha: boolean;
}

export interface RequestOptions {
  body?: Record<string, unknown>;
  /** Тело картинкой (фото профиля, PR 4) вместо JSON. */
  image?: Blob;
  /** Тело формой multipart (обратная связь, PR 6а): тип с границей ставит сам браузер. */
  form?: FormData;
  /** Ответ виджета Turnstile. */
  captcha?: string;
  /** Язык писем: язык страницы. */
  locale?: Lang;
  fetchFn?: typeof fetch;
}

/** Запрос к сервису с cookie: тело — JSON; сбой сети — status 0 и код NETWORK. */
export async function request<T = unknown>(
  path: string,
  o: RequestOptions = {},
): Promise<Reply<T>> {
  const post =
    o.body !== undefined || o.image !== undefined || o.form !== undefined;
  const headers: Record<string, string> = {};
  if (post && o.form === undefined) {
    headers["content-type"] = o.image?.type || "application/json";
  }
  if (o.captcha !== undefined) headers[CAPTCHA_HEADER] = o.captcha;
  if (o.locale !== undefined) headers[LOCALE_HEADER] = o.locale;
  let res: Response;
  try {
    res = await (o.fetchFn ?? fetch)(`${ACCOUNT}${path}`, {
      method: post ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      headers,
      ...(post
        ? { body: o.form ?? o.image ?? JSON.stringify(o.body ?? {}) }
        : {}),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK",
      data: null,
      captcha: false,
    };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const own = (data as { code?: unknown } | null)?.code;
  return {
    ok: res.ok,
    status: res.status,
    code: res.ok
      ? ""
      : res.status === 429
        ? "RATE_LIMITED"
        : typeof own === "string"
          ? own
          : `HTTP_${res.status}`,
    data: res.ok ? (data as T) : null,
    captcha: res.headers.get(CAPTCHA_STATE_HEADER) === "required",
  };
}

/** Ответ виджета Turnstile; не вышло — ошибка. */
export type Solve = () => Promise<string>;

/**
 * Запрос, которому может понадобиться Turnstile: first — решить сразу (регистрация, новый пароль, вход после
 * трёх неудач); иначе — без него, а на 403 CAPTCHA_REQUIRED — решить и повторить. Ответ не приняли —
 * ещё одна попытка с новым ответом виджета, дальше — ошибка CAPTCHA_REQUIRED.
 */
export async function withCaptcha<T>(
  send: (captcha?: string) => Promise<Reply<T>>,
  solve: Solve,
  first: boolean,
): Promise<Reply<T>> {
  const reply = await send(first ? await solve() : undefined);
  return reply.code === "CAPTCHA_REQUIRED" ? send(await solve()) : reply;
}

/** Адреса сервиса, которые открыты сайту (apps/account/src/api.ts, ROUTES). */
export const accountApi = {
  session: (fetchFn?: typeof fetch) =>
    request("/api/auth/get-session", { fetchFn }),
  signIn: (email: string, password: string, captcha?: string) =>
    request("/api/auth/sign-in/email", {
      body: { email, password, rememberMe: true },
      captcha,
    }),
  signUp: (email: string, locale: Lang, captcha?: string) =>
    request("/api/account/sign-up", {
      body: { email, locale },
      captcha,
      locale,
    }),
  signUpCode: (email: string, otp: string, locale: Lang) =>
    request("/api/auth/sign-in/email-otp", {
      body: { email, otp, locale },
      locale,
    }),
  setPassword: (newPassword: string) =>
    request("/api/account/password", { body: { newPassword } }),
  requestReset: (email: string, locale: Lang, captcha?: string) =>
    request("/api/auth/email-otp/request-password-reset", {
      body: { email },
      captcha,
      locale,
    }),
  checkReset: (email: string, otp: string) =>
    request("/api/auth/email-otp/check-verification-otp", {
      body: { email, type: "forget-password", otp },
    }),
  resetPassword: (email: string, otp: string, password: string) =>
    request("/api/auth/email-otp/reset-password", {
      body: { email, otp, password },
    }),
  google: (urls: ReturnType<typeof googleUrls>) =>
    request<{ url?: unknown }>("/api/auth/sign-in/social", {
      body: { provider: "google", ...urls },
    }),
  signOut: () => request("/api/auth/sign-out", { body: {} }),
};

/** Что показывает страница «My account» (GET /api/account/me сервиса, PR 4). */
export interface Me {
  email: string;
  name: string;
  emailVerified: boolean;
  /** Путь фото у сервиса или null. */
  photo: string | null;
  /** Сводка по подпискам раз в неделю. */
  digest: boolean;
  /** Новости продукта — только по согласию. */
  news: boolean;
  password: { set: boolean; changedAt: string | null };
  google: boolean;
}

/** Адреса кабинета (apps/account/src/profile.ts). */
export const cabinetApi = {
  me: () => request<Me>("/api/account/me"),
  profile: (body: { name?: string; digest?: boolean; news?: boolean }) =>
    request<Me>("/api/account/profile", { body }),
  photo: (image: Blob) =>
    request<{ photo: string | null }>("/api/account/photo", { image }),
  removePhoto: () =>
    request<{ photo: string | null }>("/api/account/photo/remove", {
      body: {},
    }),
  undoPhoto: () =>
    request<{ photo: string | null }>("/api/account/photo/undo", {
      body: {},
    }),
  requestEmail: (newEmail: string, password: string, locale: Lang) =>
    request("/api/account/email/request", {
      body: { newEmail, password },
      locale,
    }),
  confirmEmail: (newEmail: string, otp: string) =>
    request("/api/account/email/confirm", { body: { newEmail, otp } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/api/account/password/change", {
      body: { currentPassword, newPassword },
    }),
  linkGoogle: (urls: ReturnType<typeof linkUrls>) =>
    request<{ url?: unknown }>("/api/auth/link-social", {
      body: { provider: "google", ...urls },
    }),
  disconnectGoogle: () =>
    request("/api/account/google/disconnect", { body: {} }),
  deleteAccount: (email: string, password: string) =>
    request("/api/account/delete", { body: { email, password } }),
};

/** Адрес файла фото из пути, который отдаёт /me. */
export const photoUrl = (path: string | null): string | undefined =>
  path === null ? undefined : `${ACCOUNT}${path}`;

/** Первое поле окна кабинета — туда фокус при открытии: поле или текст, не выбор файла и не скрытая почта. */
export const FIRST_FIELD =
  "input:not([type=file]):not([tabindex='-1']), textarea";

/** Открытое окно на странице: закрылось одно окно кабинета, а другое уже открыто, — фокус не трогаем. */
export const OPEN_DIALOG = "dialog[open]";

/** Поле с ошибкой в окне входа — туда фокус после неудачи. */
export const INVALID_FIELD = "input[aria-invalid=true]";

/** Тексты ошибок — ключи словаря (lib/i18n.ts). */
export type MessageKey = keyof Dictionary;

/** Код ошибки сервиса → текст для человека. */
export function messageOf(code: string): MessageKey {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "authErrorCredentials";
    case "INVALID_EMAIL":
      return "authErrorEmail";
    case "EMAIL_TAKEN":
      return "authErrorEmailTaken";
    case "SIGN_UP_CLOSED":
      return "authErrorSignUpClosed";
    case "INVALID_OTP":
      return "authErrorCode";
    case "OTP_EXPIRED":
      return "authErrorCodeExpired";
    case "TOO_MANY_ATTEMPTS":
      return "authErrorCodeAttempts";
    case "INVALID_PASSWORD_LENGTH":
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
      return "authErrorPasswordLength";
    case "PASSWORD_WINDOW_CLOSED":
      return "authErrorPasswordWindow";
    case "RATE_LIMITED":
      return "authErrorRateLimited";
    case "CAPTCHA_REQUIRED":
      return "authErrorCaptcha";
    default:
      return "authErrorNetwork";
  }
}

// ——— Состояние в браузере ———

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Хранилище закрыто (приватное окно): просто не запомним.
  }
}

function listenersOf() {
  const set = new Set<() => void>();
  return {
    notify: () => {
      for (const listener of set) listener();
    },
    subscribe: (listener: () => void) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
}

const enabledListeners = listenersOf();

/** Включён ли интерфейс аккаунтов: всем — ACCOUNTS_OPEN, в закрытом режиме — по ?accounts=on. */
export const accountsStore = {
  get: (): boolean => ACCOUNTS_OPEN || storageGet(ACCOUNTS_KEY) === "on",
  set(on: boolean) {
    storageSet(ACCOUNTS_KEY, on ? "on" : null);
    enabledListeners.notify();
  },
  subscribe: enabledListeners.subscribe,
  notify: enabledListeners.notify,
};

/** На сервере и при гидратации — как у всех: в закрытом режиме интерфейса нет. */
export const useAccountsEnabled = (): boolean =>
  useSyncExternalStore(
    accountsStore.subscribe,
    accountsStore.get,
    () => ACCOUNTS_OPEN,
  );

export type Session =
  | { status: "unknown" }
  | { status: "guest" }
  | { status: "signed-in"; user: AccountUser };

const UNKNOWN: Session = { status: "unknown" };
const GUEST: Session = { status: "guest" };
let session: Session = UNKNOWN;
const sessionListeners = listenersOf();

export const sessionStore = {
  get: (): Session => session,
  set(next: Session) {
    session = next;
    sessionListeners.notify();
  },
  subscribe: sessionListeners.subscribe,
};

/** Кто вошёл; на сервере и до проверки — «неизвестно». */
export const useSession = (): Session =>
  useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => UNKNOWN);

/** Входили ли в этом браузере. */
export const wasSignedIn = (): boolean => storageGet(SIGNED_KEY) !== null;

let checking: Promise<void> | undefined;

/**
 * Узнать, кто вошёл: только если здесь входили — гость сервис не спрашивает. Сеанса нет — пометка
 * снимается; сервис не ответил — пока гость, а пометка остаётся до следующей загрузки.
 */
export function refreshSession(fetchFn?: typeof fetch): Promise<void> {
  if (!wasSignedIn()) {
    sessionStore.set(GUEST);
    return Promise.resolve();
  }
  checking ??= accountApi
    .session(fetchFn)
    .then((reply) => {
      const user = reply.ok ? userOf(reply.data) : undefined;
      if (user !== undefined) {
        sessionStore.set({ status: "signed-in", user });
        return;
      }
      if (reply.ok) storageSet(SIGNED_KEY, null);
      sessionStore.set(GUEST);
    })
    .finally(() => {
      checking = undefined;
    });
  return checking;
}

/** Уходим ко входу через Google: вернёмся — спросить сервис, кто вошёл; не вышло — пометка снимется. */
export function expectSignIn(): void {
  storageSet(SIGNED_KEY, "1");
}

/** Вошли (паролем, кодом или после Google): браузер запоминает «здесь входили». */
export function signedIn(user: AccountUser): void {
  storageSet(SIGNED_KEY, "1");
  sessionStore.set({ status: "signed-in", user });
}

/** Кабинет поменял имя, фото или почту — меню и «Your Plan» показывают новое сразу (PR 4). */
export function patchUser(patch: Partial<AccountUser>): void {
  if (session.status !== "signed-in") return;
  const user: AccountUser = { ...session.user, ...patch };
  if (patch.photo === undefined && "photo" in patch) delete user.photo;
  sessionStore.set({ status: "signed-in", user });
}

/** Аккаунт удалён: сеанса у сервиса больше нет, браузер забывает пометку (PR 4). */
export function forgetSession(): void {
  storageSet(SIGNED_KEY, null);
  sessionStore.set(GUEST);
}

/**
 * Выйти: сервис закрывает сеанс, браузер забывает пометку. Не ответил — остаёмся (false), иначе — гость,
 * даже если сеанса у сервиса уже не было.
 */
export async function signOut(): Promise<boolean> {
  const reply = await accountApi.signOut();
  if (reply.status === 0) return false;
  storageSet(SIGNED_KEY, null);
  sessionStore.set(GUEST);
  return true;
}

// ——— Окно входа ———

export const AUTH_SCREENS = [
  "login",
  "signup",
  "signup-code",
  "signup-password",
  "signup-done",
  "reset",
  "reset-code",
  "reset-password",
  "reset-done",
] as const;
export type AuthScreen = (typeof AUTH_SCREENS)[number];

export interface AuthRequest {
  screen: AuthScreen;
  /** Сообщение сразу при открытии — например, «не вышло войти через Google». */
  notice?: MessageKey;
  /** Почта в поле сразу — «Set password» из кабинета ведёт в восстановление с почтой человека (PR 4). */
  email?: string;
  /** Новое открытие — новое число: окно начинает с экрана заново. */
  serial: number;
}

/**
 * Открыто ли окно — общее хранилище боковых панелей (lib/panel-store.ts): окно закрывает рюкзак и
 * настройки сетки, а кнопку, которая его открыла, помнит для возврата фокуса.
 */
export const authPanelStore = createPanelStore();

let authRequest: AuthRequest = { screen: "login", serial: 0 };
const requestListeners = listenersOf();

export const authRequestStore = {
  get: (): AuthRequest => authRequest,
  subscribe: requestListeners.subscribe,
};

/** Открыть окно входа на экране (по умолчанию — «Log In»); шторку меню на телефоне — закрыть. */
export function openAuth(
  screen: AuthScreen = "login",
  o: { opener?: HTMLElement; notice?: MessageKey; email?: string } = {},
): void {
  authRequest = {
    screen,
    ...(o.notice === undefined ? {} : { notice: o.notice }),
    ...(o.email === undefined ? {} : { email: o.email }),
    serial: authRequest.serial + 1,
  };
  requestListeners.notify();
  menuStore.set(false);
  authPanelStore.set(true, o.opener);
}

/**
 * Начало на странице: ?accounts= и возврат после Google убираются из адреса; интерфейс включён и здесь
 * входили — узнать, кто вошёл; после Google — окно «You’re all set» или ошибка, после подключения Google
 * в кабинете — сообщение (notify). Изменения в другой вкладке (вход, выход, ?accounts=) приходят событием
 * storage. Возвращает отписку.
 */
export function startAccount(
  notify: (kind: "linked" | "link-error", code: string) => void = () => {},
): () => void {
  const switched = accountsSwitch(location.search);
  if (switched !== undefined) accountsStore.set(switched === "on");
  const back = googleReturn(location.search);
  const clean = withoutAccountParams(location.href);
  if (clean !== location.href) history.replaceState(history.state, "", clean);
  if (accountsStore.get()) {
    void refreshSession().then(() => {
      if (back === undefined) return;
      if (back.kind === "welcome" && session.status === "signed-in") {
        openAuth("signup-done");
      } else if (back.kind === "error") {
        openAuth("login", {
          notice:
            back.code === "SIGN_UP_CLOSED"
              ? "authErrorSignUpClosed"
              : "authErrorGoogle",
        });
      } else if (back.kind === "linked" || back.kind === "link-error") {
        notify(back.kind, back.kind === "link-error" ? back.code : "");
      }
    });
  }
  const onStorage = (e: StorageEvent) => {
    if (touchesKey(e.key, ACCOUNTS_KEY)) accountsStore.notify();
    if (
      (touchesKey(e.key, SIGNED_KEY) || touchesKey(e.key, ACCOUNTS_KEY)) &&
      accountsStore.get()
    ) {
      void refreshSession();
    }
  };
  addEventListener("storage", onStorage);
  return () => removeEventListener("storage", onStorage);
}
