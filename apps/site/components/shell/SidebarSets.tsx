"use client";

import { Icon } from "@iconavo-ui/react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { SidebarGroup } from "../../lib/catalog-view";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { PageLink } from "../PageLink";

/**
 * «Filter by name» и наборы по группам с числом иконок (макет: Icon Set Group). Фильтр прячет строки на
 * месте, без запросов; текущий набор — по адресу страницы: и страница набора, и страницы его иконок.
 */
export function SidebarSets({
  lang,
  groups,
}: {
  lang: Lang;
  groups: SidebarGroup[];
}) {
  const t = DICTIONARIES[lang];
  const pathname = usePathname();
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      sets: g.sets.filter(
        (s) =>
          needle === "" ||
          s.name.toLowerCase().includes(needle) ||
          s.id.includes(needle),
      ),
    }))
    .filter((g) => g.sets.length > 0);
  const current = (id: string) => {
    const base = href(lang, `/${id}`);
    return pathname === base || pathname.startsWith(`${base}/`);
  };
  return (
    <>
      <div className="sidebar-filter">
        <Icon icon="lucide:search" className="sidebar-filter-icon" />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t.sidebarFilter}
          aria-label={t.sidebarFilter}
          autoComplete="off"
        />
      </div>
      <nav aria-label={t.sidebarLabel} className="sidebar-sets">
        {shown.map((g) => (
          <div key={g.id} className="sidebar-group">
            <p className="sidebar-group-title">{g.title}</p>
            <ul>
              {g.sets.map((s) => (
                <li key={s.id}>
                  <PageLink
                    lang={lang}
                    path={`/${s.id}`}
                    className="sidebar-set"
                    aria-current={current(s.id) ? "page" : undefined}
                  >
                    <span className="sidebar-set-name">{s.name}</span>
                    <span className="sidebar-set-count">{s.count}</span>
                  </PageLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {shown.length === 0 ? (
          <p className="sidebar-empty" role="status">
            {t.sidebarNothing}
          </p>
        ) : null}
      </nav>
    </>
  );
}
