"use client";

import { Icon } from "@iconavo-ui/react";
import { type ReactNode, useId, useRef } from "react";
import { pageSizeFor } from "../../lib/catalog";
import { useGridColumns } from "../../lib/grid-columns";
import {
  GRID_VIEWS,
  type GridSettings,
  type GridView,
  gridStore,
  ICON_SIZE_MAX,
  ICON_SIZE_MIN,
  ICON_SIZE_STEP,
  iconSizeOf,
  PER_PAGE_CHOICES,
  type PerPage,
  settingsPanelStore,
  useGridSettings,
  usePerPage,
  useSettingsPanel,
} from "../../lib/grid-settings";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import {
  useCloseOnEscape,
  useCloseOnOutsideClick,
  useSidePanel,
} from "../../lib/panel-store";
import "../../lib/iconavo";

/** id панели — для aria-controls кнопок Settings. */
export const SETTINGS_PANEL_ID = "settings-panel";

/** Протяжка ручки шторки вниз дальше этого — закрыть (как у рюкзака). */
const DRAG = 24;

export const VIEW_ICONS: Readonly<Record<GridView, string>> = {
  grid: "material-symbols:grid-on",
  large: "material-symbols:grid-view",
  list: "material-symbols:list",
};

/** Подписи видов — одни у панели и переключателя над сеткой. */
export function viewLabels(lang: Lang): Readonly<Record<GridView, string>> {
  const t = DICTIONARIES[lang];
  return { grid: t.viewGrid, large: t.viewLarge, list: t.viewList };
}

/**
 * Пункт выбора по макету: подпись слева, кружок radio справа (значки Material Symbols, как в макете).
 * Сам выбор — родной radio, невидимый поверх строки: щелчок по строке, стрелки, Пробел и экранный диктор
 * работают сами.
 */
function Option({
  name,
  checked,
  onSelect,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className="settings-option">
      <span className="settings-option-name">{children}</span>
      <input
        type="radio"
        name={name}
        className="settings-radio-input"
        checked={checked}
        onChange={onSelect}
      />
      <Icon
        icon={
          checked
            ? "material-symbols:radio-button-checked"
            : "material-symbols:radio-button-unchecked"
        }
        className="settings-radio"
      />
    </label>
  );
}

/**
 * Настройки сетки по макету «Настройки» (кадры «Settings / Opened Panel» и «Settings / Mobile — Opened
 * Sheet»; решения владельца 23 ноября 2026, ADR-0054): на компьютере — панель справа во всю высоту поверх
 * страницы, немодальная, как рюкзак; на телефоне — шторка снизу с затемнением. Разделы: View (мелкая
 * сетка, крупная сетка, список), Icon Size (размер иконки в плитке, 16–96 px) и Icons Per Page (48, 96,
 * 144, 192 — числа целыми рядами этой ширины), внизу — Reset Settings. Кнопки «Применить» нет:
 * выбор действует сразу. Закрывают ✕, Esc, кнопка Settings и щелчок мимо панели; на телефоне ещё
 * протяжка ручки вниз и тап по затемнению. Фокус — на заголовок при открытии и обратно на кнопку при
 * закрытии (после щелчка мимо — там, куда щёлкнули).
 */
