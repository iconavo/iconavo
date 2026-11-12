"use client";

import { Icon } from "@iconavo-ui/react";
import { usePathname } from "next/navigation";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { PageLink } from "../PageLink";
import { Soon } from "./Soon";

/** Разделы, где «Icon Sets» не текущий: документация, лента и лицензии. */
const OTHER_SECTIONS = ["/docs", "/changelog", "/licenses"];

/**
 * Разделы боковой панели по макету: Icon Sets, Subscribed, Docs, Tools, Github. Подписок и инструментов
 * в продукте пока нет — «Soon». Текущий раздел — по адресу страницы: клиентский компонент, потому что
 * общая раскладка при переходах не пересобирается.
 */
export function SidebarNav({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const pathname = usePathname();
  const inSection = (path: string) => {
    const base = href(lang, path);
    return pathname === base || pathname.startsWith(`${base}/`);
  };
  const docs = pathname === "/docs" || pathname.startsWith("/docs/");
  const iconSets = !docs && !OTHER_SECTIONS.some(inSection);
  return (
    <nav aria-label={t.mainNav} className="sidebar-nav">
      <ul>
        <li>
          <PageLink
            lang={lang}
            path="/"
            className="sidebar-item"
            aria-current={iconSets ? "page" : undefined}
          >
            <Icon icon="material-symbols:home" className="sidebar-item-icon" />
            <span className="sidebar-label">{t.navIconSets}</span>
          </PageLink>
        </li>
        <li>
          <Soon lang={lang} className="sidebar-item">
            <Icon icon="site:add-alert-light" className="sidebar-item-icon" />
            <span className="sidebar-label">{t.navSubscribed}</span>
          </Soon>
        </li>
        <li>
          <PageLink
            lang={lang}
            path="/docs"
            className="sidebar-item"
            aria-current={docs ? "page" : undefined}
          >
            <Icon
              icon="material-symbols:auto-stories"
              className="sidebar-item-icon"
            />
            <span className="sidebar-label">{t.docs}</span>
          </PageLink>
        </li>
        <li>
          <Soon lang={lang} className="sidebar-item">
            <Icon
              icon="material-symbols:handyman"
              className="sidebar-item-icon"
            />
            <span className="sidebar-label">{t.navTools}</span>
          </Soon>
        </li>
        <li>
          <a href="https://github.com/iconavo/iconavo" className="sidebar-item">
            <Icon icon="site:github" className="sidebar-item-icon" />
            <span className="sidebar-label">GitHub</span>
          </a>
        </li>
      </ul>
    </nav>
  );
}
