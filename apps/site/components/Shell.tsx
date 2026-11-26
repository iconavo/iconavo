import { type IconavoIconSet, IconavoProvider } from "@iconavo-ui/react";
import { type ReactNode, Suspense } from "react";
import type { SidebarGroup } from "../lib/catalog-view";
import { DICTIONARIES, type Lang } from "../lib/i18n";
import { BagPanel } from "./bag/BagPanel";
import { Footer } from "./Footer";
import { SettingsPanel } from "./settings/SettingsPanel";
import { HotKey } from "./shell/HotKey";
import { MenuController } from "./shell/Menu";
import { PageView } from "./shell/PageView";
import { ScrollbarActivity } from "./shell/ScrollbarActivity";
import { Sidebar } from "./shell/Sidebar";
import { SmoothWheel } from "./shell/SmoothWheel";
import { TopBar } from "./shell/TopBar";
import { UrlWatch } from "./shell/UrlWatch";
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
      <ScrollbarActivity />
      <SmoothWheel />
      <PageView />
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
        <BagPanel lang={lang} />
        <SettingsPanel lang={lang} />
      </div>
      <HotKey lang={lang} />
      {/* Переход по ссылке на эту же страницу с другими параметрами (С-1): useSearchParams — под своим
          Suspense, в серверном HTML пусто, остальная страница статическая. */}
      <Suspense fallback={null}>
        <UrlWatch />
      </Suspense>
    </IconavoProvider>
  );
}
