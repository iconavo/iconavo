"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useId, useRef, useState } from "react";
import type { SidebarGroup } from "../../lib/catalog-view";
import {
  filterSheetStore,
  useFilterCount,
  useFilterSheet,
} from "../../lib/filter-sheet";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { activeFilters, type FilterState } from "../../lib/search";
import { NameFilter } from "../shell/SidebarSets";
import { LicenseChecks, SetChecks, StyleChoice } from "./SearchFilters";

/** id шторки — для aria-controls кнопки фильтра. */
export const FILTER_SHEET_ID = "filter-sheet";

/** Протяжка ручки шторки вниз дальше этого — закрыть, как у рюкзака. */
const DRAG = 24;

/**
 * Шторка фильтра на телефоне по макету (кадр «Search Results / Mobile — Filter»): снизу, с затемнением;
 * ручка, заголовок и «N selected», разделы Sets (поиск по названию, группы с числом иконок), Style и
 * License (решение владельца 17 ноября 2026 — те же три раздела, что во вкладках левой панели), внизу
 * закреплены Reset и Show results. Выбор — черновик: выдача меняется только по Show results, чтобы сетка
 * не дёргалась на каждый чекбокс (заметка макета); Reset очищает черновик. Закрывают ✕, Esc, тап по
 * затемнению и протяжка ручки вниз — без применения. Фокус — на заголовок и обратно на кнопку фильтра.
 */
export function FilterSheet({
  lang,
  groups,
  licenses,
  value,
  onApply,
}: {
  lang: Lang;
  groups: readonly SidebarGroup[];
  licenses: readonly string[];
  /** Фильтры выдачи сейчас — с них начинается черновик при каждом открытии. */
  value: FilterState;
  onApply: (filters: FilterState) => void;
}) {
  const t = DICTIONARIES[lang];
  const open = useFilterSheet();
  const titleId = useId();
  const styleName = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const drag = useRef<number | undefined>(undefined);
  const [draft, setDraft] = useState<FilterState>(value);
  const [needle, setNeedle] = useState("");

  // Ушли со страницы с открытой шторкой («назад» на телефоне) — флаг в общем хранилище закрыт: иначе при
  // следующем заходе на поиск шторка открылась бы сама (ревизия фазы 5, С-9).
  useEffect(() => () => filterSheetStore.set(false), []);

  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    if (open && !el.open) {
      el.showModal();
      heading.current?.focus();
    } else if (!open && el.open) {
      el.close();
      filterSheetStore.takeOpener()?.focus();
    }
  }, [open]);

  // Шторка открылась — черновик с фильтров выдачи, поиск по названию пустой (состояние от прошлой
  // отрисовки, как советует React: без эффекта и лишнего кадра со старым черновиком).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(value);
      setNeedle("");
    }
  }

  const close = () => filterSheetStore.set(false);
  const selected = activeFilters({ q: "", page: 1, ...draft });

  return (
    // Щелчок мимо шторки попадает в сам <dialog> (его ::backdrop) — закрыть. С клавиатуры — Esc и ✕.
    // biome-ignore lint/a11y/useKeyWithClickEvents: с клавиатуры шторку закрывают Esc и кнопка ✕
    <dialog
      ref={dialog}
      id={FILTER_SHEET_ID}
      className="filter-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="filter-sheet-body">
        <button
          type="button"
          className="bag-grabber"
          aria-label={t.panelClose}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = e.clientY;
          }}
          onPointerUp={(e) => {
            const from = drag.current;
            drag.current = undefined;
            if (from !== undefined && e.clientY - from > DRAG) close();
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onClick={close}
        >
          <span className="bag-grabber-bar" />
        </button>
        <div className="filter-sheet-head">
          <div className="filter-sheet-heading">
            <h2
              id={titleId}
              ref={heading}
              tabIndex={-1}
              className="filter-sheet-title"
            >
              {t.filterTitle}
            </h2>
            <p className="filter-sheet-count" aria-live="polite">
              {t.filterSelected.replace("{n}", String(selected))}
            </p>
          </div>
          <button
            type="button"
            className="bag-panel-close"
            aria-label={t.panelClose}
            onClick={close}
          >
            <Icon icon="material-symbols:close" />
          </button>
        </div>
        <div className="filter-sheet-list">
          <fieldset className="filter-section">
            <legend className="filter-section-title">{t.sidebarTabSets}</legend>
            <NameFilter lang={lang} value={needle} onChange={setNeedle} />
            <SetChecks
              lang={lang}
              groups={groups}
              needle={needle}
              selected={draft.sets}
              onChange={(sets) => setDraft((d) => ({ ...d, sets }))}
              grouped
            />
          </fieldset>
          <StyleChoice
            lang={lang}
            name={styleName}
            value={draft.style}
            onChange={(style) =>
              setDraft(({ style: _, ...d }) =>
                style === undefined ? d : { ...d, style },
              )
            }
          />
          <LicenseChecks
            lang={lang}
            licenses={licenses}
            selected={draft.licenses}
            commercial={draft.commercial === true}
            onChange={({ licenses: next, commercial }) =>
              setDraft(({ commercial: _, ...d }) => ({
                ...d,
                licenses: next,
                ...(commercial ? { commercial: true as const } : {}),
              }))
            }
          />
        </div>
        <div className="filter-sheet-foot">
          <button
            type="button"
            className="filter-sheet-reset"
            onClick={() => setDraft({ sets: [], licenses: [] })}
          >
            {t.filterReset}
          </button>
          <button
            type="button"
            className="filter-sheet-show"
            onClick={() => {
              onApply(draft);
              close();
            }}
          >
            {t.filterShow}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Кнопка фильтра в строке инструментов — только на телефоне (на компьютере фильтры в левой панели): значок
 * с ползунками и счётчик выбранного (заметка макета «счётчик активных фильтров»). Подпись — «Фильтры: 2»:
 * видимое число входит в неё (WCAG 2.5.3).
 */
export function FilterButton({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const open = useFilterSheet();
  const count = useFilterCount();
  return (
    <button
      type="button"
      className="search-filter-button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={FILTER_SHEET_ID}
      onClick={(e) => filterSheetStore.set(true, e.currentTarget)}
    >
      <Icon icon="material-symbols:tune" className="search-filter-icon" />
      <span className="sr-only">
        {count > 0 ? `${t.filterTitle}: ${count}` : t.filterTitle}
      </span>
      {count > 0 ? (
        <span className="search-filter-count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  );
}
