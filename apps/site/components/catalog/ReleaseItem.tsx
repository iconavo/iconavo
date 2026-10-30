import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PageLink } from "../PageLink";

/** Список изменений одного вида: «Добавлены: 79» и имена. */
export interface ReleaseList {
  kind: "added" | "changed" | "restored" | "hidden" | "renamed" | "aliases";
  label: string;
  count: string;
  names: string[];
}

/** Выпуск для ленты: строки уже на языке страницы — их считает сервер (lib/format.ts). */
export interface ReleaseView {
  /** Якорь: {набор}-{версия}. */
  id: string;
  prefix: string;
  setName: string;
  /** Дата по UTC для <time>. */
  iso: string;
  date: string;
  /** Версия npm или 7 знаков коммита. */
  revision: string;
  total: string;
  /** Первая запись журнала набора. */
  first: boolean;
  /** Добавленные иконки для превью — не больше 24. */
  preview: string[];
  lists: ReleaseList[];
}

/** Выпуск набора в ленте «Что нового» (ADR-0018): дата, источник, превью новых иконок, списки имён. */
export function ReleaseItem({
  lang,
  release: r,
}: {
  lang: Lang;
  release: ReleaseView;
}) {
  const t = DICTIONARIES[lang];
  return (
    <article className="release" id={r.id}>
      <h2 className="release-title">
        <PageLink lang={lang} path={`/${r.prefix}`}>
          {r.setName}
        </PageLink>
      </h2>
      <p className="release-meta">
        <time dateTime={r.iso}>{r.date}</time> · {t.newsSource}: {r.revision} ·{" "}
        {t.newsIcons}: {r.total}
      </p>
      {r.first ? <p>{t.newsFirst}</p> : null}
      {r.preview.length > 0 ? (
        <p className="release-icons" aria-hidden="true">
          {r.preview.map((name) => (
            <Icon
              key={name}
              icon={`${r.prefix}:${name}`}
              className="inline-block"
            />
          ))}
        </p>
      ) : null}
      {r.lists.length > 0 ? (
        <ul className="release-lists">
          {r.lists.map((list) => (
            <li key={list.kind}>
              <details>
                <summary>
                  {list.label}: {list.count}
                </summary>
                <p className="release-names">{list.names.join(", ")}</p>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
