// Генератор кода и файлы иконки (шаг 5 фазы 4, ADR-0042, ADR-0041): тег, React, SVG, CSS и ссылка на SVG
// edge API с настройками превью — «настройки сразу применяются к коду и экспорту». В код попадают
// только изменённые настройки: размер превью по умолчанию не пишется, и тогда у тега, React и SVG
// 1em, как у Iconify. Свой цвет — только у монохромных, толщина — где она меняет рисунок (как
// iconProps). SVG собирают те же функции ядра в том же порядке, что svgBody edge API, поэтому код SVG
// побайтно равен ответу адреса из «Ссылки» — это сверяет code.test.ts. Чистые функции, без браузера.

import {
  formatNumber,
  type IconData,
  iconToSvg,
  setStrokeWidth,
  svgToString,
} from "@iconavo-ui/core/internal";
import { attributionText, type IconDetails } from "./icon";
import { DEFAULT_SETTINGS, type IconSettings } from "./icon-settings";
import type { Install } from "./install";

export const CODE_KINDS = ["tag", "react", "svg", "css", "link"] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

/** Сайт в комментарии файла: ссылка на тексты лицензий. */
export const SITE_URL = "https://iconavo.dev";

/** Что применимо к иконке: свой цвет — не у цветных наборов, толщина — где она меняет рисунок. */
export interface Applies {
  palette: boolean;
  strokes: boolean;
}

/** Настройки для кода строками — только изменённые. */
interface Values {
  width?: string;
  color?: string;
  stroke?: number;
  rotate?: string;
  flip?: string;
}

function values(s: IconSettings, o: Applies): Values {
  const flip = [s.hflip ? "horizontal" : "", s.vflip ? "vertical" : ""]
    .filter((f) => f !== "")
    .join(",");
  return {
    ...(s.size === DEFAULT_SETTINGS.size ? {} : { width: String(s.size) }),
    ...(s.color === undefined || o.palette ? {} : { color: s.color }),
    ...(s.stroke === undefined || !o.strokes ? {} : { stroke: s.stroke }),
    ...(s.rotate === 0 ? {} : { rotate: `${s.rotate * 90}deg` }),
    ...(flip === "" ? {} : { flip }),
  };
}

/** lucide:house → [lucide, house]. */
export function splitName(name: string): [string, string] {
  const i = name.indexOf(":");
  return [name.slice(0, i), name.slice(i + 1)];
}

/** Атрибуты или пропсы: только заданные, в постоянном порядке. */
const list = (items: (string | false | undefined)[]): string =>
  items.filter((item): item is string => typeof item === "string").join(" ");

/** Тег пакета (ADR-0031, README тега). */
export function tagCode(name: string, s: IconSettings, o: Applies): string {
  const v = values(s, o);
  return `<iconavo-icon ${list([
    `icon="${name}"`,
    v.width !== undefined && `width="${v.width}"`,
    v.color !== undefined && `color="${v.color}"`,
    v.stroke !== undefined && `stroke-width="${formatNumber(v.stroke)}"`,
    v.rotate !== undefined && `rotate="${v.rotate}"`,
    v.flip !== undefined && `flip="${v.flip}"`,
  ])}></iconavo-icon>`;
}

/** Компонент React: строка импорта из README и сам компонент. */
export function reactCode(
  name: string,
  s: IconSettings,
  o: Applies,
  install: Install,
): string {
  const v = values(s, o);
  return `${install.react.import}\n\n<Icon ${list([
    `icon="${name}"`,
    v.width !== undefined && `width={${v.width}}`,
    v.color !== undefined && `color="${v.color}"`,
    v.stroke !== undefined && `strokeWidth={${formatNumber(v.stroke)}}`,
    v.rotate !== undefined && `rotate="${v.rotate}"`,
    v.flip !== undefined && `flip="${v.flip}"`,
  ])} />`;
}

/** Строка параметров edge API: значения — буквы, цифры, точка и запятая, кодировать нечего. */
function query(entries: [string, string | undefined][]): string {
  const text = entries
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return text === "" ? "" : `?${text}`;
}

/** Адрес SVG edge API с настройками (ADR-0024): цвет — без #, поворот — градусами. */
export function svgLink(
  api: string,
  name: string,
  s: IconSettings,
  o: Applies,
): string {
  const v = values(s, o);
  const [set, icon] = splitName(name);
  return `${api}/${set}/${icon}.svg${query([
    ["width", v.width],
    ["color", v.color?.slice(1)],
    [
      "stroke-width",
      v.stroke === undefined ? undefined : formatNumber(v.stroke),
    ],
    ["rotate", v.rotate],
    ["flip", v.flip],
  ])}`;
}

