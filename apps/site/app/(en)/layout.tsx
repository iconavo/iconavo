import type { ReactNode } from "react";
import { Shell } from "../../components/Shell";
import { ThemeScript } from "../../components/ThemeScript";
import { loadSiteIcons } from "../../lib/icons";
import { siteMetadata } from "../../lib/metadata";
import "../globals.css";

// Корневая раскладка английской версии (ADR-0037): у русской — своя, в app/(ru), чтобы у каждой
// страницы был верный <html lang> и все страницы оставались статическими. Иконки сайта грузятся при
// сборке и попадают в HTML страниц через IconavoProvider — без мигания (ADR-0033).

export const metadata = siteMetadata("en");

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const icons = await loadSiteIcons();
  return (
    // Атрибут data-theme ставит скрипт темы до гидратации — расхождение с сервером ожидаемо.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <Shell lang="en" icons={icons}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
