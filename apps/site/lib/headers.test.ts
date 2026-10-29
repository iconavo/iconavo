import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  INDEXING,
  iconHosts,
  ROBOTS,
  siteHeaders,
} from "./headers";

describe("заголовки сайта", () => {
  it("до запуска — noindex в каждом ответе", () => {
    expect(INDEXING).toBe(false);
    const headers = siteHeaders({ production: false, build: "x", hosts: [] });
    expect(headers).toContainEqual({ key: "X-Robots-Tag", value: ROBOTS });
    expect(ROBOTS).toBe("noindex, nofollow");
  });

  it("CSP — только в продакшене: стили файлами, соединения — с хостами иконок", () => {
    const hosts = iconHosts({});
    const dev = siteHeaders({ production: false, build: "x", hosts });
    expect(dev.some((h) => h.key === "Content-Security-Policy")).toBe(false);
    const csp = contentSecurityPolicy(hosts);
    // Стили — только файлами сайта; 'unsafe-inline' — лишь у скриптов Next.js.
    expect(csp).toContain("; style-src 'self'; ");
    expect(csp).toContain(
      "connect-src 'self' https://api.iconavo.dev https://cdn.iconavo.dev https://cdn2.iconavo.dev https://iconavo.b-cdn.net",
    );
    expect(csp).toContain("frame-ancestors 'none'");
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
