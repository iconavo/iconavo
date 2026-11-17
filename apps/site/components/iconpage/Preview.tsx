"use client";

import { Icon } from "@iconavo-ui/react";
import { useSyncExternalStore } from "react";
import { cn } from "../../lib/cn";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import {
  gridPath,
  type IconPageData,
  PREVIEW_SIZES,
  type PreviewBg,
} from "../../lib/icon-page";
import { type IconSettings, iconProps } from "../../lib/icon-settings";
import { previewBgStore, previewGridStore, useChoice } from "../../lib/prefs";
import { isDark, subscribeScheme, themeStore } from "../../lib/theme";

/** Превью — 288 px в плитке 320 (макет), на телефоне тянется на всю ширину. */
const PREVIEW_PX = 288;

/** Тема на экране после гидратации; на сервере — неизвестна. */
function useScreenDark(): boolean | undefined {
  return useSyncExternalStore(
    (listener) => {
      const offTheme = themeStore.subscribe(listener);
      const offScheme = subscribeScheme(listener);
      return () => {
        offTheme();
        offScheme();
      };
    },
    () => isDark(),
    () => undefined,
  );
}

const BG_CLASS: Record<Exclude<PreviewBg, "auto">, string> = {
  dark: "preview-dark",
  light: "preview-light",
  transparent: "ip-tile-transparent",
};

/**
 * Превью по макету: плитка 320 × 320 с сеткой иконки (единица холста — клетка) и иконкой во всю сетку,
 * под ней — фон Dark, Light или Transparent и выключатель сетки (выбор запоминается). Пока фон не
 * выбран, он как тема сайта. Size, Color и Stroke Width меняют превью, как в панели. У скрытой иконки —
 * бледный рисунок (состояние Removed).
 */
export function PreviewTile({
  lang,
  page,
  s,
}: {
  lang: Lang;
  page: IconPageData;
  s: IconSettings;
}) {
  const t = DICTIONARIES[lang];
  const bg = useChoice(previewBgStore);
  const grid = useChoice(previewGridStore) === "on";
  const dark = useScreenDark();
  const shown: Exclude<PreviewBg, "auto"> | undefined =
    bg === "auto"
      ? dark === undefined
        ? undefined
        : dark
          ? "dark"
          : "light"
      : bg;
  const { width, height } = page.data;
  const props = iconProps(s, {
    size: PREVIEW_PX,
    palette: page.set.palette,
    strokes: page.strokes,
  });
  const choices: [Exclude<PreviewBg, "auto">, string][] = [
    ["dark", t.ipDark],
    ["light", t.ipLight],
    ["transparent", t.ipTransparent],
  ];
  return (
    <>
      <div
        className={cn(
          "ip-tile",
          bg !== "auto" && BG_CLASS[bg],
          page.hidden && "ip-tile-removed",
        )}
      >
        <div className="ip-tile-canvas">
          {grid ? (
            <svg
              className="ip-grid"
              viewBox={`0 0 ${width} ${height}`}
              aria-hidden="true"
            >
              <path d={gridPath(width, height)} />
            </svg>
          ) : null}
          <Icon icon={page.icon} className="ip-tile-icon" {...props} />
        </div>
      </div>
      <div className="ip-controls">
        <fieldset className="ip-bg">
          <legend className="sr-only">{t.ipBackground}</legend>
          {choices.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="pill-option"
              aria-pressed={shown === value}
              onClick={() => previewBgStore.set(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <label className="ip-switch">
          <span>{t.ipGrid}</span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={grid}
            className="ip-switch-input"
            checked={grid}
            onChange={(e) =>
              previewGridStore.set(e.target.checked ? "on" : "off")
            }
          />
          <span className="ip-switch-track" aria-hidden="true" />
        </label>
      </div>
    </>
  );
}

/** Ряд «Sizes»: та же иконка в 20, 24, 32 и 48 px, с цветом и толщиной линии из настроек. */
export function PreviewSizes({
  lang,
  page,
  s,
}: {
  lang: Lang;
  page: IconPageData;
  s: IconSettings;
}) {
  const t = DICTIONARIES[lang];
  return (
    <section className="ip-block ip-sizes" aria-labelledby="ip-sizes-label">
      <h2 id="ip-sizes-label" className="ip-label">
        {t.ipSizes}
      </h2>
      <ul className="ip-size-row">
        {PREVIEW_SIZES.map((px) => (
          <li key={px} className="ip-size">
            <span className="ip-size-box">
              <Icon
                icon={page.icon}
                {...iconProps(s, {
                  size: px,
                  palette: page.set.palette,
                  strokes: page.strokes,
                })}
              />
            </span>
            <span className="ip-size-label">{px}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
