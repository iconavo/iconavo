import { Icon } from "@iconavo-ui/react";
import type { SidebarGroup } from "../../lib/catalog-view";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PageLink } from "../PageLink";
import { Logo } from "./Logo";
import { MenuClose } from "./Menu";
import { SidebarNav } from "./SidebarNav";
import { SidebarSets } from "./SidebarSets";
import { SidebarToggle } from "./SidebarToggle";
import { Soon } from "./Soon";

/**
 * Боковая панель по макету (Figma «Iconavo — Макеты», компонент Sidebar): логотип и «свернуть», разделы,
 * вкладки, фильтр и наборы по группам, внизу — тариф. На телефоне это шторка меню (Menu.tsx). Вкладки,
 * кроме Sets, тариф и Manage — «Soon»: в продукте их пока нет.
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
          <span className="sr-only">Iconavo</span>
        </PageLink>
        <SidebarToggle lang={lang} />
        <MenuClose lang={lang} />
      </div>
      <SidebarNav lang={lang} />
      <div className="sidebar-body">
        <div className="sidebar-tabs">
          <span className="sidebar-tab" aria-current="true">
            {t.sidebarTabSets}
          </span>
          <Soon lang={lang} className="sidebar-tab">
            {t.sidebarTabStyle}
          </Soon>
          <Soon lang={lang} className="sidebar-tab">
            {t.sidebarTabCategory}
          </Soon>
          <Soon lang={lang} className="sidebar-tab">
            {t.sidebarTabThemes}
          </Soon>
          <Soon lang={lang} className="sidebar-tab">
            {t.sidebarTabLicense}
          </Soon>
        </div>
        <SidebarSets lang={lang} groups={groups} />
      </div>
      <div className="sidebar-plan">
        <Soon lang={lang} className="sidebar-plan-button" above>
          <span className="sidebar-plan-info">
            <span className="sidebar-plan-label">{t.planLabel}</span>
            <span className="sidebar-plan-tier">
              <Icon icon="lucide:gem" className="sidebar-plan-icon" />
              <span className="sidebar-label">{t.planName}</span>
            </span>
          </span>
          <span className="sidebar-plan-manage">{t.planManage}</span>
        </Soon>
      </div>
    </aside>
  );
}
