// CSS-иконки (ADR-0024), как getIconsCSS у Iconify с селекторами по умолчанию: .icon--{набор} —
// общие правила, .icon--{набор}--{имя} — рисунок. Монохромные иконки — маской: цвет берётся из
// текста; цветные — фоном. Свои селекторы, pseudo и var Iconify позволяет, здесь их нет: это главная
// поверхность для подмены CSS (бэклог). Ненайденное имя — комментарием, и только если оно прошло
// правило имён: «*/» в имени закрыл бы комментарий.

import {
  calculateSize,
  formatNumber,
  type IconifySet,
  iconData,
  SVG_NS,
} from "@iconavo-ui/core";
import { ApiError } from "./http.js";
import { parseBool, parseColor, searchable, single } from "./params.js";

export type CssMode = "mask" | "background";
export type CssFormat = "expanded" | "compact" | "compressed";

export interface CssOptions {
  color?: string;
  mode?: CssMode;
  square: boolean;
  format: CssFormat;
  download: boolean;
}

type Declaration = readonly [property: string, value: string];

interface Rule {
  selector: string;
  declarations: Declaration[];
}

const COMMON: readonly Declaration[] = [
  ["display", "inline-block"],
  ["width", "1em"],
  ["height", "1em"],
];

const MASK: readonly Declaration[] = [
  ["background-color", "currentColor"],
  ["-webkit-mask-image", "var(--svg)"],
  ["mask-image", "var(--svg)"],
  ["-webkit-mask-repeat", "no-repeat"],
  ["mask-repeat", "no-repeat"],
  ["-webkit-mask-size", "100% 100%"],
  ["mask-size", "100% 100%"],
];

const BACKGROUND: readonly Declaration[] = [
  ["background-repeat", "no-repeat"],
  ["background-size", "100% 100%"],
];

export function parseCssOptions(query: URLSearchParams): CssOptions {
  const color = single(query, "color");
  const mode = single(query, "mode");
  if (
    mode !== undefined &&
    mode !== "mask" &&
    mode !== "background" &&
    mode !== "bg"
  ) {
    throw new ApiError(400, "invalid_mode", "mode must be mask or background");
  }
  const format = single(query, "format") ?? "expanded";
  if (
    format !== "expanded" &&
    format !== "compact" &&
    format !== "compressed"
  ) {
    throw new ApiError(
      400,
      "invalid_format",
      "format must be expanded, compact or compressed",
    );
  }
  return {
    ...(color === undefined ? {} : { color: parseColor(color) }),
    ...(mode === undefined
      ? {}
      : { mode: mode === "mask" ? "mask" : "background" }),
    square: parseBool("square", single(query, "square")),
    format,
    download: parseBool("download", single(query, "download")),
  };
}

/** Параметры для ключа кэша — проверенные значения в постоянном порядке. */
export function cssOptionsKey(o: CssOptions): URLSearchParams {
  const key = new URLSearchParams();
  if (o.color !== undefined) key.set("color", o.color);
  if (o.mode !== undefined) key.set("mode", o.mode);
  if (o.square) key.set("square", "1");
  if (o.format !== "expanded") key.set("format", o.format);
  if (o.download) key.set("download", "1");
  return key;
}

/** SVG для адреса data: в CSS — как svgToURL у Iconify. */
export function svgToUrl(svg: string): string {
  const encoded = svg
    .replace(/"/g, "'")
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\s+/g, " ");
  return `url("data:image/svg+xml,${encoded}")`;
}

function format(rules: readonly Rule[], f: CssFormat): string {
  if (f === "compressed") {
    return rules
      .map(
        (r) =>
          `${r.selector}{${r.declarations.map(([p, v]) => `${p}:${v}`).join(";")}}`,
      )
      .join("");
  }
  if (f === "compact") {
    return rules
      .map(
        (r) =>
          `${r.selector} {${r.declarations.map(([p, v]) => ` ${p}: ${v}`).join(";")}; }\n`,
      )
      .join("\n");
  }
  return rules
    .map(
      (r) =>
        `${r.selector} {${r.declarations.map(([p, v]) => `\n  ${p}: ${v}`).join(";")};\n}\n`,
    )
    .join("\n");
}

export function cssBody(
  set: string,
  names: readonly string[],
  files: ReadonlyMap<string, IconifySet | null>,
  o: CssOptions,
): string {
  const found: { name: string; file: IconifySet }[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const file = files.get(name);
    if (file) found.push({ name, file });
    else if (searchable(name)) missing.push(name);
  }
  const first = found[0] ? iconData(found[0].file, found[0].name) : null;
  const mode: CssMode =
    o.mode ??
    (o.color !== undefined
      ? "background"
      : first === null || first.body.includes("currentColor")
        ? "mask"
        : "background");
  const common = `.icon--${set}`;
  const rules: Rule[] = [
    {
      selector: common,
      declarations: [...COMMON, ...(mode === "mask" ? MASK : BACKGROUND)],
    },
  ];
  for (const { name, file } of found) {
    const icon = iconData(file, name);
    if (icon === null) continue;
    let { left, top, width, height } = icon;
    if (o.square && width !== height) {
      const max = Math.max(width, height);
      left -= (max - width) / 2;
      top -= (max - height) / 2;
      width = max;
      height = max;
    }
    const declarations: Declaration[] = [];
    if (width !== height) {
      declarations.push(["width", calculateSize("1em", width / height)]);
    }
    const viewBox = [left, top, width, height].map(formatNumber).join(" ");
    const body = icon.body.replace(/currentColor/g, o.color ?? "black");
    const url = svgToUrl(
      `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" width="${formatNumber(width)}" height="${formatNumber(height)}">${body}</svg>`,
    );
    declarations.push(
      mode === "mask" ? ["--svg", url] : ["background-image", url],
    );
    // Своя ширина спорит с общей 1em — правило с двумя классами сильнее, как у Iconify.
    const selector =
      declarations[0]?.[0] === "width"
        ? `${common}${common}--${name}`
        : `${common}--${name}`;
    rules.push({ selector, declarations });
  }
  const errors = missing.map((name) => `/* Could not find icon: ${name} */`);
  return `${format(rules, o.format)}${errors.length > 0 ? `\n${errors.join("\n")}\n` : ""}`;
}
