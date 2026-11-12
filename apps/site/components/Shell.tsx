import { type IconavoIconSet, IconavoProvider } from "@iconavo-ui/react";
import type { ReactNode } from "react";
import type { SidebarGroup } from "../lib/catalog-view";
import { DICTIONARIES, type Lang } from "../lib/i18n";
import { Footer } from "./Footer";
import { HotKey } from "./shell/HotKey";
import { MenuController } from "./shell/Menu";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { ThemeSync } from "./ThemeSync";

/**
 * Каркас по макету (Figma «Iconavo — Макеты»): боковая панель 224 px слева, справа колонка — верхняя
 * полоса, содержимое страницы (<main id="content">) и подвал. На телефоне панель — шторка меню. Ссылка «к
 * содержимому» — первой в документе. Иконки сайта загружены при сборке и попадают в HTML через
 * IconavoProvider — без мигания (ADR-0033).
 */
export function Shell({
  lang,
  icons,
  groups,
  languageSwitch,
  children,
}: {
  lang: Lang;
  icons: IconavoIconSet[];
  /** Наборы боковой панели по группам (sidebarGroups). */
  groups: SidebarGroup[];
  languageSwitch?: boolean;
  children: ReactNode;
}) {
  return (
    <IconavoProvider icons={icons}>
      <ThemeSync />
      <a className="skip-link" href="#content">
        {DICTIONARIES[lang].skip}
      </a>
      <div className="app">
        <Sidebar lang={lang} groups={groups} />
        <MenuController />
        <div className="app-column">
          <TopBar lang={lang} languageSwitch={languageSwitch} />
          {children}
          <Footer lang={lang} languageSwitch={languageSwitch} />
        </div>
      </div>
      <HotKey lang={lang} />
    </IconavoProvider>
  );
}
