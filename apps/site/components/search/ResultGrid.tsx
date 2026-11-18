"use client";

import { Icon } from "@iconavo-ui/react";
import { type MouseEvent, memo } from "react";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { iconPagePath } from "../../lib/icon";
// Хосты иконок — для ядра браузера: иконки выдачи грузит оно само, пачками (lib/iconavo.ts).
import "../../lib/iconavo";
import type { SearchCard } from "../../lib/search";
import { useStableCallback } from "../../lib/stable-callback";
import { CardTools, type Selection } from "../catalog/Selection";
import { CARD_LINK } from "../icon/usePanel";

/** Выделение, которого нет: обработчик-пустышка с постоянной ссылкой. */
const noToggle = () => {};

/**
 * Карточка выдачи. С памятью (memo), как карточка сетки набора: открытие панели и смена иконки в ней
 * рисуют заново две карточки, а не всю страницу выдачи (18 ноября 2026). Пропсы — простые значения и
 * обработчики с постоянной ссылкой.
 */
const ResultCard = memo(function ResultCard({
  lang,
  icon,
  name,
  set,
  exact,
  current,
  tools,
  picked,
  full,
  onOpen,
  onToggle,
}: {
  lang: Lang;
  /** Полное имя: набор:иконка. */
  icon: string;
  name: string;
  /** Название набора — под именем. */
  set: string;
  /** Точное совпадение имени с запросом. */
  exact: boolean;
  /** Иконка открыта в панели. */
  current: boolean;
  /** Есть ли у карточки кнопки выбора и рюкзака. */
  tools: boolean;
  picked: boolean;
  /** Выбрано 100 — новые не выбираются. */
  full: boolean;
  onOpen: (e: MouseEvent<HTMLAnchorElement>, icon: string) => void;
  onToggle: (icon: string) => void;
}) {
  const t = DICTIONARIES[lang];
  return (
    <li
      className="icon-cell result-cell"
      data-icon={icon}
      data-exact={exact ? "" : undefined}
      data-picked={picked ? "" : undefined}
    >
      <a
        href={href(lang, iconPagePath(icon))}
        className={CARD_LINK}
        data-icon={icon}
        aria-current={current ? "true" : undefined}
        onClick={(e) => onOpen(e, icon)}
      >
        <Icon icon={icon} className="icon-cell-svg" />
        <span className="result-cell-text">
          <span className="icon-cell-name">{name}</span>
          <span className="result-cell-set">{set}</span>
        </span>
        {exact ? (
          <span className="result-exact sr-only">{t.searchExact}</span>
        ) : null}
      </a>
      {tools ? (
        <CardTools
          lang={lang}
          name={icon}
          label={name}
          picked={picked}
          full={full}
          onToggle={onToggle}
        />
      ) : null}
    </li>
  );
});

/**
 * Сетка выдачи поиска (шаг 3 фазы 4, ADR-0040; редизайн — макет «Сценарий поиска иконок»): та же сетка и
 * карточка, что у набора (колонки --icon-cols — от ширины окна), под именем — набор. Клетки одного размера,
 * имя — одной строкой: замена выдачи по словам полной не двигает вёрстку. Ключ клетки — карточка, поэтому та же иконка остаётся в
 * своей клетке. Скелетоны добивают страницу до полной, пока смысл досчитывается; первые 150 мс их не
 * видно (CSS), как у заглушек пакета (ADR-0031). Карточка — ссылка на страницу иконки: обычный щелчок
 * открывает боковую панель (onOpen), с Ctrl — страницу в новой вкладке (шаг 4 фазы 4). При наведении у
 * карточки — кнопка «в рюкзак» и чекбокс выбора (сценарий «Выделение» макета).
 */
export function ResultGrid({
  lang,
  cards,
  skeletons = 0,
  setTitles,
  busy = false,
  current,
  onOpen,
  selection,
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
  /** Выделение страницы: кнопки выбора и рюкзака у карточек. */
  selection?: Selection;
}) {
  // Карточкам — та же ссылка на обработчик при любой отрисовке (ResultCard с памятью).
  const open = useStableCallback(
    (e: MouseEvent<HTMLAnchorElement>, name: string) => onOpen?.(e, name),
  );
  return (
    <ul className="icon-grid result-grid" aria-busy={busy ? "true" : undefined}>
      {cards.map((card) => (
        <ResultCard
          key={card.card}
          lang={lang}
          icon={card.icon}
          name={card.name}
          set={setTitles[card.set] ?? card.set}
          exact={card.exact}
          current={current === card.icon}
          tools={selection !== undefined}
          picked={selection?.picked.includes(card.icon) ?? false}
          full={selection?.full ?? false}
          onOpen={open}
          onToggle={selection?.toggle ?? noToggle}
        />
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
            className="icon-cell result-cell result-skeleton"
            aria-hidden="true"
          >
            <span className="result-skeleton-icon" />
            <span className="result-skeleton-text">
              <span className="result-skeleton-line" />
              <span className="result-skeleton-line" />
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
