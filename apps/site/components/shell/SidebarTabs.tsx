"use client";

import { useEffect, useId, useState } from "react";
import { styleChanged } from "../../lib/analytics";
import { groupLicenses, type SidebarGroup } from "../../lib/catalog-view";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { usePagePath } from "../../lib/page-path";
import {
  type FilterState,
  filtersOf,
  readSearchState,
  withFilters,
} from "../../lib/search";
import { useUrlQuery } from "../../lib/url-query";
import { LicenseChecks, SetChecks, StyleChoice } from "../search/SearchFilters";
import { NameFilter, SidebarSets } from "./SidebarSets";
import { Soon } from "./Soon";

type Tab = "sets" | "style" | "license";

/**
 * Вкладки левой панели и их содержимое. На странице поиска это фильтры выдачи (решение владельца 17 ноября
 * 2026): Sets — чекбоксы наборов под заголовком «Search Results», как в макете «Сценарий поиска иконок»,
 * Style — стиль по шкале, License — лицензии и пометка о коммерческих проектах; выбор сразу меняет адрес и
 * выдачу, «назад» его возвращает. Category и Themes — «Soon» и стоят после рабочих вкладок. На остальных страницах — наборы ссылками,
 * остальные вкладки — «Soon», как раньше.
 */
export function SidebarTabs({
  lang,
  groups,
}: {
  lang: Lang;
  groups: SidebarGroup[];
}) {
  const t = DICTIONARIES[lang];
  const onSearch = usePagePath() === href(lang, "/search");
  const [tab, setTab] = useState<Tab>("sets");
  const [needle, setNeedle] = useState("");
  const styleName = useId();
  const { query, ready, navigate } = useUrlQuery();

  // Ушли со страницы поиска — вкладка и поиск по названию снова с начала.
  useEffect(() => {
    if (onSearch) return;
    setTab("sets");
    setNeedle("");
  }, [onSearch]);

  if (!onSearch) {
    return (
      <>
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
      </>
    );
  }

  const licenses = groupLicenses(groups);
  const known = {
    sets: groups.flatMap((g) => g.sets.map((s) => s.id)),
    licenses,
  };
  const filters = filtersOf(readSearchState(query, known));
  // До чтения адреса этой страницы фильтры не меняются: query ещё пустой, и запрос пропал бы.
  const apply = (next: FilterState) => {
    if (ready) navigate(withFilters(query, next));
  };
  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      className="sidebar-tab"
      aria-pressed={tab === id}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );
  return (
    <>
      <fieldset className="sidebar-tabs">
        <legend className="sr-only">{t.filterTabsLabel}</legend>
        {/* Рабочие вкладки — первыми: ряд шире панели и обрезан справа, как в макете, и License иначе
            ушла бы за край. */}
        {tabButton("sets", t.sidebarTabSets)}
        {tabButton("style", t.sidebarTabStyle)}
        {tabButton("license", t.sidebarTabLicense)}
        <Soon lang={lang} className="sidebar-tab">
          {t.sidebarTabCategory}
        </Soon>
        <Soon lang={lang} className="sidebar-tab">
          {t.sidebarTabThemes}
        </Soon>
      </fieldset>
      {tab === "sets" ? (
        <>
          <NameFilter lang={lang} value={needle} onChange={setNeedle} />
          <div className="sidebar-sets sidebar-filters">
            <SetChecks
              lang={lang}
              groups={groups}
              needle={needle}
              selected={filters.sets}
              onChange={(sets) => apply({ ...filters, sets })}
              grouped={false}
              title={t.searchResultsTitle}
            />
          </div>
        </>
      ) : (
        <div className="sidebar-sets sidebar-filters">
          {tab === "style" ? (
            <StyleChoice
              lang={lang}
              name={styleName}
              value={filters.style}
              onChange={(style) => {
                if (style !== undefined) styleChanged(style, "filter");
                const { style: _, ...rest } = filters;
                apply(style === undefined ? rest : { ...rest, style });
              }}
            />
          ) : (
            <LicenseChecks
              lang={lang}
              licenses={licenses}
              selected={filters.licenses}
              commercial={filters.commercial === true}
              onChange={({ licenses: next, commercial }) => {
                const { commercial: _, ...rest } = filters;
                apply({
                  ...rest,
                  licenses: next,
                  ...(commercial ? { commercial: true as const } : {}),
                });
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
