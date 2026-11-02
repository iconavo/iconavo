"use client";

import { Icon } from "@iconavo-ui/react";
import type { MouseEvent } from "react";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { iconPagePath } from "../../lib/icon";
// Хосты иконок — для ядра браузера: иконки выдачи грузит оно само, пачками (lib/iconavo.ts).
import "../../lib/iconavo";
import type { SearchCard } from "../../lib/search";
import { CARD_LINK } from "../icon/usePanel";

/**
 * Сетка выдачи поиска (шаг 3 фазы 4, ADR-0040). Клетки одного размера, имя — до двух строк: замена
 * выдачи по словам полной не двигает вёрстку. Ключ клетки — карточка, поэтому та же иконка остаётся в
 * своей клетке. Скелетоны добивают страницу до полной, пока смысл досчитывается; первые 150 мс их не
 * видно (CSS), как у заглушек пакета (ADR-0031). Карточка — ссылка на страницу иконки: обычный щелчок
 * открывает боковую панель (onOpen), с Ctrl — страницу в новой вкладке (шаг 4 фазы 4).
 */
export function ResultGrid({
  lang,
  cards,
  skeletons = 0,
  setTitles,
  busy = false,
  current,
  onOpen,
}: {
  lang: Lang;
  cards: SearchCard[];
  /** Сколько скелетонов после карточек. */
  skeletons?: number;
  /** Набор → название. */
  setTitles: Record<string, string>;
  /** Идёт новый запрос, на экране — прежняя выдача. */
  busy?: boolean;
  /** Иконка открытой панели — её карточка отмечена. */
  current?: string;
  onOpen?: (e: MouseEvent<HTMLAnchorElement>, name: string) => void;
}) {
  const t = DICTIONARIES[lang];
  return (
    <ul className="result-grid" aria-busy={busy ? "true" : undefined}>
      {cards.map((card) => (
        <li key={card.card} className="result-cell" data-icon={card.icon}>
          <a
            href={href(lang, iconPagePath(card.icon))}
            className={CARD_LINK}
            data-icon={card.icon}
            aria-current={current === card.icon ? "true" : undefined}
            onClick={(e) => onOpen?.(e, card.icon)}
          >
            <Icon icon={card.icon} className="result-cell-svg" />
            <span className="result-cell-name">{card.name}</span>
            <span className="result-cell-set">
              {setTitles[card.set] ?? card.set}
            </span>
            {card.exact ? (
              <span className="result-exact">{t.searchExact}</span>
            ) : null}
          </a>
        </li>
      ))}
      {Array.from(
        { length: skeletons },
        (_, i) => `skeleton-${cards.length + i}`,
      ).map(
        // У пустых клеток нет своего имени: ключ — их место в сетке. Пришли первые карточки — их клетки
        // уходят, а остальные пустые остаются на местах: с ключом по номеру среди пустых React сдвигал
        // бы каждую на столько клеток, сколько пришло карточек (сдвиг вёрстки 0,31 в Chrome).
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
