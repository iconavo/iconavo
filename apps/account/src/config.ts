// Постоянные сервиса аккаунтов `iconavo-account` (шаг 3 фазы 5, ADR-0055): адреса, сроки, пределы. Метку
// сборки вписывает сборка конвейера (pnpm account build) — одно вхождение заглушки, как у edge API.

export const BUILD = "__ICONAVO_BUILD__";

/** Сайт: только его страницы ходят в сервис с cookie (CORS и проверка Origin Better Auth). */
export const SITE_ORIGIN = "https://iconavo.dev";

/** Сервис: у него одного есть cookie сеанса. */
export const SERVICE_ORIGIN = "https://account.iconavo.dev";

/** Адреса Better Auth. */
export const AUTH_PATH = "/api/auth";

/** Свои адреса сервиса: начало регистрации, пароль после неё. */
export const ACCOUNT_PATH = "/api/account";

/** Вход помнится 30 дней с последнего визита (решение владельца 27 ноября 2026); продлевается раз в сутки. */
export const SESSION = {
  expiresInSeconds: 30 * 86_400,
  updateAgeSeconds: 86_400,
};

/** Код на почту: 6 цифр, 10 минут, 3 попытки, повтор — через минуту (решения владельца 27 ноября 2026). */
export const CODE = {
  length: 6,
  ttlSeconds: 600,
  attempts: 3,
  resendSeconds: 60,
} as const;

/** Пароль: длина. */
export const PASSWORD = { min: 8, max: 128 } as const;

/** Три неудачных входа за 15 минут — дальше вход только с Turnstile. */
export const LOGIN_FAILURES = { free: 3, windowMs: 15 * 60_000 } as const;

/** Пароль сразу после регистрации кодом — не позже стольких минут: потом — восстановлением по коду. */
export const SET_PASSWORD_WINDOW_MS = 30 * 60_000;

/** Регистрация, не подтверждённая кодом, — сутки (решение владельца 27 ноября 2026). */
export const UNVERIFIED_TTL_MS = 86_400_000;

/** Тело запроса — не больше. */
export const MAX_BODY_BYTES = 8_192;

/** Языки писем — языки сайта. */
export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

/** Заголовок, в котором сайт передаёт язык страницы. */
export const LOCALE_HEADER = "x-iconavo-locale";

/** Заголовок с ответом Turnstile — как у плагина captcha Better Auth. */
export const CAPTCHA_HEADER = "x-captcha-response";

/** Отправитель писем; ответы приходят владельцу пересылкой Email Routing. */
export const MAIL_FROM = {
  email: "support@iconavo.dev",
  name: "Iconavo",
} as const;

/** Проверка ответа Turnstile. */
export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Фото профиля (шаг 3 фазы 5, PR 4а): сайт обрезает его по кругу сам и присылает квадрат PNG или JPEG.
 * Сервис хранит его в закрытом бакете R2 в ЕС и отдаёт только самому человеку. Прежнее фото живёт ещё
 * 10 минут — для «Undo» (решение владельца 27 ноября 2026), потом его удаляет уборка.
 */
export const PHOTO = {
  maxBytes: 1_048_576,
  minSide: 128,
  maxSide: 1_024,
  undoMs: 10 * 60_000,
} as const;

/** Фото из Google при первом входе: только с серверов Google, не больше 1 МБ, ждать — до 5 секунд. */
export const GOOGLE_PHOTO = {
  hostSuffix: ".googleusercontent.com",
  side: 512,
  timeoutMs: 5_000,
} as const;

/** Имя в профиле — до стольких знаков. */
export const NAME_MAX = 64;

/** Неверный текущий пароль в кабинете (почта, пароль, удаление): после стольких за 15 минут — пауза. */
export const ACCOUNT_PASSWORD_FAILURES = 5;

/**
 * Обратная связь (шаг 3 фазы 5, PR 6а; кадры K2–K6): скриншот — PNG или JPEG до 5 МБ, как в макете; текст —
 * до 4 000 знаков, короткие поля — до 300. Частота — не больше 5 за 10 минут и 20 за сутки на человека
 * (привязки ограничения частоты Workers знают только окна 10 и 60 с — счёт по таблице). Хранится год
 * (решение владельца 27 ноября 2026); письмо — на support@, ответ — человеку.
 */
export const FEEDBACK = {
  maxBytes: 5 * 1024 * 1024,
  /** Тело формы целиком: скриншот и поля. */
  maxFormBytes: 5 * 1024 * 1024 + 65_536,
  textMax: 4_000,
  shortMax: 300,
  windowMs: 10 * 60_000,
  perWindow: 5,
  perDay: 20,
  keepMs: 365 * 86_400_000,
} as const;
