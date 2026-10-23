// SVG с параметрами (ADR-0004, ADR-0024): размеры, поворот и отражение — сборка ядра, та же, что
// нарисует пакет в фазе 3 (ADR-0031); цвет — вместо currentColor; box — прозрачный прямоугольник по
// итоговому холсту для редакторов, которые не читают viewBox; download — отдать файлом. Без
// параметров ответ побайтно равен файлу статики.

import {
  formatNumber,
  type IconifySet,
  iconData,
  iconToSvg,
  parseFlip,
  parseRotate,
  parseSize,
  type Rotation,
  svgToString,
} from "@iconavo-ui/core";
import { ApiError } from "./http.js";
import { parseBool, parseColor, single } from "./params.js";

export interface SvgOptions {
  color?: string;
  width?: string;
  height?: string;
  rotate: Rotation;
  hFlip: boolean;
  vFlip: boolean;
  box: boolean;
  download: boolean;
}

function size(query: URLSearchParams, name: "width" | "height") {
  const value = single(query, name);
  if (value === undefined) return undefined;
  const parsed = parseSize(value);
  if (parsed === null) {
    throw new ApiError(
      400,
      "invalid_size",
      `${name} must be a number with an optional CSS unit, auto, unset or none`,
    );
  }
  return parsed;
}

export function parseSvgOptions(query: URLSearchParams): SvgOptions {
  const color = single(query, "color");
  const width = size(query, "width");
  const height = size(query, "height");
  const rotateValue = single(query, "rotate");
  const rotate = rotateValue === undefined ? 0 : parseRotate(rotateValue);
  if (rotate === null) {
    throw new ApiError(
      400,
      "invalid_rotate",
      "rotate must be 90deg, 180deg, 270deg or 1, 2, 3 (quarter turns)",
    );
  }
  const flipValue = single(query, "flip");
  const flip =
    flipValue === undefined
      ? { hFlip: false, vFlip: false }
      : parseFlip(flipValue);
  if (flip === null) {
    throw new ApiError(
      400,
      "invalid_flip",
      "flip must be horizontal, vertical or both, comma-separated",
    );
  }
  return {
    ...(color === undefined ? {} : { color: parseColor(color) }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    rotate,
    ...flip,
    box: parseBool("box", single(query, "box")),
    download: parseBool("download", single(query, "download")),
  };
}

/** Параметры для ключа кэша — проверенные значения в постоянном порядке. */
export function svgOptionsKey(o: SvgOptions): URLSearchParams {
  const key = new URLSearchParams();
  if (o.color !== undefined) key.set("color", o.color);
  if (o.width !== undefined) key.set("width", o.width);
  if (o.height !== undefined) key.set("height", o.height);
  if (o.rotate !== 0) key.set("rotate", String(o.rotate));
  if (o.hFlip || o.vFlip) {
    key.set(
      "flip",
      [o.hFlip ? "horizontal" : "", o.vFlip ? "vertical" : ""]
        .filter(Boolean)
        .join(","),
    );
  }
  if (o.box) key.set("box", "1");
  if (o.download) key.set("download", "1");
  return key;
}

/** SVG имени; имени нет в файле — null. */
export function svgBody(
  file: IconifySet,
  name: string,
  o: SvgOptions,
): string | null {
  const icon = iconData(file, name);
  if (icon === null) return null;
  const parts = iconToSvg(icon, {
    ...(o.width === undefined ? {} : { width: o.width }),
    ...(o.height === undefined ? {} : { height: o.height }),
    rotate: o.rotate,
    hFlip: o.hFlip,
    vFlip: o.vFlip,
  });
  if (o.box) {
    const [x, y, w, h] = [
      parts.box.left,
      parts.box.top,
      parts.box.width,
      parts.box.height,
    ].map(formatNumber);
    parts.body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255, 255, 255, 0)" />${parts.body}`;
  }
  const svg = svgToString(parts);
  return o.color === undefined ? svg : svg.split("currentColor").join(o.color);
}
