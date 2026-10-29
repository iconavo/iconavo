import { Icon, IconavoProvider } from "@iconavo-ui/react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { INDEXING } from "../lib/headers";
import { loadSiteIcons } from "../lib/icons";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://iconavo.dev"),
  title: { default: "Iconavo", template: "%s — Iconavo" },
  description:
    "Any icon from open icon sets by its name, with one HTML tag or one React component.",
  // До запуска сайт скрыт от поисковиков (lib/headers.ts).
  robots: INDEXING ? undefined : { index: false, follow: false },
};

// Серверный компонент: иконки сайта грузятся при сборке и попадают в HTML страниц через
// IconavoProvider — без мигания (ADR-0033).
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const icons = await loadSiteIcons();
  return (
    <html lang="en">
      <body>
        <IconavoProvider icons={icons}>
          <a className="skip-link" href="#content">
            Skip to content
          </a>
          <header className="site-header">
            <div className="container header-row">
              <Link href="/" className="brand">
                Iconavo
              </Link>
              <nav aria-label="Main" className="header-nav">
                <Link href="/docs">Docs</Link>
                <a href="https://github.com/iconavo/iconavo">
                  <Icon icon="tabler:brand-github" className="inline-block" />{" "}
                  GitHub
                </a>
              </nav>
            </div>
          </header>
          {children}
          <footer className="site-footer">
            <div className="container">
              <p>
                Code:{" "}
                <a href="https://github.com/iconavo/iconavo/blob/main/LICENSE">
                  MIT
                </a>
                . Icons: their authors’ licenses.{" "}
                <a href="https://github.com/iconavo/iconavo">GitHub</a>
              </p>
            </div>
          </footer>
        </IconavoProvider>
      </body>
    </html>
  );
}
