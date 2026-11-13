import { Icon } from "@iconavo-ui/react";
import type { ReactNode } from "react";
import { PAGE_SIZE } from "../../lib/catalog";
import { cn } from "../../lib/cn";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { Soon } from "../shell/Soon";

/**
 * Строка над сеткой и под ней по макету: «Icons per page: N» (выбора пока нет — «Soon»), пунктир и
 * номера страниц. N — целые ряды этой ширины (pageSizeFor); пока браузер не посчитал колонки, строка
 * невидима и держит место — неверное число и номера страниц не мелькают. На телефоне — только номера
 * страниц внизу (globals.css).
 */
export function GridBar({
  lang,
  top,
  start,
  perPage,
  children,
}: {
  lang: Lang;
  /** Строка над сеткой: на телефоне её нет. */
  top?: boolean;
  /** Что стоит в начале строки: «Выбрать несколько» — над сеткой. */
  start?: ReactNode;
  /** Иконок на странице; undefined — колонки ещё не посчитаны. */
  perPage?: number;
  /** Номера страниц (Pagination). */
  children: ReactNode;
}) {
  const t = DICTIONARIES[lang];
  return (
    <div
      className={cn("grid-bar", top && "grid-bar-top")}
      data-pending={perPage === undefined ? "" : undefined}
    >
      {start}
      <Soon lang={lang} className="per-page" above={!top}>
        <span className="per-page-label">{t.perPage}</span>
        <span className="per-page-count">{perPage ?? PAGE_SIZE}</span>
        <Icon
          icon="material-symbols:keyboard-arrow-down"
          className="pill-chevron"
        />
      </Soon>
      <span className="grid-bar-line" aria-hidden="true" />
      {children}
    </div>
  );
}
