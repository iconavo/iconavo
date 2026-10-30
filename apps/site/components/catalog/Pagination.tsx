"use client";

import { Icon } from "@iconavo-ui/react";
import type { ReactNode } from "react";
import { pageItems } from "../../lib/catalog";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { plainClick } from "./Chips";

/** Номера страниц: первая, соседние с текущей, последняя; пропуски — «…» (ADR-0040: пагинация). */
export function Pagination({
  lang,
  page,
  pages,
  hrefOf,
  onSelect,
}: {
  lang: Lang;
  page: number;
  pages: number;
  hrefOf: (page: number) => string;
  onSelect: (page: number) => void;
}) {
  if (pages <= 1) return null;
  const t = DICTIONARIES[lang];
  const link = (to: number, content: ReactNode, label?: string) => (
    <a
      href={hrefOf(to)}
      aria-label={label}
      aria-current={to === page && label === undefined ? "page" : undefined}
      onClick={(e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        onSelect(to);
      }}
    >
      {content}
    </a>
  );
  return (
    <nav aria-label={t.setPages} className="pagination">
      <ul className="pagination-list">
        <li>
          {page > 1 ? (
            link(page - 1, <Icon icon="lucide:chevron-left" />, t.pagePrev)
          ) : (
            <span className="pagination-off" aria-hidden="true">
              <Icon icon="lucide:chevron-left" />
            </span>
          )}
        </li>
        {pageItems(page, pages).map((item, i) => (
          <li key={item === "gap" ? `gap-${i}` : item}>
            {item === "gap" ? (
              <span className="pagination-gap">…</span>
            ) : (
              link(item, item)
            )}
          </li>
        ))}
        <li>
          {page < pages ? (
            link(page + 1, <Icon icon="lucide:chevron-right" />, t.pageNext)
          ) : (
            <span className="pagination-off" aria-hidden="true">
              <Icon icon="lucide:chevron-right" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
