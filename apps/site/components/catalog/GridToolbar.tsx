"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useId, useRef, useState } from "react";
import {
  GRID_VIEWS,
  gridStore,
  settingsPanelStore,
  useGridSettings,
  useSettingsPanel,
} from "../../lib/grid-settings";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { QUERY_MAX_LENGTH, TYPING_PAUSE_MS } from "../../lib/search";
import {
  SETTINGS_PANEL_ID,
  VIEW_ICONS,
  viewLabels,
} from "../settings/SettingsPanel";
import { SEARCH_INPUT_ID } from "../shell/HotKey";

/**
 * Панель над сеткой набора по макету (Figma «Iconavo — Макеты», Search Bar страницы набора): поиск по
 * набору, вид и настройки. Поиск отбирает карточки по имени прямо в браузере (filterCards в
 * lib/catalog.ts) и пишет запрос в адрес (?q=) после паузы набора. Вид и Settings — настройки сетки
 * (ADR-0054). Переключателя AI Search из макета нет и не будет (решение владельца 23 ноября 2026,
 * ADR-0040).
 */
export function GridToolbar({
  lang,
  setName,
  query,
  onQuery,
}: {
  lang: Lang;
  setName: string;
  /** Запрос из адреса. */
  query: string;
  onQuery: (q: string) => void;
}) {
  const t = DICTIONARIES[lang];
  const [text, setText] = useState(query);
  const committed = useRef(query);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Адрес сменился не из поля — «назад», ссылка, «Очистить»: поле показывает его.
  useEffect(() => {
    if (query === committed.current) return;
    committed.current = query;
    setText(query);
  }, [query]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (value: string) => {
    clearTimeout(timer.current);
    const q = value.trim();
    if (q === committed.current) return;
    committed.current = q;
    onQuery(q);
  };
  const placeholder = t.setSearch.replace("{set}", setName);

  // Обёртка — точка отсчёта для компактной строки (контейнерные запросы, app/globals.css).
  return (
    <div className="grid-toolbar-box">
      <div className="grid-toolbar">
        <search className="grid-search">
          <form
            className="hero-field grid-field"
            onSubmit={(e) => {
              e.preventDefault();
              commit(text);
            }}
          >
            <Icon icon="material-symbols:search" className="hero-field-icon" />
            <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
              {placeholder}
            </label>
            <input
              id={SEARCH_INPUT_ID}
              type="search"
              className="hero-input"
              value={text}
              maxLength={QUERY_MAX_LENGTH}
              placeholder={placeholder}
              autoComplete="off"
              aria-keyshortcuts="Control+K Meta+K"
              onChange={(e) => {
                const value = e.target.value;
                setText(value);
                clearTimeout(timer.current);
                timer.current = setTimeout(
                  () => commit(value),
                  TYPING_PAUSE_MS,
                );
              }}
            />
            <span className="hero-keys" aria-hidden="true">
              <kbd>Ctrl</kbd>
              <kbd>K</kbd>
            </span>
          </form>
        </search>
        <ViewSwitch lang={lang} />
        <GridSettings lang={lang} />
      </div>
    </div>
  );
}

/**
 * Вид сетки — тот же выбор, что раздел View панели настроек (lib/grid-settings.ts, ADR-0054): мелкая
 * сетка, крупная сетка, список. Родные radio, невидимые поверх значков. Выбранный подсвечен по
 * data-grid-view у <html> (globals.css): его ставит скрипт в <head>, и подсветка верна ещё до гидратации.
 */
export function ViewSwitch({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const settings = useGridSettings();
  const name = useId();
  const labels = viewLabels(lang);
  return (
    <fieldset className="view-switch">
      <legend className="sr-only">{t.viewLabel}</legend>
      {GRID_VIEWS.map((view) => (
        <label key={view} className="view-item" data-view={view}>
          <input
            type="radio"
            name={name}
            className="view-input"
            checked={settings.view === view}
            onChange={() => gridStore.set({ ...settings, view })}
          />
          <Icon icon={VIEW_ICONS[view]} />
          <span className="sr-only">{labels[view]}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Кнопка Settings — открывает и закрывает панель настроек (components/settings/SettingsPanel.tsx); в узкой
 * строке и на телефоне — квадратная кнопка со значком, подпись тогда только у экранного диктора.
 */
export function GridSettings({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const open = useSettingsPanel();
  return (
    <button
      type="button"
      className="grid-settings"
      aria-label={t.gridSettings}
      aria-expanded={open}
      aria-controls={SETTINGS_PANEL_ID}
      onClick={(e) => settingsPanelStore.set(!open, e.currentTarget)}
    >
      <Icon icon="material-symbols:settings" className="grid-settings-icon" />
      <span className="grid-settings-label" aria-hidden="true">
        {t.gridSettings}
      </span>
    </button>
  );
}