/**
 * CSS edge API (ADR-0024): ссылка на файл и элемент с классами. У CSS API нет размера, поворота и
 * отражения — их задаёт стиль элемента: размер — font-size, поворот и отражение — transform, сначала
 * отражение, потом поворот, как у SVG.
 */
export function cssCode(
  api: string,
  name: string,
  s: IconSettings,
  o: Applies,
): string {
  const v = values(s, o);
  const [set, icon] = splitName(name);
  const flip =
    s.hflip && s.vflip
      ? "scale(-1)"
      : s.hflip
        ? "scaleX(-1)"
        : s.vflip
          ? "scaleY(-1)"
          : undefined;
  const transform = list([
    v.rotate !== undefined && `rotate(${v.rotate})`,
    flip,
  ]);
  const style = [
    v.width === undefined ? "" : `font-size: ${v.width}px`,
    transform === "" ? "" : `transform: ${transform}`,
  ]
    .filter((d) => d !== "")
    .join("; ");
  const href = `${api}/${set}.css${query([
    ["icons", icon],
    ["color", v.color?.slice(1)],
    [
      "stroke-width",
      v.stroke === undefined ? undefined : formatNumber(v.stroke),
    ],
  ])}`;
  return `<link rel="stylesheet" href="${href}">\n<span class="icon--${set} icon--${set}--${icon}"${style === "" ? "" : ` style="${style}"`}></span>`;
}

/** SVG с настройками: ширина — заданная, высота по пропорции; без ширины — 1em. */
function svg(
  icon: IconData,
  s: IconSettings,
  o: Applies,
  width: string | undefined,
): string {
  const v = values(s, o);
  const parts = iconToSvg(icon, {
    ...(width === undefined ? {} : { width }),
    rotate: s.rotate,
    hFlip: s.hflip,
    vFlip: s.vflip,
  });
  // До замены цвета: setStrokeWidth меняет только рисунок с currentColor (ADR-0041), как svgBody.
  if (v.stroke !== undefined) {
    parts.body = setStrokeWidth(parts.body, v.stroke);
  }
  const text = svgToString(parts);
  return v.color === undefined
    ? text
    : text.split("currentColor").join(v.color);
}

/** Код SVG — тот же текст, что у адреса svgLink. */
export const svgCode = (icon: IconData, s: IconSettings, o: Applies): string =>
  svg(icon, s, o, values(s, o).width);

/** Текст комментария XML: «--» внутри комментария XML запрещён. */
export function commentText(text: string): string {
  let safe = text;
  while (safe.includes("--")) safe = safe.replaceAll("--", "- -");
  return safe.endsWith("-") ? `${safe} ` : safe;
}

/**
 * Комментарий файла (решение владельца 3 ноября 2026): имя, набор, автор и лицензия — тем же
 * английским текстом указания авторства, что в панели, — и ссылка на полный текст лицензии.
 */
export function fileComment(
  name: string,
  d: Pick<IconDetails, "set" | "credits">,
): string {
  const credits = (d.credits ?? []).map(
    (c) => `Based on ${c.name} by ${c.author}, ${c.license} license.`,
  );
  return `<!-- ${commentText(
    [
      `${name}.`,
      attributionText(d),
      ...credits,
      `License text: ${SITE_URL}/licenses#${d.set.prefix}`,
    ].join(" "),
  )} -->`;
}

/** Файл SVG: размер — заданный, иначе родной у сетки набора; первой строкой — комментарий. */
export function svgFile(
  icon: IconData,
  s: IconSettings,
  o: Applies,
  comment: string,
): string {
  return `${comment}\n${svg(icon, s, o, values(s, o).width ?? "auto")}\n`;
}

/** Размеры PNG (ADR-0042): от 16 до 512 px. */
export const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512] as const;
export const PNG_DEFAULT = 256;

/**
 * SVG для PNG: шириной в пикселях, свой цвет — как выбран, иначе чёрный: у картинки нет цвета
 * текста вокруг. Размер холста — из атрибутов.
 */
export function pngSvg(
  icon: IconData,
  s: IconSettings,
  o: Applies,
  px: number,
): { svg: string; width: number; height: number } {
  const text = svg(icon, s, o, String(px)).split("currentColor").join("#000");
  const size = (attribute: string) =>
    Math.ceil(Number(new RegExp(` ${attribute}="([\\d.]+)"`).exec(text)?.[1]));
  return { svg: text, width: size("width"), height: size("height") };
}

/** Имена файлов: lucide-house.svg и lucide-house-256.png. */
export const fileName = (name: string, ext: "svg" | "png", px?: number) =>
  `${name.replace(":", "-")}${px === undefined ? "" : `-${px}`}.${ext}`;
