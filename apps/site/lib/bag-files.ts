// Файлы сумки (шаг 5 фазы 4, ADR-0042; решения владельца 3 ноября 2026): ZIP и SVG-спрайт. Вид — исходный
// плюс общий цвет и толщина линии: толщина меняет только линии с currentColor (setStrokeWidth ядра),
// цвет встаёт вместо currentColor, цветные иконки не меняются. В ZIP — файлы SVG по наборам, полные
// тексты лицензий и README.txt с указанием авторства; спрайт начинается с комментария об авторах и
// лицензиях. Чистые функции: данные и тексты лицензий приносит bag-export.ts.

import {
  type IconData,
  iconToSvg,
  replaceIds,
  SVG_NS,
  setStrokeWidth,
  svgToString,
} from "@iconavo-ui/core/internal";
import { commentText, SITE_URL, splitName } from "./code";
import type { ZipFile } from "./zip";

/** Вид иконок из сумки. */
export interface BagLook {
  color?: string;
  stroke?: number;
}

/** Иконка сумки с рисунком. */
export interface BagIcon {
  name: string;
  icon: IconData;
}

/** Набор в сумке: название, текст указания авторства и полный текст лицензии. */
export interface BagSet {
  prefix: string;
  name: string;
  /** Тот же английский текст, что в панели (attributionText). */
  attribution: string;
  license: string;
  notice?: string;
}

export const ZIP_NAME = "iconavo-icons.zip";
export const SPRITE_NAME = "iconavo-sprite.svg";

/** ID символа спрайта: lucide:house → lucide-house. */
export const symbolId = (name: string): string => name.replace(":", "-");

/** Рисунок по виду сумки. */
export function lookBody(body: string, look: BagLook): string {
  const thin =
    look.stroke === undefined ? body : setStrokeWidth(body, look.stroke);
  return look.color === undefined
    ? thin
    : thin.split("currentColor").join(look.color);
}

/** Файл SVG сумки: родной размер сетки набора, вид сумки. */
export function bagFile(icon: IconData, look: BagLook): string {
  const parts = iconToSvg(icon, { width: "auto" });
  parts.body = lookBody(parts.body, look);
  return `${svgToString(parts)}\n`;
}

/** Строки об авторах и лицензиях наборов сумки. */
const credits = (sets: readonly BagSet[]): string[] =>
  sets.map((s) => s.attribution);

/** SVG-спрайт: символ на иконку, ID внутри рисунков — свои у каждого символа. */
export function spriteSvg(
  icons: readonly BagIcon[],
  sets: readonly BagSet[],
  look: BagLook,
): string {
  const symbols = icons.map(({ name, icon }) => {
    const parts = iconToSvg(icon);
    const id = symbolId(name);
    const body = replaceIds(lookBody(parts.body, look), () => `${id}-`);
    return `<symbol id="${id}" viewBox="${parts.attributes.viewBox}">${body}</symbol>`;
  });
  const xlink = symbols.some((s) => s.includes("xlink:"))
    ? ' xmlns:xlink="http://www.w3.org/1999/xlink"'
    : "";
  const example =
    icons[0] === undefined ? "lucide-house" : symbolId(icons[0].name);
  const comment = commentText(
    [
      `Icons from Iconavo (${SITE_URL}).`,
      ...credits(sets),
      `License texts: ${SITE_URL}/licenses`,
      `Usage: <svg width="24" height="24"><use href="${SPRITE_NAME}#${example}"/></svg>`,
    ].join("\n"),
  );
  return `<!--\n${comment}\n-->\n<svg xmlns="${SVG_NS}"${xlink}>\n${symbols.join("\n")}\n</svg>\n`;
}

/** README.txt архива: по набору — указание авторства, текст лицензии и файлы. */
export function bagReadme(
  icons: readonly BagIcon[],
  sets: readonly BagSet[],
  when: Date,
): string {
  const day = when.toISOString().slice(0, 10);
  const blocks = sets.map((s) => {
    const files = icons
      .filter((i) => splitName(i.name)[0] === s.prefix)
      .map((i) => `  ${i.name.replace(":", "/")}.svg`);
    return [
      `${s.name}`,
      s.attribution,
      `License text: LICENSES/${s.prefix}.txt`,
      ...files,
    ].join("\n");
  });
  return `Icons from Iconavo (${SITE_URL}), downloaded on ${day}.\n\n${blocks.join("\n\n")}\n`;
}

/** Файлы ZIP: иконки по наборам, тексты лицензий (и NOTICE, если есть) и README.txt. */
export function bagArchive(
  icons: readonly BagIcon[],
  sets: readonly BagSet[],
  look: BagLook,
  when: Date,
): ZipFile[] {
  return [
    { path: "README.txt", data: bagReadme(icons, sets, when) },
    ...sets.map((s) => ({
      path: `LICENSES/${s.prefix}.txt`,
      data:
        s.notice === undefined
          ? `${s.license.trimEnd()}\n`
          : `${s.license.trimEnd()}\n\nNOTICE\n\n${s.notice.trimEnd()}\n`,
    })),
    ...icons.map(({ name, icon }) => ({
      path: `${name.replace(":", "/")}.svg`,
      data: bagFile(icon, look),
    })),
  ];
}
