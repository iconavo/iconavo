"use client";

import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
// Хосты иконок — для ядра браузера: иконки выдачи грузит оно само, пачками (lib/iconavo.ts).
import "../../lib/iconavo";
import type { SearchCard } from "../../lib/search";

/**
 * Сетка выдачи поиска (шаг 3 фазы 4, ADR-0040). Клетки одного размера, имя — до двух строк: замена
 * выдачи по словам полной не двигает вёрстку. Ключ клетки — карточка, поэтому та же иконка остаётся в
 * своей клетке. Скелетоны добивают страницу до полной, пока смысл досчитывается; первые 150 мс их не
 * видно (CSS), как у заглушек пакета (ADR-0031). Карточки пока не ссылки: страницы иконок — шаг 4.
 */
export function ResultGrid({
  lang,
  cards,
  skeletons = 0,
  setTitles,
  busy = false,
}: {
  lang: Lang;
  cards: SearchCard[];
  /** Сколько скелетонов после карточек. */
  skeletons?: number;
  /** Набор → название. */
  setTitles: Record<string, string>;
  /** Идёт новый запрос, на экране — прежняя выдача. */
  busy?: boolean;
}) {
  const t = DICTIONARIES[lang];
  return (
    <ul className="result-grid" aria-busy={busy ? "true" : undefined}>
      {cards.map((card) => (
        <li key={card.card} className="result-cell" data-icon={card.icon}>
          <Icon icon={card.icon} className="result-cell-svg" />
          <span className="result-cell-name">{card.name}</span>
          <span className="result-cell-set">
            {setTitles[card.set] ?? card.set}
          </span>
          {card.exact ? (
            <span className="result-exact">{t.searchExact}</span>
          ) : null}
        </li>
      ))}
      {Array.from({ length: skeletons }, (_, i) => `skeleton-${i}`).map(
        // У пустых клеток нет своего имени: ключ — их место после карточек.
        (id) => (
          <li
            key={id}
            className="result-cell result-skeleton"
            aria-hidden="true"
          >
            <span className="result-skeleton-icon" />
            <span className="result-skeleton-line" />
          </li>
        ),
      )}
    </ul>
  );
}
