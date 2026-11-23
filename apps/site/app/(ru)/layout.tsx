import type { ReactNode } from "react";
import { Shell } from "../../components/Shell";
import { ThemeScript } from "../../components/ThemeScript";
import { getSets, SHELL_TAG } from "../../lib/catalog";
import { sidebarGroups } from "../../lib/catalog-view";
import { interTight } from "../../lib/fonts";
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
  const [icons, sets] = await Promise.all([
    loadSiteIcons(),
    getSets(SHELL_TAG),
  ]);
  return (
    // Атрибут data-theme ставит скрипт темы до гидратации — расхождение с сервером ожидаемо.
    <html
      lang="ru"
      className={interTight.variable}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <Shell lang="ru" icons={icons} groups={sidebarGroups("ru", sets)}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