export function SettingsPanel({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const open = useSettingsPanel();
  const settings = useGridSettings();
  const perPage = usePerPage();
  const columns = useGridColumns();
  const titleId = useId();
  const viewName = useId();
  const perPageName = useId();
  const perPageLabel = useId();
  const viewLabel = useId();
  const sizeId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const drag = useRef<number | undefined>(undefined);
  const dragged = useRef(false);
  const labels = viewLabels(lang);
  const size = iconSizeOf(settings);
  const close = () => settingsPanelStore.set(false);
  const update = (next: GridSettings) => gridStore.set(next);

  // Открыть и закрыть — как рюкзак (lib/panel-store.ts): на компьютере немодально, на телефоне — модально,
  // с затемнением; закрытие — с анимацией.
  useSidePanel(open, dialog, heading, settingsPanelStore, SETTINGS_PANEL_ID);

  // Esc закрывает панель первой — раньше панели иконки; открытое меню — ещё раньше (lib/panel-store.ts).
  useCloseOnEscape(open, settingsPanelStore);

  // Щелчок мимо панели закрывает её (lib/panel-store.ts).
  useCloseOnOutsideClick(open, dialog, settingsPanelStore, SETTINGS_PANEL_ID);

  return (
    // Щелчок мимо шторки попадает в сам <dialog> (его ::backdrop) — закрыть. С клавиатуры — Esc и ✕.
    // biome-ignore lint/a11y/useKeyWithClickEvents: с клавиатуры панель закрывают Esc и кнопка ✕
    <dialog
      ref={dialog}
      id={SETTINGS_PANEL_ID}
      className="bag-panel settings-panel"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="bag-panel-body">
        <button
          type="button"
          className="bag-grabber"
          aria-label={t.panelClose}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = e.clientY;
            dragged.current = false;
          }}
          onPointerUp={(e) => {
            const from = drag.current;
            drag.current = undefined;
            if (from === undefined) return;
            const dy = e.clientY - from;
            // Протяжка, а не нажатие: щелчок, который браузер пришлёт следом, не закрывает шторку —
            // закрывает только протяжка вниз (ревизия фазы 5, С-30).
            if (Math.abs(dy) > DRAG) dragged.current = true;
            if (dy > DRAG) close();
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onClick={() => {
            if (dragged.current) dragged.current = false;
            else close();
          }}
        >
          <span className="bag-grabber-bar" />
        </button>
        <div className="bag-panel-head">
          <h2
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className="bag-panel-title"
          >
            <Icon
              icon="material-symbols:settings"
              className="bag-panel-title-icon"
            />
            {t.gridSettings}
          </h2>
          <button
            type="button"
            className="bag-panel-close"
            aria-label={t.panelClose}
            onClick={close}
          >
            <Icon icon="material-symbols:close" />
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <p id={viewLabel} className="settings-label">
              {t.viewLabel}
            </p>
            <div
              role="radiogroup"
              aria-labelledby={viewLabel}
              className="settings-card"
            >
              {GRID_VIEWS.map((view) => (
                <Option
                  key={view}
                  name={viewName}
                  checked={settings.view === view}
                  onSelect={() => update({ ...settings, view })}
                >
                  <Icon
                    icon={VIEW_ICONS[view]}
                    className="settings-option-icon"
                  />
                  {labels[view]}
                </Option>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <label htmlFor={sizeId} className="settings-label">
              {t.settingsIconSize}
            </label>
            <div className="settings-card">
              <p className="settings-size" aria-hidden="true">
                <span className="settings-size-value">{size}</span> px
              </p>
              <input
                id={sizeId}
                type="range"
                className="settings-slider"
                min={ICON_SIZE_MIN}
                max={ICON_SIZE_MAX}
                step={ICON_SIZE_STEP}
                value={size}
                aria-valuetext={`${size} px`}
                onChange={(e) =>
                  update({ ...settings, size: Number(e.target.value) })
                }
              />
            </div>
          </section>
          <section className="settings-section">
            <p id={perPageLabel} className="settings-label">
              {t.settingsPerPage}
            </p>
            <div
              role="radiogroup"
              aria-labelledby={perPageLabel}
              className="settings-card"
            >
              {PER_PAGE_CHOICES.map((choice: PerPage) => (
                <Option
                  key={choice}
                  name={perPageName}
                  checked={perPage === choice}
                  onSelect={() => update({ ...settings, perPage: choice })}
                >
                  {columns === undefined
                    ? choice
                    : pageSizeFor(columns, choice)}
                </Option>
              ))}
            </div>
          </section>
        </div>
        <div className="settings-foot">
          <button
            type="button"
            className="settings-reset"
            onClick={() => gridStore.reset()}
          >
            <Icon
              icon="material-symbols:reset-settings"
              className="settings-reset-icon"
            />
            {t.settingsReset}
          </button>
        </div>
      </div>
    </dialog>
  );
}
