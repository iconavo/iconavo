"use client";

import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { Chips } from "./Chips";
import { SetCard, type SetSummary } from "./SetCard";

/**
 * Все наборы карточками и фильтры «лицензия» и «цвета» (ADR-0037) — в адресе (?license=MIT&palette=color),
 * применяются в браузере. Фильтр по стилю — шаг 3, вместе с общей шкалой стилей (ADR-0049).
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
  const palette = query.get("palette");
  const licenses = [...new Map(sets.map((s) => [s.licenseId, s.license]))]
    .sort(([, a], [, b]) => a.localeCompare(b, "en"))
    .map(([id, title]) => ({ id, title }));
  const shown = sets.filter(
    (s) =>
      (license === null || s.licenseId === license) &&
      (palette === null || (palette === "color") === s.palette),
  );
  const chip = (
    key: string,
    label: string,
    param: "license" | "palette",
    value: string | undefined,
  ) => {
    const next = withParams(query, { [param]: value });
    return {
      key,
      label,
      href: hrefOf(next),
      current: (query.get(param) ?? undefined) === value,
      onSelect: () => navigate(next),
    };
  };
  return (
    <>
      <div className="filters">
        <Chips
          label={t.filterLicense}
          chips={[
            chip("", t.filterAll, "license", undefined),
            ...licenses.map((l) => chip(l.id, l.title, "license", l.id)),
          ]}
        />
        <Chips
          label={t.filterColors}
          chips={[
            chip("", t.filterAll, "palette", undefined),
            chip("mono", t.filterMono, "palette", "mono"),
            chip("color", t.filterColor, "palette", "color"),
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
