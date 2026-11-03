import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import { iconHosts, searchRobotsHeaders, siteHeaders } from "./lib/headers";
import { installFromReadme } from "./lib/install-readme";

// Метка сборки — 8 знаков коммита от CI (site.yml); её видно в заголовке X-Iconavo-Build, по ней
// pnpm site --live узнаёт, что выложена именно эта сборка.
const build = process.env.SITE_BUILD ?? "dev";

// Строки установки для генератора кода — из README тега при сборке (шаг 5 фазы 4, ADR-0042, ADR-0050):
// страницы иконок собираются по первому запросу на Vercel, а README в функции нет. Хэш integrity в
// README обновляет pnpm release bump (ADR-0051) — сайт берёт его со следующей выкладкой.
const install = installFromReadme(
  readFileSync(
    join(process.cwd(), "..", "..", "packages", "icon", "README.md"),
    "utf8",
  ),
);

const config: NextConfig = {
  poweredByHeader: false,
  env: { ICONAVO_INSTALL: JSON.stringify(install) },
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
      ...searchRobotsHeaders(),
    ];
  },
};

export default config;
