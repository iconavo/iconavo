import type { Metadata } from "next";
import { NotFound } from "../components/pages/NotFound";
import { Shell } from "../components/Shell";
import { ThemeScript } from "../components/ThemeScript";
import { loadSiteIcons } from "../lib/icons";
import "./globals.css";

// Страница 404 на любой несуществующий адрес (ADR-0037): корневых раскладок две, общей нет, поэтому
// Next.js отдаёт этот файл (experimental.globalNotFound в next.config.ts) — один статический документ
// на все адреса, без раскладок. Стили и скрипт темы он подключает сам; переключателя языка нет — язык
// адреса страница не знает, на ней обе главные. Метку noindex у 404 Next.js ставит сам.

export const metadata: Metadata = {
  title: "Page not found — Iconavo",
};

export default async function GlobalNotFound() {
  const icons = await loadSiteIcons();
  return (
    // Атрибут data-theme ставит скрипт темы до гидратации — расхождение с сервером ожидаемо.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <Shell lang="en" icons={icons} languageSwitch={false}>
          <NotFound />
        </Shell>
      </body>
    </html>
  );
}
