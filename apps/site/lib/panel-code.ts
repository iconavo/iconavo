// Код панели иконки по макету «Icon Panel» (Figma «Iconavo — Макеты»): виды блока кода, настройки SVG,
// data URL и CSS-класс. Чистые функции, без браузера: SVG строится функциями lib/code.ts (те же, что у
// edge API), здесь — только его вид. Поворот и отражение в панели не участвуют (решение владельца
// 12 ноября 2026: в панели — размер, цвет и толщина линии).

import type { IconData } from "@iconavo-ui/core/internal";
import { type Applies, fileSvg, splitName, svgLink, tagCode } from "./code";
import type { IconSettings } from "./icon-settings";
import { formatName } from "./names";

/**
 * Виды блока кода: формат и подвкладка. Что из макета в продукте есть — здесь; остальное (SVG+CSS, JSX,
 * Symbol, Tailwind, UnoCSS, Vue, Svelte, Solid, Astro, Component, Unplugin) — «Soon» в разметке.
 */
export const PANEL_VIEWS = [
  "svg",
  "css",
  "css-url",
  "html",
  "html-script",
  "react",
] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];

/** Вид по умолчанию — как в макете: React · Package. */
export const DEFAULT_VIEW: PanelView = "react";

export type PanelFormat = "svg" | "css" | "html" | "react";

/** Формат вида: пилюля, которая выбрана. */
export const formatOf = (view: PanelView): PanelFormat =>
  view === "css-url" ? "css" : view === "html-script" ? "html" : view;

/** Настройки вывода SVG (макет: Prettify code, Add empty rectangle, Add comment with icon name). */
export interface SvgOptions {
  pretty: boolean;
  rect: boolean;
  comment: boolean;
}

/** Все сочетания настроек — строкой для хранилища выбора; по умолчанию как в макете. */
export const SVG_OPTION_VALUES = [
  "",
  "pretty",
  "rect",
  "comment",
  "pretty,rect",
  "pretty,comment",
  "rect,comment",
  "pretty,rect,comment",
] as const;
export type SvgOptionsValue = (typeof SVG_OPTION_VALUES)[number];
export const DEFAULT_SVG_OPTIONS: SvgOptionsValue = "pretty,rect";

export function readSvgOptions(value: SvgOptionsValue): SvgOptions {
  const on = new Set(value.split(","));
  return {
    pretty: on.has("pretty"),
    rect: on.has("rect"),
    comment: on.has("comment"),
  };
}

export function svgOptionsValue(o: SvgOptions): SvgOptionsValue {
  return [o.pretty && "pretty", o.rect && "rect", o.comment && "comment"]
    .filter(Boolean)
    .join(",") as SvgOptionsValue;
}

/** Поворот и отражение панель не применяет: код — как превью панели. */
export const panelSettings = (s: IconSettings): IconSettings => ({
  ...s,
  rotate: 0,
  hflip: false,
  vflip: false,
});

/**
 * SVG с отступами: каждый элемент — своей строкой, вложенные — на два пробела глубже. Разбор по тегам —
 * SVG иконок у нас без текста между элементами (санитайзер конвейера, ADR-0013).
 */
export function prettySvg(svg: string): string {
  const tags = svg.match(/<[^>]+>/g) ?? [];
  const lines: string[] = [];
  let depth = 0;
  for (const tag of tags) {
    if (tag.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      lines.push(`${"  ".repeat(depth)}${tag}`);
    } else if (
      tag.endsWith("/>") ||
      tag.startsWith("<!") ||
      tag.startsWith("<?")
    ) {
      lines.push(`${"  ".repeat(depth)}${tag.replace(/\s*\/>$/, " />")}`);
    } else {
      lines.push(`${"  ".repeat(depth)}${tag}`);
      depth += 1;
    }
  }
  return lines.join("\n");
}

/** Пустой прямоугольник во весь холст — первым внутри <svg>: Figma сохранит размер рамки. */
export function withEmptyRect(svg: string): string {
  const box = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  if (box === null) return svg;
  const [, x, y, w, h] = box;
  const rect = `<path d="M${x} ${y}h${w}v${h}H${x}z" fill="none"/>`;
  return svg.replace(/^(<svg[^>]*>)/, `$1${rect}`);
}

