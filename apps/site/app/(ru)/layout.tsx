import type { ReactNode } from "react";
import { Shell } from "../../components/Shell";
import { ThemeScript } from "../../components/ThemeScript";
import { loadSiteIcons } from "../../lib/icons";
import { siteMetadata } from "../../lib/metadata";
import "../globals.css";

// Корневая раскладка русской версии (ADR-0037): страницы — в app/(ru)/ru, адреса — /ru/….

export const metadata = siteMetadata("ru");

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const icons = await loadSiteIcons();
  return (
    // Атрибут data-theme ставит скрипт темы до гидратации — расхождение с сервером ожидаемо.
    <html lang="ru" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <Shell lang="ru" icons={icons}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
