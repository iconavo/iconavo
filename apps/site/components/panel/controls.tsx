"use client";

import { Icon } from "@iconavo-ui/react";
import { useId } from "react";
import { track } from "../../lib/analytics";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import {
  COLOR_START,
  type IconSettings,
  parseColor,
  STROKE_DEFAULT,
  STROKE_MAX,
  STROKE_MIN,
  STROKE_STEP,
  settingsStore,
} from "../../lib/icon-settings";
import { formatName, NAME_FORMATS, type NameFormat } from "../../lib/names";
import { nameStore, useChoice } from "../../lib/prefs";
import { Soon } from "../shell/Soon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { PanelCopy } from "./parts";

// Поля панели иконки по макету «Icon Panel»: Size, Color, Name и Stroke Width. Настройки — в хранилище
// вкладки (lib/icon-settings.ts): панель и страница иконки видят одно и то же.

/** Размеры в списке Size: от 16 до 256 px. */
export const PANEL_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

const update = (s: IconSettings, change: Partial<IconSettings>) =>
  settingsStore.set({ ...s, ...change });

/** Size: значок высоты, «24px», стрелка; список — DropdownMenu Radix, немодальный (ADR-0038). */
export function PanelSize({ lang, s }: { lang: Lang; s: IconSettings }) {
  const t = DICTIONARIES[lang];
  return (
    <div className="panel-field">
      <span className="panel-label" id="panel-size-label">
        {t.iconSize}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="panel-control"
            aria-labelledby="panel-size-label panel-size-value"
          >
            <Icon
              icon="material-symbols:height"
              className="panel-icon panel-icon-muted"
            />
            <span id="panel-size-value" className="panel-control-text">
              {s.size}px
            </span>
            <Icon
              icon="material-symbols:keyboard-arrow-down"
              className="panel-icon"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="panel-menu">
          <DropdownMenuRadioGroup
            value={String(s.size)}
            onValueChange={(value) => update(s, { size: Number(value) })}
          >
            {PANEL_SIZES.map((size) => (
              <DropdownMenuRadioItem key={size} value={String(size)}>
                {size}px
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Поле Color (Color Field макета): квадратик — выбор цвета браузера, рядом HEX. Пока свой цвет не выбран,
 * иконка берёт цвет текста вокруг — в поле «Auto». Прозрачности в коде нет — «100 %» с подсказкой «Soon».
 * Одно у панели иконки и рюкзака: значение и его смена — у того, кто зовёт.
 */
export function ColorField({
  lang,
  value,
  onChange,
}: {
  lang: Lang;
  /** Свой цвет #rrggbb; нет — «Auto». */
  value: string | undefined;
  onChange: (color: string | undefined) => void;
}) {
  const t = DICTIONARIES[lang];
  const labelId = `${useId()}-color`;
  return (
    <div className="panel-field">
      <span className="panel-label" id={labelId}>
        {t.iconColor}
      </span>
      <div className="panel-control panel-color">
        <input
          type="color"
          className="color-swatch"
          value={value ?? COLOR_START}
          aria-label={t.iconColorCustom}
          data-auto={value === undefined ? "" : undefined}
          onChange={(e) => onChange(parseColor(e.target.value))}
        />
        <input
          type="text"
          className="color-hex"
          value={value === undefined ? "" : value.slice(1).toUpperCase()}
          placeholder={t.pColorAuto}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-labelledby={labelId}
          onChange={(e) => {
            const text = e.target.value.trim();
            if (text === "") onChange(undefined);
            else {
              const color = parseColor(text);
              if (color !== undefined) onChange(color);
            }
          }}
        />
        {/* Имя для скринридера — с видимым «100%» (WCAG 2.5.3, axe label-content-name-mismatch). */}
        <Soon lang={lang} className="color-alpha" label={`${t.pOpacity} 100%`}>
          <span>100</span>
          <span className="color-alpha-unit">%</span>
        </Soon>
      </div>
    </div>
  );
}

/** Color панели и страницы иконки — настройки вкладки. */
export function PanelColor({ lang, s }: { lang: Lang; s: IconSettings }) {
  return (
    <ColorField
      lang={lang}
      value={s.color}
      onChange={(color) => update(s, { color })}
    />
  );
}

/**
 * Поле Stroke Width: ползунок и значение «2 px» — только у иконок, где толщина меняет рисунок. Своей
 * толщины нет — ползунок на толщине Lucide и Tabler (STROKE_DEFAULT), рисунок как у автора.
 */
export function StrokeField({
  lang,
  value,
  onChange,
}: {
  lang: Lang;
  value: number | undefined;
  onChange: (stroke: number) => void;
}) {
  const t = DICTIONARIES[lang];
  const id = `${useId()}-stroke`;
  const shown = value ?? STROKE_DEFAULT;
  return (
    <div className="panel-field">
      <label className="panel-label" htmlFor={id}>
        {t.pStroke}
      </label>
      <div className="panel-stroke">
        <input
          id={id}
          type="range"
          className="panel-range"
          min={STROKE_MIN}
          max={STROKE_MAX}
          step={STROKE_STEP}
          value={shown}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="panel-stroke-value" aria-hidden="true">
          <b>{shown}</b>
          <span>px</span>
        </span>
      </div>
    </div>
  );
}

/** Stroke Width панели и страницы иконки — настройки вкладки. */
export function PanelStroke({ lang, s }: { lang: Lang; s: IconSettings }) {
  return (
    <StrokeField
      lang={lang}
      value={s.stroke}
      onChange={(stroke) => update(s, { stroke })}
    />
  );
}

/** Name: формат имени — список, как у Iconify (lib/names.ts), выбор запоминается; рядом Copy. */
export function PanelName({ lang, name }: { lang: Lang; name: string }) {
  const t = DICTIONARIES[lang];
  const format = useChoice(nameStore);
  const shown = formatName(name, format);
  const labels: Record<NameFormat, string> = {
    path: t.namePath,
    iconify: t.nameIconify,
    component: t.nameComponent,
    tailwind: "Tailwind CSS",
    unocss: "UnoCSS",
    unocssDash: "UnoCSS",
    bare: t.nameBare,
    cssClass: t.nameCssClass,
  };
  return (
    <div className="panel-field">
      <span className="panel-label" id="panel-name-label">
        {t.pName}
      </span>
      <div className="panel-name-row">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="panel-control panel-name"
              aria-label={`${t.iconNameFormat}: ${shown}`}
            >
              <span className="panel-control-text">{shown}</span>
              <Icon
                icon="material-symbols:keyboard-arrow-down"
                className="panel-icon"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            collisionPadding={16}
            className="panel-menu"
          >
            <DropdownMenuRadioGroup
              value={format}
              onValueChange={(value) => nameStore.set(value as NameFormat)}
            >
              {NAME_FORMATS.map((f) => (
                <DropdownMenuRadioItem key={f} value={f}>
                  <code className="name-format-code">
                    {formatName(name, f)}
                  </code>
                  <span className="name-format-label">{labels[f]}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <PanelCopy
          lang={lang}
          text={shown}
          what={t.pName}
          className="panel-btn panel-btn-outline panel-btn-sm"
          onCopied={() =>
            track({ name: "copy", what: "name", icon: name, format })
          }
        />
      </div>
    </div>
  );
}
