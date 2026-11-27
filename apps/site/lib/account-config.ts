// Адреса аккаунтов для сайта (шаг 3 фазы 5, PR 3; ADR-0055) — без импортов: их берут и браузер
// (lib/account.ts), и next.config.ts (CSP, lib/headers.ts). Свои адреса задаёт только проверка сайта и
// pnpm site --account: превью сервиса аккаунтов и подставной Turnstile; иначе — живые.

/** Сервис аккаунтов: вход, регистрация, сеансы. Cookie сеанса — только у него. */
export const DEFAULT_ACCOUNT = "https://account.iconavo.dev";

/** Скрипт Turnstile Cloudflare: виджет рисуется по вызову (render=explicit), только когда он нужен. */
export const DEFAULT_TURNSTILE =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Ключ сайта Turnstile (виджет iconavo.dev, режим Managed) — не секрет: его видит каждая страница. */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAGViq37MBjv_XEIP";

/**
 * Открыты ли аккаунты всем. До /security-review — нет (решение владельца 27 ноября 2026): кнопка аккаунта —
 * «Soon» у всех, а у владельца включается особой ссылкой ?accounts=on (lib/account.ts). Сервис всё равно
 * регистрирует только почты из списка закрытого режима.
 */
export const ACCOUNTS_OPEN = false;

/** Адрес из окружения сборки, если он задан и это http(s); иначе — по умолчанию. */
export function accountUrl(
  value: string | undefined,
  fallback: string,
): string {
  if (value === undefined || value === "") return fallback;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? value
      : fallback;
  } catch {
    return fallback;
  }
}
