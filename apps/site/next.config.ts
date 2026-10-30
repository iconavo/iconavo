import type { NextConfig } from "next";
import { iconHosts, siteHeaders } from "./lib/headers";

// Метка сборки — 8 знаков коммита от CI (site.yml); её видно в заголовке X-Iconavo-Build, по ней
// pnpm site --live узнаёт, что выложена именно эта сборка.
const build = process.env.SITE_BUILD ?? "dev";

const config: NextConfig = {
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md for AI coding agents into the app.
  agentRules: false,
  generateBuildId: async () =>
    process.env.SITE_BUILD ? `site-${process.env.SITE_BUILD}` : null,
  // Две корневые раскладки — по языку (ADR-0037), общей нет: несуществующие адреса отдаёт
  // app/global-not-found.tsx. Настройка экспериментальная — Next.js закреплён точно, обновление — с
  // проверкой 404 (pnpm site --check).
  experimental: { globalNotFound: true },
  // Документации на русском пока нет (решение владельца 30 октября 2026): /ru/docs… ведут на
  // английскую временно (307) — когда появится перевод, адреса освободятся.
  async redirects() {
    return [
      { source: "/ru/docs", destination: "/docs", permanent: false },
      {
        source: "/ru/docs/:path*",
        destination: "/docs/:path*",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: siteHeaders({
          production: process.env.NODE_ENV === "production",
          build,
          hosts: iconHosts(process.env),
        }),
      },
    ];
  },
};

export default config;
