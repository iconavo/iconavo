// Заголовки ответов сайта (ADR-0050). До запуска сайт скрыт от поисковиков (решение владельца
// 29 октября 2026): метка noindex и в HTML, и в заголовке, от одной константы — её переключает чек-лист
// фазы 7. robots.txt обход поисковикам не запрещает: иначе поисковик не прочитал бы и саму метку.
// ИИ-обходчикам до запуска обход закрыт (AI_CRAWLERS, ADR-0039).

/** Показывать ли сайт поисковикам. До запуска 1 июня 2027 — нет. */
export const INDEXING = false;

/**
 * Пускать ли ИИ-обходчиков — обучение моделей и ИИ-поиск (ADR-0039, уточнение от 6 ноября 2026). До
 * запуска — нет: GPTBot за ночь открыл 33,6 тысячи страниц иконок, каждая при первой сборке делает
 * около пяти запросов к edge API, и бесплатный суточный лимит Workers кончился. Сверху — правило AI Bots
 * в Firewall Vercel. Решение владельца: обходчики понадобятся, чтобы сайт попадал в ответы ИИ, — открыть
 * в фазе 7 по чек-листу запуска (docs/roadmap.md), вместе с INDEXING.
 */
export const AI_CRAWLERS = false;

/**
 * ИИ-обходчики, которым robots.txt закрывает сайт, пока AI_CRAWLERS = false: обучение моделей, ИИ-поиск
 * и запросы ассистентов от имени человека. Полный и свежий список ведёт правило AI Bots Vercel.
 */
export const AI_CRAWLER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "meta-externalfetcher",
  "cohere-ai",
  "cohere-training-data-crawler",
  "MistralAI-User",
  "DuckAssistBot",
  "AI2Bot",
  "Diffbot",
];

export interface RobotsRule {
  userAgent: string | string[];
  allow?: string;
  disallow?: string;
}

/** Правила robots.txt: поисковикам обход открыт всегда, ИИ-обходчикам — только при AI_CRAWLERS. */
export function robotsRules(aiCrawlers = AI_CRAWLERS): RobotsRule[] {
  const everyone: RobotsRule = { userAgent: "*", allow: "/" };
  return aiCrawlers
    ? [everyone]
    : [{ userAgent: [...AI_CRAWLER_AGENTS], disallow: "/" }, everyone];
}

export const ROBOTS = "noindex, nofollow";

/** Страницы поиска: не индексируются никогда — у выдачи нет постоянного содержания (ADR-0039). */
export const SEARCH_PATHS = ["/search", "/ru/search"];

/**
 * Заголовок noindex у страниц поиска для next.config. Пока весь сайт скрыт, он уже на всех страницах;
 * когда сайт откроют поисковикам (INDEXING), у поиска он останется.
 */
export function searchRobotsHeaders(
  indexing = INDEXING,
): { source: string; headers: { key: string; value: string }[] }[] {
  return indexing
    ? SEARCH_PATHS.map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: ROBOTS }],
      }))
    : [];
}

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
