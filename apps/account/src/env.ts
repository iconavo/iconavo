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
  /** Вложения — скриншот обратной связи (PR 6а): байты, имя, тип; всё письмо — до 25 МБ. */
  attachments?: MailAttachment[];
}

/** Вложение письма Cloudflare Email Service. */
export interface MailAttachment {
  content: Uint8Array | ArrayBuffer | string;
  filename: string;
  type: string;
  disposition: "attachment" | "inline";
}

/** Привязка send_email (Cloudflare Email Service). */
export interface MailBinding {
  send(message: MailMessage): Promise<{ messageId?: string }>;
}

/** Объект R2 — то, что сервис из него читает. */
export interface R2ObjectLike {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpMetadata?: { contentType?: string };
}

/** Привязка бакета R2 — часть R2Bucket Workers. */
export interface R2Like {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
  delete(keys: string | string[]): Promise<void>;
}

export interface Env {
  /** База iconavo-account (D1, ЕС). */
  DB: D1Like;
  /** Закрытый бакет iconavo-account-files (R2, ЕС): фото профиля, со временем — скриншоты отзывов. */
  FILES?: R2Like;
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
