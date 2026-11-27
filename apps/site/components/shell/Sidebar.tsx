import type { SidebarGroup } from "../../lib/catalog-view";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PlanBlock } from "../account/PlanBlock";
import { PageLink } from "../PageLink";
import { Logo, LogoMark } from "./Logo";
import { MenuClose } from "./Menu";
import { SidebarNav } from "./SidebarNav";
import { SidebarTabs } from "./SidebarTabs";
import { SidebarToggle } from "./SidebarToggle";

/**
 * Боковая панель по макету (Figma «Iconavo — Макеты», компонент Sidebar): логотип и «свернуть», разделы,
 * вкладки, фильтр и наборы по группам, внизу — тариф. На телефоне это шторка меню (Menu.tsx). Вкладки
 * (SidebarTabs): на странице поиска Sets, Style и License — фильтры выдачи, на остальных — только Sets;
 * прочие вкладки — «Soon»: в продукте их пока нет. Тариф внизу — components/account/PlanBlock.tsx: гостю —
 * вход, вошедшему — кто вошёл, в закрытом режиме — «Soon».
 */
export function Sidebar({
  lang,
  groups,
}: {
  lang: Lang;
  groups: SidebarGroup[];
}) {
  const t = DICTIONARIES[lang];
  return (
    <aside id="sidebar" className="sidebar" aria-label={t.sidebarLabel}>
      <div className="sidebar-head">
        <PageLink lang={lang} path="/" className="sidebar-brand">
          <Logo className="sidebar-logo" />
          <LogoMark className="sidebar-mark" />
          <span className="sr-only">Iconavo</span>
        </PageLink>
        <SidebarToggle lang={lang} />
        <MenuClose lang={lang} />
      </div>
      <SidebarNav lang={lang} />
      <div className="sidebar-body">
        <SidebarTabs lang={lang} groups={groups} />
      </div>
      <div className="sidebar-plan">
        <PlanBlock lang={lang} />
      </div>
    </aside>
  );
}
