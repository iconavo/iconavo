import { type IconavoIconSet, IconavoProvider } from "@iconavo-ui/react";
import type { ReactNode } from "react";
import { DICTIONARIES, type Lang } from "../lib/i18n";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { ThemeSync } from "./ThemeSync";

/**
 * Общее у корневых раскладок языков и страницы 404: ссылка «к содержимому» — первой в документе,
 * шапка, подвал. Иконки сайта загружены при сборке и попадают в HTML через IconavoProvider — без
 * мигания (ADR-0033).
 */
export function Shell({
  lang,
  icons,
  languageSwitch,
  children,
}: {
  lang: Lang;
  icons: IconavoIconSet[];
  languageSwitch?: boolean;
  children: ReactNode;
}) {
  return (
    <IconavoProvider icons={icons}>
      <ThemeSync />
      <a className="skip-link" href="#content">
        {DICTIONARIES[lang].skip}
      </a>
      <Header lang={lang} languageSwitch={languageSwitch} />
      {children}
      <Footer lang={lang} />
    </IconavoProvider>
  );
}
