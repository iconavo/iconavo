// Заголовки ответов сайта (ADR-0050). До запуска сайт скрыт от поисковиков (решение владельца
// 29 октября 2026): метка noindex и в HTML, и в заголовке, от одной константы — её переключает чек-лист
// фазы 7. robots.txt обход не запрещает: иначе поисковик не прочитал бы и саму метку.

/** Показывать ли сайт поисковикам. До запуска 1 июня 2027 — нет. */
export const INDEXING = false;

export const ROBOTS = "noindex, nofollow";

/** Хосты иконок по умолчанию (ADR-0030). */
const DEFAULT_HOSTS = [
  "https://api.iconavo.dev",
  "https://cdn.iconavo.dev",
  "https://cdn2.iconavo.dev",
  "https://iconavo.b-cdn.net",
];

/** Хосты, к которым страница может обращаться: свои из окружения проверки или по умолчанию. */
export function iconHosts(env: Record<string, string | undefined>): string[] {
  const own = [env.NEXT_PUBLIC_ICONAVO_API, env.NEXT_PUBLIC_ICONAVO_CDN]
    .filter((url): url is string => Boolean(url))
    .map((url) => new URL(url).origin);
  return own.length > 0 ? [...new Set(own)] : DEFAULT_HOSTS;
}

/**
 * Политика безопасности: стили только файлами сайта — пакет не ставит атрибутов style, его лист стилей
 * добавляет скрипт. Встроенным скриптам Next.js нужен 'unsafe-inline': nonce сделал бы все страницы
 * динамическими.
 */
export function contentSecurityPolicy(hosts: string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self'",
    `connect-src 'self' ${hosts.join(" ")}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Заголовки каждого ответа; политика CSP — только в продакшене: сервер разработки встраивает свои стили. */
export function siteHeaders(o: {
  production: boolean;
  build: string;
  hosts: string[];
}): { key: string; value: string }[] {
  return [
    ...(o.production
      ? [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(o.hosts),
          },
        ]
      : []),
    ...(INDEXING ? [] : [{ key: "X-Robots-Tag", value: ROBOTS }]),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "X-Iconavo-Build", value: o.build },
  ];
}
