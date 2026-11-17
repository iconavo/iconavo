"use client";

import { Icon } from "@iconavo-ui/react";
import { useState } from "react";
import { filterGroups, type SidebarGroup } from "../../lib/catalog-view";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { usePagePath } from "../../lib/page-path";
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
  const pathname = usePagePath();
  const [filter, setFilter] = useState("");
  const shown = filterGroups(groups, filter);
  const current = (id: string) => {
    const base = href(lang, `/${id}`);
    return pathname === base || pathname.startsWith(`${base}/`);
  };
  return (
    <>
      <NameFilter lang={lang} value={filter} onChange={setFilter} />
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

/** Поле «Filter by name»: прячет строки наборов на месте, без запросов (левая панель и шторка фильтра). */
export function NameFilter({
  lang,
  value,
  onChange,
}: {
  lang: Lang;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = DICTIONARIES[lang];
  return (
    <div className="sidebar-filter">
      <Icon icon="material-symbols:search" className="sidebar-filter-icon" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.sidebarFilter}
        aria-label={t.sidebarFilter}
        autoComplete="off"
      />
    </div>
  );
}