/** SVG вида «SVG» с настройками вывода. */
export function svgView(
  name: string,
  icon: IconData,
  s: IconSettings,
  o: Applies,
  options: SvgOptions,
): string {
  let svg = fileSvg(icon, panelSettings(s), o);
  if (options.rect) svg = withEmptyRect(svg);
  if (options.pretty) svg = prettySvg(svg);
  return options.comment ? `<!-- ${name} -->\n${svg}` : svg;
}

/**
 * SVG в data URL, как у Iconify: кавычки — одинарные, кодируются только символы, которые ломают адрес в
 * CSS и HTML; пробелы подряд — один.
 */
export function svgDataUrl(svg: string): string {
  const text = svg
    .replace(/"/g, "'")
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\s+/g, " ");
  return `data:image/svg+xml,${text}`;
}

/** SVG для data URL и CSS: в одну строку, без настроек вывода. */
export const plainSvg = (icon: IconData, s: IconSettings, o: Applies): string =>
  fileSvg(icon, panelSettings(s), o);

/** Класс CSS иконки — как у Iconify: набор--иконка. */
export const cssClassName = (name: string) => formatName(name, "cssClass");

/** Размер в пикселях по пропорции рисунка: высота — выбранный размер. */
function box(icon: IconData, size: number): { width: number; height: number } {
  const ratio = icon.width / icon.height;
  return {
    width: Math.round(size * ratio * 100) / 100,
    height: size,
  };
}

/**
 * CSS-класс вида «CSS» (макет View=CSS): монохромная иконка — маска с цветом текста вокруг (свой цвет —
 * background-color), цветная — картинкой фона.
 */
export function cssClassCode(
  name: string,
  icon: IconData,
  s: IconSettings,
  o: Applies,
): string {
  const { width, height } = box(icon, s.size);
  const head = [
    `.${cssClassName(name)} {`,
    "  display: inline-block;",
    `  width: ${width}px;`,
    `  height: ${height}px;`,
  ];
  if (o.palette) {
    const url = svgDataUrl(plainSvg(icon, s, o));
    return [
      ...head,
      `  background: no-repeat center / 100% 100% url("${url}");`,
      "}",
    ].join("\n");
  }
  // Для маски цвет рисунка не важен — чёрный, как у Iconify; цвет иконке даёт background-color.
  const url = svgDataUrl(
    plainSvg(icon, { ...s, color: undefined }, o)
      .split("currentColor")
      .join("black"),
  );
  return [
    ...head,
    `  --svg: url("${url}");`,
    `  background-color: ${s.color === undefined ? "currentColor" : s.color};`,
    "  -webkit-mask-image: var(--svg);",
    "  mask-image: var(--svg);",
    "  -webkit-mask-repeat: no-repeat;",
    "  mask-repeat: no-repeat;",
    "  -webkit-mask-size: 100% 100%;",
    "  mask-size: 100% 100%;",
    "}",
  ].join("\n");
}

/** Элемент с классом CSS. */
export const cssSpanCode = (name: string) =>
  `<span class="${cssClassName(name)}"></span>`;

/** Адрес SVG edge API для вида «URL» — с размером, цветом и толщиной. */
export const urlView = (
  api: string,
  name: string,
  s: IconSettings,
  o: Applies,
) => svgLink(api, name, panelSettings(s), o);

/** Картинка по адресу: размер по пропорции, alt — имя иконки. */
export function imgCode(
  url: string,
  name: string,
  icon: IconData,
  size: number,
) {
  const { width, height } = box(icon, size);
  return `<img src="${url}" width="${width}" height="${height}" alt="${splitName(name)[1]}" />`;
}

/** Фон по адресу. */
export const backgroundCode = (url: string) =>
  `background-image: url("${url}");`;

/** Тег пакета без поворота и отражения. */
export const tagView = (name: string, s: IconSettings, o: Applies) =>
  tagCode(name, panelSettings(s), o);
