// Постоянные сборки, превью и проверки сервиса аккаунтов `iconavo-account` (шаг 3 фазы 5, ADR-0055).

export const ACCOUNT_HOST = "account.iconavo.dev";
export const ACCOUNT_ORIGIN = `https://${ACCOUNT_HOST}`;
export const ACCOUNT_WORKER_NAME = "iconavo-account";
export const ACCOUNT_ENTRY = "apps/account/src/index.ts";
export const ACCOUNT_TSCONFIG = "apps/account/tsconfig.json";
export const ACCOUNT_OUT_DIR = "dist-account";

/** Сборки пакетов под Workers: у Better Auth — пароли через node:crypto и контекст через node:async_hooks. */
export const ACCOUNT_CONDITIONS = [
  "workerd",
  "worker",
  "import",
  "default",
] as const;

/** Встроенные модули Node в Workers: с даты совместимости 2026-08-04 — и без флага, флаг — явно. */
export const ACCOUNT_COMPATIBILITY_FLAGS = ["nodejs_compat"] as const;

/** База iconavo-account: D1 со строгой привязкой к ЕС (Jurisdiction EU), создана владельцем 27 ноября 2026. */
export const ACCOUNT_DATABASE_ID = "e8e0aa82-9874-4bd2-b2f0-b67672c4a95e";

/** Закрытый режим до /security-review (решение владельца 27 ноября 2026): регистрация — по списку. */
export const ACCOUNT_ACCESS = "closed";

/** Отправитель писем — единственный, кого пускает привязка send_email. */
export const ACCOUNT_SENDER = "support@iconavo.dev";

/**
 * Лимиты частоты — привязки ratelimit Workers (счёт свой в каждом дата-центре); код сервиса знает только
 * имена привязок.
 */
export const ACCOUNT_RATES = {
  /** Запросы POST к /api с одного адреса. */
  AUTH_LIMIT: { limit: 30, period: 60 },
  /** Письма с кодом на одну почту: повтор — через минуту, как в макете. */
  CODE_LIMIT: { limit: 1, period: 60 },
  /** Письма с кодом с одного адреса. */
  CODE_IP_LIMIT: { limit: 10, period: 60 },
} as const;

/** Пространства лимитов частоты (у edge API — 1001…1005). */
export const ACCOUNT_LIMIT_NAMESPACES = {
  AUTH_LIMIT: "1006",
  CODE_LIMIT: "1007",
  CODE_IP_LIMIT: "1008",
} as const;

/**
 * Предел процессора на вызов: пароль — scrypt (N=16384, r=16) через node:crypto Workers. Сколько уходит
 * на вход, видно после первой выкладки в панели (CPU Time); предел — с запасом.
 */
export const ACCOUNT_CPU_MS = 1_000;

/** Расписание функции — уборка просроченного раз в сутки. */
export const ACCOUNT_SCHEDULES = [{ cron: "47 3 * * *" }] as const;

/** Ключ подставного Google превью: по нему проверка сайта видит, что адрес Google собрал сервис. */
export const PREVIEW_GOOGLE_CLIENT = "preview-google-client";

/** Превью на 127.0.0.1. */
export const ACCOUNT_PREVIEW_PORT = 4287;

/** Секреты окружения GitHub account, которые выкладка вписывает в функцию. */
export const ACCOUNT_SECRETS = [
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "TURNSTILE_SECRET_KEY",
  "ACCOUNT_ALLOWLIST",
] as const;
