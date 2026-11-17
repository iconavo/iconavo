import { Icon } from "@iconavo-ui/react";
import type { Lang } from "../../lib/i18n";
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
  /** Витрина: на главной — 9 иконок (showcase в lib/catalog.ts), иначе — 6 из данных набора. */
  samples: string[];
  /** Стили набора по общей шкале (ADR-0052) — для фильтра. */
  styles: string[];
  /** Они же названиями: «Контур · Заливка». */
  stylesLine: string;
}

/**
 * Карточка набора по макету (Figma «Iconavo — Макеты», Icon Set Card): слева название, лицензия и число
 * иконок, справа витрина 3 × 3. Вся карточка — ссылка на страницу набора. Уровень заголовка — по
 * странице: на /sets — h2, на главной под заголовком группы — h3.
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
  const Heading = heading;
  return (
    <PageLink lang={lang} path={`/${set.id}`} className="set-card">
      <div className="set-card-info">
        <Heading className="set-card-title">{set.name}</Heading>
        <p className="set-card-meta">{set.license}</p>
        <p className="set-card-meta">{set.total}</p>
      </div>
      <div className="set-card-samples" aria-hidden="true">
        {set.samples.map((name) => (
          <Icon
            key={name}
            icon={`${set.id}:${name}`}
            className="set-card-icon"
          />
        ))}
      </div>
    </PageLink>
  );
}
