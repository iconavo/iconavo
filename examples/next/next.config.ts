import type { NextConfig } from "next";

// The icon hosts the page may connect to: your own from NEXT_PUBLIC_ICONAVO_API and
// NEXT_PUBLIC_ICONAVO_CDN (see app/iconavo.ts), otherwise the default ones.
const own = [
  process.env.NEXT_PUBLIC_ICONAVO_API,
  process.env.NEXT_PUBLIC_ICONAVO_CDN,
]
  .filter((url): url is string => Boolean(url))
  .map((url) => new URL(url).origin);
const hosts =
  own.length > 0
    ? [...new Set(own)]
    : [
        "https://api.iconavo.dev",
        "https://cdn.iconavo.dev",
        "https://cdn2.iconavo.dev",
        "https://iconavo.b-cdn.net",
      ];

// A strict policy for styles: no inline styles at all. Icons need no exceptions here: the
// component never sets a style attribute, and its stylesheet is added from a script. Next.js's own
// inline scripts still need 'unsafe-inline' (nonces would make every page dynamic).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self'",
  `connect-src 'self' ${hosts.join(" ")}`,
  "img-src 'self' data:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md for AI coding agents into the example.
  agentRules: false,
  async headers() {
    // Only in production: the development server adds its own inline styles and scripts.
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default config;
