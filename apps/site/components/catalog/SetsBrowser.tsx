"use client";

import { countOf, formatNumber, SET_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang, STYLE_KEYS } from "../../lib/i18n";
import { isStyle, STYLES } from "../../lib/search";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { Chips } from "./Chips";
import { SetCard, type SetSummary } from "./SetCard";

/** Группа наборов — как на главной (lib/catalog.ts, SET_GROUPS): название, описание и карточки. */
export interface SetsGroup {
  id: string;
  title: string;
  text: string;
  sets: SetSummary[];
}

/**
 * Наборы по группам и фильтры «лицензия» и «стиль» (ADR-0037, ADR-0052; в стиле сайта — решения владельца 23
 * ноября 2026): фильтры — чипсами, как категории на странице набора, у каждого — число наборов при другом
 * выбранном фильтре; выбор — в адресе (?license=MIT&style=duotone), применяется в браузере. Группы без
 * подходящих наборов не показываются, у группы — число её подходящих наборов; не подошло ничего — строка и
 * «Сбросить фильтры». «Цветные» — стиль общей шкалы, отдельного фильтра цветности нет (решение владельца 2
 * ноября 2026).
 */
export function SetsBrowser({
  lang,
  groups,
}: {
  lang: Lang;
  groups: SetsGroup[];
}) {
  const t = DICTIONARIES[lang];
  const { query, hrefOf, navigate } = useUrlQuery();
  const license = query.get("license");
  const styleParam = query.get("style");
  const style = isStyle(styleParam) ? styleParam : undefined;
  const all = groups.flatMap((g) => g.sets);
  const byLicense = (s: SetSummary, id: string | null) =>
    id === null || s.licenseId === id;
  const byStyle = (s: SetSummary, value: typeof style) =>
    value === undefined || s.styles.includes(value);
  const matches = (s: SetSummary) => byLicense(s, license) && byStyle(s, style);
  const licenses = [...new Map(all.map((s) => [s.licenseId, s.license]))]
    .sort(([, a], [, b]) => a.localeCompare(b, "en"))
    .map(([id, title]) => ({ id, title }));
  const styles = STYLES.filter((s) =>
    all.some((set) => set.styles.includes(s)),
  );
  const count = (n: number) => formatNumber(lang, n);
  const chip = (
    key: string,
    label: string,
    param: "license" | "style",
    value: string | undefined,
    current: boolean,
    n: number,
  ) => {
    const next = withParams(query, { [param]: value });
    return {
      key,
      label,
      count: count(n),
      href: hrefOf(next),
      current,
      onSelect: () => navigate(next),
    };
  };
  const shown = groups
    .map((g) => ({ ...g, sets: g.sets.filter(matches) }))
    .filter((g) => g.sets.length > 0);
  return (
    <div className="set-browser">
      <div className="grid-filters">
        <Chips
          label={t.filterLicense}
          chips={[
            chip(
              "",
              t.filterAll,
              "license",
              undefined,
              license === null,
              all.filter((s) => byStyle(s, style)).length,
            ),
            ...licenses.map((l) =>
              chip(
                l.id,
                l.title,
                "license",
                l.id,
                license === l.id,
                all.filter((s) => byLicense(s, l.id) && byStyle(s, style))
                  .length,
              ),
            ),
          ]}
        />
        <Chips
          label={t.searchStyle}
          chips={[
            chip(
              "",
              t.styleAny,
              "style",
              undefined,
              style === undefined,
              all.filter((s) => byLicense(s, license)).length,
            ),
            ...styles.map((s) =>
              chip(
                s,
                t[STYLE_KEYS[s]],
                "style",
                s,
                style === s,
                all.filter((set) => byLicense(set, license) && byStyle(set, s))
                  .length,
              ),
            ),
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <p className="grid-status grid-empty" role="status">
          {t.filterNone}{" "}
          <button
            type="button"
            className="grid-clear"
            onClick={() =>
              navigate(
                withParams(query, { license: undefined, style: undefined }),
              )
            }
          >
            {t.filterClear}
          </button>
        </p>
      ) : (
        <div className="sets-groups">
          {shown.map((g) => (
            <section
              key={g.id}
              className="set-group"
              data-group={g.id}
              aria-labelledby={`sets-group-${g.id}`}
            >
              <div className="set-group-head">
                <h2 id={`sets-group-${g.id}`} className="set-group-title">
                  {g.title}{" "}
                  <span className="set-group-count">
                    ({countOf(lang, g.sets.length, SET_FORMS[lang])})
                  </span>
                </h2>
                <p className="set-group-text">{g.text}</p>
              </div>
              <div className="set-grid">
                {g.sets.map((set) => (
                  <SetCard key={set.id} lang={lang} set={set} heading="h3" />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
