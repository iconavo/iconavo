// Что сервис берёт у Cloudflare Workers — свои минимальные типы вместо @cloudflare/workers-types: новая
// зависимость ради нескольких строк не нужна (как у edge API, ADR-0024). Имена привязок задаёт
// metadata.json сборки (pnpm account build), секреты вписывает выкладка из окружения GitHub account.

import type { D1Like } from "@iconavo-ui/d1";

/** Привязка ограничения частоты (Rate Limiting). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Письмо — часть сообщения env.EMAIL.send() Cloudflare Email Service. */
export interface MailMessage {
  from: { email: string; name: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

/** Привязка send_email (Cloudflare Email Service). */
export interface MailBinding {
  send(message: MailMessage): Promise<{ messageId?: string }>;
}

export interface Env {
  /** База iconavo-account (D1, ЕС). */
  DB: D1Like;
  EMAIL?: MailBinding;
  AUTH_LIMIT?: RateLimiter;
  CODE_LIMIT?: RateLimiter;
  CODE_IP_LIMIT?: RateLimiter;
  /** Ключ подписи cookie и шифрования Better Auth. */
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** «closed» — регистрируются только адреса ACCOUNT_ALLOWLIST (до /security-review, решение 2). */
  ACCOUNT_ACCESS?: string;
  /** Почты закрытого режима через запятую. */
  ACCOUNT_ALLOWLIST?: string;
  /** Только у превью и тестов: адрес сайта, адрес сервиса, cookie без __Host-, своя проверка Turnstile. */
  SITE_ORIGIN?: string;
  SERVICE_ORIGIN?: string;
  COOKIE_MODE?: string;
  TURNSTILE_VERIFY_URL?: string;
}

/** Контекст запроса — часть ExecutionContext. */
export interface Context {
  waitUntil(promise: Promise<unknown>): void;
}
