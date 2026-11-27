import { describe, expect, it } from "vitest";
import {
  AI_CRAWLER_AGENTS,
  AI_CRAWLERS,
  accountHosts,
  contentSecurityPolicy,
  INDEXING,
  iconHosts,
  ROBOTS,
  robotsRules,
  searchRobotsHeaders,
  siteHeaders,
} from "./headers";

describe("заголовки сайта", () => {
  it("до запуска — noindex в каждом ответе", () => {
    expect(INDEXING).toBe(false);
    const headers = siteHeaders({ production: false, build: "x", hosts: [] });
    expect(headers).toContainEqual({ key: "X-Robots-Tag", value: ROBOTS });
    expect(ROBOTS).toBe("noindex, nofollow");
  });

  it("robots.txt до запуска: поисковикам обход открыт, ИИ-обходчикам — закрыт (ADR-0039)", () => {
    expect(AI_CRAWLERS).toBe(false);
    expect(robotsRules()).toEqual([
      { userAgent: AI_CRAWLER_AGENTS, disallow: "/" },
      { userAgent: "*", allow: "/" },
    ]);
    expect(AI_CRAWLER_AGENTS).toContain("GPTBot");
    expect(new Set(AI_CRAWLER_AGENTS).size).toBe(AI_CRAWLER_AGENTS.length);
    // Поисковики в список не попадают: они должны видеть метку noindex.
    for (const engine of ["Googlebot", "Bingbot", "YandexBot", "*"]) {
      expect(AI_CRAWLER_AGENTS).not.toContain(engine);
    }
    // Фаза 7: AI_CRAWLERS = true — остаётся одно правило для всех.
    expect(robotsRules(true)).toEqual([{ userAgent: "*", allow: "/" }]);
  });

  it("CSP — только в продакшене: стили файлами, соединения — с хостами иконок", () => {
    const hosts = iconHosts({});
    const dev = siteHeaders({ production: false, build: "x", hosts });
    expect(dev.some((h) => h.key === "Content-Security-Policy")).toBe(false);
    const csp = contentSecurityPolicy(hosts);
    // Стили — только файлами сайта; 'unsafe-inline' — лишь у скриптов Next.js.
    expect(csp).toContain("; style-src 'self'; ");
    expect(csp).toContain(
      "connect-src 'self' https://api.iconavo.dev https://cdn.iconavo.dev https://cdn2.iconavo.dev https://iconavo.b-cdn.net https://account.iconavo.dev;",
    );
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("аккаунты (ADR-0055): сервис — в connect-src и img-src, Turnstile — в script-src и frame-src, и только он", () => {
    const csp = contentSecurityPolicy(iconHosts({}));
    expect(csp).toContain(
      "; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; ",
    );
    expect(csp).toContain(
      "; img-src 'self' data: https://account.iconavo.dev; ",
    );
    expect(csp).toContain("; frame-src https://challenges.cloudflare.com; ");
    // У проверки сайта — превью сервиса и подставной Turnstile из него.
    expect(
      accountHosts({
        NEXT_PUBLIC_ICONAVO_ACCOUNT: "http://127.0.0.1:5001",
        NEXT_PUBLIC_ICONAVO_TURNSTILE:
          "http://127.0.0.1:5001/__preview/turnstile.js",
      }),
    ).toEqual({
      service: "http://127.0.0.1:5001",
      turnstile: "http://127.0.0.1:5001",
    });
    // Не адрес или не http(s) — хосты по умолчанию.
    expect(
      accountHosts({ NEXT_PUBLIC_ICONAVO_ACCOUNT: "javascript:1" }),
    ).toEqual({
      service: "https://account.iconavo.dev",
      turnstile: "https://challenges.cloudflare.com",
    });
  });

  it("свои хосты из окружения проверки заменяют хосты по умолчанию", () => {
    expect(
      iconHosts({
        NEXT_PUBLIC_ICONAVO_API: "http://127.0.0.1:5000",
        NEXT_PUBLIC_ICONAVO_CDN: "http://127.0.0.1:5000/_static",
      }),
    ).toEqual(["http://127.0.0.1:5000"]);
  });
});

describe("страницы поиска не индексируются никогда (ADR-0039)", () => {
  it("пока сайт скрыт — метка и так на всех страницах; после запуска — отдельно у поиска", () => {
    expect(searchRobotsHeaders(false)).toEqual([]);
    expect(searchRobotsHeaders(true)).toEqual([
      {
        source: "/search",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/ru/search",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ]);
  });
});
