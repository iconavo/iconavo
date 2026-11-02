"use client";

import { DICTIONARIES, type Lang, STYLE_KEYS } from "../../lib/i18n";
import { isStyle, STYLES } from "../../lib/search";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { Chips } from "./Chips";
import { SetCard, type SetSummary } from "./SetCard";

/**
 * Все наборы карточками и фильтры «лицензия» и «стиль» (ADR-0037, ADR-0052) — в адресе
 * (?license=MIT&style=duotone), применяются в браузере. «Цветные» — стиль общей шкалы, отдельного
 * фильтра цветности нет (решение владельца 2 ноября 2026).
 */
export function SetsBrowser({
  lang,
  sets,
}: {
  lang: Lang;
  sets: SetSummary[];
}) {
  const t = DICTIONARIES[lang];
  const { query, hrefOf, navigate } = useUrlQuery();
  const license = query.get("license");
  const styleParam = query.get("style");
  const style = isStyle(styleParam) ? styleParam : undefined;
  const licenses = [...new Map(sets.map((s) => [s.licenseId, s.license]))]
    .sort(([, a], [, b]) => a.localeCompare(b, "en"))
    .map(([id, title]) => ({ id, title }));
  const styles = STYLES.filter((s) =>
    sets.some((set) => set.styles.includes(s)),
  );
  const shown = sets.filter(
    (s) =>
      (license === null || s.licenseId === license) &&
      (style === undefined || s.styles.includes(style)),
  );
  const chip = (
    key: string,
    label: string,
    param: "license" | "style",
    value: string | undefined,
    current: boolean,
  ) => {
    const next = withParams(query, { [param]: value });
    return {
      key,
      label,
      href: hrefOf(next),
      current,
      onSelect: () => navigate(next),
    };
  };
  return (
    <>
      <div className="filters">
        <Chips
          label={t.filterLicense}
          chips={[
            chip("", t.filterAll, "license", undefined, license === null),
            ...licenses.map((l) =>
              chip(l.id, l.title, "license", l.id, license === l.id),
            ),
          ]}
        />
        <Chips
          label={t.searchStyle}
          chips={[
            chip("", t.styleAny, "style", undefined, style === undefined),
            ...styles.map((s) =>
              chip(s, t[STYLE_KEYS[s]], "style", s, style === s),
            ),
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <p>{t.filterNone}</p>
      ) : (
        <div className="set-grid">
          {shown.map((set) => (
            <SetCard key={set.id} lang={lang} set={set} />
          ))}
        </div>
      )}
    </>
  );
}
