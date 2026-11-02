"use client";

import { useId } from "react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import {
  COLOR_START,
  changed,
  DEFAULT_SETTINGS,
  parseColor,
  type Quarter,
  type IconSettings as Settings,
  SIZE_MAX,
  SIZE_MIN,
  SIZE_STEP,
  STROKE_DEFAULT,
  STROKE_MAX,
  STROKE_MIN,
  STROKE_STEP,
  settingsStore,
  useIconSettings,
} from "../../lib/icon-settings";
import { Button, buttonClass } from "../ui/button";

const QUARTERS: Quarter[] = [0, 1, 2, 3];

/**
 * Настройки превью (шаг 4 фазы 4, ADR-0041): размер, цвет — только у монохромных, толщина линии — только
 * где она меняет рисунок (strokes), поворот и отражение. Родные поля браузера — без компонентов Radix:
 * Slider ставит атрибут style, а CSP сайта его не пускает (ADR-0038). Настройки — общие у панели и
 * страницы иконки и не сбрасываются при переходе к другой иконке (решение владельца).
 */
export function IconSettings({
  lang,
  palette,
  strokes,
}: {
  lang: Lang;
  /** Цветной набор: свой цвет не применяется. */
  palette: boolean;
  /** Толщина линии меняет рисунок. */
  strokes: boolean;
}) {
  const t = DICTIONARIES[lang];
  const s = useIconSettings();
  const id = useId();
  const set = (patch: Partial<Settings>) =>
    settingsStore.set({ ...settingsStore.get(), ...patch });
  const pressed = (on: boolean) =>
    buttonClass(on ? "primary" : "outline", "md", "icon-setting-toggle");

  return (
    <fieldset className="icon-settings">
      <legend className="icon-section-title">{t.iconSettings}</legend>
      <div className="icon-setting">
        <label htmlFor={`${id}-size`}>{t.iconSize}</label>
        <input
          id={`${id}-size`}
          type="range"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={SIZE_STEP}
          value={s.size}
          onChange={(e) => set({ size: Number(e.target.value) })}
        />
        <output htmlFor={`${id}-size`}>{s.size} px</output>
      </div>
      {palette ? (
        <p className="icon-setting-note">{t.iconColorFixed}</p>
      ) : (
        <div className="icon-setting">
          <label htmlFor={`${id}-custom`}>
            <input
              id={`${id}-custom`}
              type="checkbox"
              checked={s.color !== undefined}
              onChange={(e) => {
                const { color: _, ...rest } = settingsStore.get();
                settingsStore.set(
                  e.target.checked ? { ...rest, color: COLOR_START } : rest,
                );
              }}
            />{" "}
            {t.iconColorCustom}
          </label>
          <input
            type="color"
            aria-label={t.iconColor}
            value={s.color ?? COLOR_START}
            onChange={(e) => {
              const color = parseColor(e.target.value);
              if (color !== undefined) set({ color });
            }}
          />
        </div>
      )}
      {strokes ? (
        <div className="icon-setting">
          <label htmlFor={`${id}-stroke`}>{t.iconStroke}</label>
          <input
            id={`${id}-stroke`}
            type="range"
            min={STROKE_MIN}
            max={STROKE_MAX}
            step={STROKE_STEP}
            value={s.stroke ?? STROKE_DEFAULT}
            onChange={(e) => set({ stroke: Number(e.target.value) })}
          />
          <output htmlFor={`${id}-stroke`}>{s.stroke ?? STROKE_DEFAULT}</output>
        </div>
      ) : null}
      <fieldset className="icon-setting">
        <legend className="icon-setting-label">{t.iconRotate}</legend>
        <span className="icon-setting-buttons">
          {QUARTERS.map((q) => (
            <button
              key={q}
              type="button"
              className={pressed(s.rotate === q)}
              aria-pressed={s.rotate === q}
              onClick={() => set({ rotate: q })}
            >
              {q * 90}°
            </button>
          ))}
        </span>
      </fieldset>
      <fieldset className="icon-setting">
        <legend className="icon-setting-label">{t.iconFlip}</legend>
        <span className="icon-setting-buttons">
          <button
            type="button"
            className={pressed(s.hflip)}
            aria-pressed={s.hflip}
            onClick={() => set({ hflip: !s.hflip })}
          >
            {t.iconFlipH}
          </button>
          <button
            type="button"
            className={pressed(s.vflip)}
            aria-pressed={s.vflip}
            onClick={() => set({ vflip: !s.vflip })}
          >
            {t.iconFlipV}
          </button>
        </span>
      </fieldset>
      <Button
        variant="ghost"
        disabled={!changed(s)}
        onClick={() => settingsStore.set(DEFAULT_SETTINGS)}
      >
        {t.iconReset}
      </Button>
    </fieldset>
  );
}
