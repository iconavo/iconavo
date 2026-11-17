"use client";

import { Icon } from "@iconavo-ui/react";
import type { ReactNode } from "react";
import { filterGroups, type SidebarGroup } from "../../lib/catalog-view";
import { DICTIONARIES, type Lang, STYLE_KEYS } from "../../lib/i18n";
import { allCommercial, STYLES, type Style } from "../../lib/search";
import { PageLink } from "../PageLink";

/*
 * Фильтры выдачи поиска (редизайн, решение владельца 17 ноября 2026): наборы — чекбоксами, стиль — один
 * из шкалы, лицензии — чекбоксами и пометка о коммерческих проектах. Одни и те же части у левой панели
 * (выбор сразу меняет выдачу) и у шторки фильтра на телефоне (выбор — до «Показать»).
 */

/** Флажок или переключатель фильтра: значки Material Symbols поверх скрытого поля, как в панели иконки. */
function FilterOption({
  type,
  name,
  checked,
  onChange,
  count,
  children,
}: {
  type: "checkbox" | "radio";
  /** Имя группы переключателей: у каждой копии фильтров своё. */
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Число иконок набора — справа, как в макете шторки. */
  count?: string;
  children: ReactNode;
}) {
  const icon =
    type === "radio"
      ? checked
        ? "material-symbols:radio-button-checked"
        : "material-symbols:radio-button-unchecked"
      : checked
        ? "material-symbols:check-box"
        : "material-symbols:check-box-outline-blank";
  return (
    <label className="filter-option">
      <input
        type={type}
        name={name}
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <Icon icon={icon} className="filter-option-box" />
      <span className="filter-option-label">{children}</span>
      {count === undefined ? null : (
        <span className="filter-option-count">{count}</span>
      )}
    </label>
  );
}

/** Отметить или снять значение в списке, сохраняя порядок исходного списка. */
export function toggled(
  all: readonly string[],
  selected: readonly string[],
  id: string,
  on: boolean,
): string[] {
  const next = new Set(selected);
  if (on) next.add(id);
  else next.delete(id);
  return all.filter((x) => next.has(x));
}

/**
 * Наборы чекбоксами. Левая панель — одним списком под заголовком, как в макете; шторка — по группам с
 * числом иконок. needle — «Filter by name»: строки прячутся на месте, без запросов.
 */
export function SetChecks({
  lang,
  groups,
  needle,
  selected,
  onChange,
  grouped,
  title,
}: {
  lang: Lang;
  groups: readonly SidebarGroup[];
  needle: string;
  selected: readonly string[];
  onChange: (sets: string[]) => void;
  grouped: boolean;
  /** Заголовок списка без групп. */
  title?: string;
}) {
  const t = DICTIONARIES[lang];
  const all = groups.flatMap((g) => g.sets.map((s) => s.id));
  const shown = filterGroups(groups, needle);
  const row = (s: SidebarGroup["sets"][number]) => (
    <li key={s.id}>
      <FilterOption
        type="checkbox"
        checked={selected.includes(s.id)}
        onChange={(on) => onChange(toggled(all, selected, s.id, on))}
        {...(grouped ? { count: s.count } : {})}
      >
        {s.name}
      </FilterOption>
    </li>
  );
  if (shown.length === 0) {
    return (
      <p className="filter-empty" role="status">
        {t.sidebarNothing}
      </p>
    );
  }
  return grouped ? (
    <div className="filter-groups">
      {shown.map((g) => (
        <fieldset key={g.id} className="filter-group">
          <legend className="filter-group-title">{g.title}</legend>
          <ul className="filter-list">{g.sets.map(row)}</ul>
        </fieldset>
      ))}
    </div>
  ) : (
    <fieldset className="filter-group">
      <legend className="filter-group-title">{title ?? t.filterSet}</legend>
      <ul className="filter-list">{shown.flatMap((g) => g.sets).map(row)}</ul>
    </fieldset>
  );
}

/** Стиль: «Любой» и шкала стилей (ADR-0052) — один выбор. */
export function StyleChoice({
  lang,
  name,
  value,
  onChange,
}: {
  lang: Lang;
  name: string;
  value: Style | undefined;
  onChange: (style: Style | undefined) => void;
}) {
  const t = DICTIONARIES[lang];
  return (
    <fieldset className="filter-group">
      <legend className="filter-group-title">{t.searchStyle}</legend>
      <ul className="filter-list">
        <li>
          <FilterOption
            type="radio"
            name={name}
            checked={value === undefined}
            onChange={(on) => on && onChange(undefined)}
          >
            {t.styleAny}
          </FilterOption>
        </li>
        {STYLES.map((s) => (
          <li key={s}>
            <FilterOption
              type="radio"
              name={name}
              checked={value === s}
              onChange={(on) => on && onChange(s)}
            >
              {t[STYLE_KEYS[s]]}
            </FilterOption>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * Лицензии чекбоксами и пометка о коммерческих проектах (решение владельца 2 ноября 2026): пока все
 * наборы под разрешительными лицензиями — пометка со ссылкой на /licenses; появится набор с
 * ограничениями — вместо неё флажок «можно в коммерческих проектах».
 */
export function LicenseChecks({
  lang,
  licenses,
  selected,
  commercial,
  onChange,
}: {
  lang: Lang;
  licenses: readonly string[];
  selected: readonly string[];
  commercial: boolean;
  onChange: (next: { licenses: string[]; commercial: boolean }) => void;
}) {
  const t = DICTIONARIES[lang];
  return (
    <fieldset className="filter-group">
      <legend className="filter-group-title">{t.filterLicense}</legend>
      <ul className="filter-list">
        {licenses.map((l) => (
          <li key={l}>
            <FilterOption
              type="checkbox"
              checked={selected.includes(l)}
              onChange={(on) =>
                onChange({
                  licenses: toggled(licenses, selected, l, on),
                  commercial,
                })
              }
            >
              {l}
            </FilterOption>
          </li>
        ))}
        {allCommercial(licenses) ? null : (
          <li>
            <FilterOption
              type="checkbox"
              checked={commercial}
              onChange={(on) =>
                onChange({ licenses: [...selected], commercial: on })
              }
            >
              {t.searchCommercialOnly}
            </FilterOption>
          </li>
        )}
      </ul>
      {allCommercial(licenses) ? (
        <p className="filter-note">
          {t.searchCommercial}{" "}
          <PageLink lang={lang} path="/licenses">
            {t.searchCommercialLink}
          </PageLink>
        </p>
      ) : null}
    </fieldset>
  );
}
