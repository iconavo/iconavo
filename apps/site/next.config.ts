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
