"use client";

import { Icon } from "@iconavo-ui/react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { markOpenSource } from "../../lib/analytics";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { bareName, type IconDetails, iconPagePath } from "../../lib/icon";
import type { IconPageData } from "../../lib/icon-page";
import type { DetailsState } from "../icon/useIconDetails";
// Хосты иконок — для ядра браузера: похожие из других наборов рисует оно (lib/iconavo.ts).
import "../../lib/iconavo";

/** Скелетонов, пока похожие грузятся, — две строки макета. */
const SKELETONS = 14;

/**
 * Вкладка Similar icons по макету: карточки похожих — иконка, имя и набор, ссылки на их страницы с
 * настройками в адресе (решение владельца 2 ноября 2026), без предзагрузки: каждая видимая ссылка иначе
 * собирала бы страницу. Похожие — из /icon (поиск Meilisearch): не ответил — сообщение и «Повторить».
 * «Show more similar icons» — после доработки edge API (решение владельца 13 ноября 2026).
 */
export function Similar({
  lang,
  page,
  details,
  state,
  onRetry,
  query,
  onFollow,
}: {
  lang: Lang;
  page: IconPageData;
  details: IconDetails | undefined;
  state: DetailsState;
  onRetry: () => void;
  /** Настройки иконки в адресе — переходят на страницу похожей. */
  query: string;
  /** Переход со скелетоном на время сборки страницы. */
  onFollow?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const t = DICTIONARIES[lang];
  if (state === "failed") {
    return (
      <p className="ip-lead ip-failed" role="alert">
        {t.ipSimilarFailed}{" "}
        <button
          type="button"
          className="panel-btn panel-btn-outline panel-btn-sm"
          onClick={onRetry}
        >
          {t.ipRetry}
        </button>
      </p>
    );
  }
  const lead = (
    <p className="ip-lead">
      {page.hidden ? t.ipSimilarLeadRemoved : t.ipSimilarLead}
    </p>
  );
  if (details === undefined) {
    return (
      <>
        <span className="ip-skeleton ip-skeleton-lead" aria-hidden="true" />
        <p className="sr-only" aria-live="polite">
          {t.ipLoading}
        </p>
        <ul className="ip-similar" aria-hidden="true">
          {Array.from({ length: SKELETONS }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: скелетоны одинаковые и не переставляются
            <li key={i} className="ip-similar-card ip-similar-skeleton">
              <span className="ip-skeleton ip-skeleton-icon" />
              <span className="ip-skeleton ip-skeleton-name" />
              <span className="ip-skeleton ip-skeleton-set" />
            </li>
          ))}
        </ul>
      </>
    );
  }
  if (details.similar.length === 0) {
    return (
      <>
        {lead}
        <p className="ip-lead">{t.ipSimilarNone}</p>
      </>
    );
  }
  return (
    <>
      {lead}
      <ul className="ip-similar">
        {details.similar.map((name) => {
          const prefix = name.slice(0, name.indexOf(":"));
          return (
            <li key={name}>
              <Link
                href={`${href(lang, iconPagePath(name))}${query === "" ? "" : `?${query}`}`}
                prefetch={false}
                className="ip-similar-card"
                data-icon={name}
                onClick={(e) => {
                  // Аналитика: следующая страница иконки открыта из похожих.
                  markOpenSource("similar");
                  onFollow?.(e);
                }}
              >
                <Icon icon={name} className="ip-similar-icon" />
                <span className="ip-similar-text">
                  <span className="ip-similar-name">{bareName(name)}</span>
                  <span className="ip-similar-set">
                    {page.setNames[prefix] ?? prefix}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
