import { Icon } from "@iconavo-ui/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { Soon } from "../shell/Soon";

/**
 * Строка над сеткой и под ней по макету: «Icons per page: 96» (выбора пока нет — «Soon»), пунктир и
 * номера страниц. На телефоне — только номера страниц внизу (globals.css).
 */
export function GridBar({
  lang,
  top,
  start,
  children,
}: {
  lang: Lang;
  /** Строка над сеткой: на телефоне её нет. */
  top?: boolean;
  /** Что стоит в начале строки: «Выбрать несколько» — над сеткой. */
  start?: ReactNode;
  /** Номера страниц (Pagination). */
  children: ReactNode;
}) {
  const t = DICTIONARIES[lang];
  return (
    <div className={cn("grid-bar", top && "grid-bar-top")}>
      {start}
      <Soon lang={lang} className="per-page" above={!top}>
        <span className="per-page-label">{t.perPage}</span>
        <span>96</span>
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
