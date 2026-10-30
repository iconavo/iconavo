"use client";

import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { Chips } from "./Chips";
import { ReleaseItem, type ReleaseView } from "./ReleaseItem";

/**
 * Лента «Что нового»: выпуски всех наборов, свежие сверху, и фильтр по набору в адресе (?set=lucide) —
 * на него ведут README пакетов данных в npm (ADR-0026).
 */
export function ReleasesBrowser({
  lang,
  releases,
  sets,
}: {
  lang: Lang;
  releases: ReleaseView[];
  sets: { id: string; name: string }[];
}) {
  const t = DICTIONARIES[lang];
  const { query, hrefOf, navigate } = useUrlQuery();
  const set = query.get("set");
  const shown =
    set === null ? releases : releases.filter((r) => r.prefix === set);
  const chip = (key: string, label: string, value: string | undefined) => {
    const next = withParams(query, { set: value });
    return {
      key,
      label,
      href: hrefOf(next),
      current: (set ?? undefined) === value,
      onSelect: () => navigate(next),
    };
  };
  return (
    <>
      <Chips
        label={t.newsSet}
        chips={[
          chip("", t.filterAll, undefined),
          ...sets.map((s) => chip(s.id, s.name, s.id)),
        ]}
      />
      <div className="releases">
        {shown.map((release) => (
          <ReleaseItem key={release.id} lang={lang} release={release} />
        ))}
      </div>
    </>
  );
}
