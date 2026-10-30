import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PageLink } from "../PageLink";

/** Набор для карточки: строки уже на языке страницы — их считает сервер (lib/format.ts). */
export interface SetSummary {
  id: string;
  name: string;
  /** «1,998 icons» / «1 998 иконок». */
  total: string;
  author: string;
  /** Название лицензии: MIT, ISC, Apache 2.0. */
  license: string;
  /** SPDX — для фильтра. */
  licenseId: string;
  palette: boolean;
  samples: string[];
}

/**
 * Карточка набора: название, витрина, число иконок, лицензия и автор. Уровень заголовка — по странице:
 * на /sets — h2, на главной под разделом «Популярные наборы» — h3.
 */
export function SetCard({
  lang,
  set,
  heading = "h2",
}: {
  lang: Lang;
  set: SetSummary;
  heading?: "h2" | "h3";
}) {
  const t = DICTIONARIES[lang];
  const Heading = heading;
  return (
    <article className="set-card">
      <Heading className="set-card-title">
        <PageLink lang={lang} path={`/${set.id}`}>
          {set.name}
        </PageLink>
      </Heading>
      <p className="set-card-samples" aria-hidden="true">
        {set.samples.map((name) => (
          <Icon
            key={name}
            icon={`${set.id}:${name}`}
            className="inline-block"
          />
        ))}
      </p>
      <p className="set-card-meta">
        {set.total} · {set.license}
        {set.palette ? ` · ${t.setMulticolor}` : ""}
      </p>
      <p className="set-card-meta">{set.author}</p>
    </article>
  );
}
