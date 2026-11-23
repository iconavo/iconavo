"use client";

import { Icon } from "@iconavo-ui/react";
import type { ReactNode } from "react";
import { PAGE_SIZE, pageSizeFor } from "../../lib/catalog";
import { cn } from "../../lib/cn";
import { useGridColumns } from "../../lib/grid-columns";
import {
  gridStore,
  isPerPage,
  PER_PAGE_CHOICES,
  useGridSettings,
  usePerPage,
} from "../../lib/grid-settings";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/**
 * «Icons per page: N ▾» — меню с выбором из раздела Icons Per Page настроек сетки (ADR-0054): 48, 96,
 * 144, 192, каждое — целыми рядами этой ширины (pageSizeFor), поэтому в меню — числа, которые встанут на
 * страницу. Под сеткой меню открывается вверх.
 */
function PerPageMenu({
  lang,
  perPage,
  above,
}: {
  lang: Lang;
  /** Иконок на странице сейчас; undefined — колонки ещё не посчитаны. */
  perPage: number | undefined;
  above: boolean;
}) {
  const t = DICTIONARIES[lang];
  const settings = useGridSettings();
  const chosen = usePerPage();
  const columns = useGridColumns();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="per-page">
          <span className="per-page-label">{t.perPage}</span>
          <span className="per-page-count">{perPage ?? PAGE_SIZE}</span>
          <Icon
            icon="material-symbols:keyboard-arrow-down"
            className="pill-chevron"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={above ? "top" : "bottom"}
        className="panel-menu"
      >
        <DropdownMenuRadioGroup
          value={String(chosen)}
          onValueChange={(value) => {
            const next = Number(value);
            if (isPerPage(next)) gridStore.set({ ...settings, perPage: next });
          }}
        >
          {PER_PAGE_CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={String(choice)}>
              {columns === undefined ? choice : pageSizeFor(columns, choice)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Строка над сеткой и под ней по макету: «Icons per page: N ▾» (выбор — PerPageMenu), пунктир и номера
 * страниц. N — целые ряды этой ширины (pageSizeFor); пока браузер не посчитал колонки, строка невидима и
 * держит место — неверное число и номера страниц не мелькают. На телефоне — только номера страниц внизу
 * (globals.css): число там меняют настройки сетки.
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
  return (
    <div
      className={cn("grid-bar", top && "grid-bar-top")}
      data-pending={perPage === undefined ? "" : undefined}
    >
      {start}
      <PerPageMenu lang={lang} perPage={perPage} above={!top} />
      <span className="grid-bar-line" aria-hidden="true" />
      {children}
    </div>
  );
}
