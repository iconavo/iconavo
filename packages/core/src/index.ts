const PART = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Имя иконки по ADR-0001: `набор:иконка`, обе части — строчные латинские буквы, цифры и одиночные дефисы. */
export function isValidIconName(name: string): boolean {
  const parts = name.split(":");
  return parts.length === 2 && parts.every((part) => PART.test(part));
}

/** Одна часть имени по ADR-0001 — набор или иконка. */
export function isValidNamePart(part: string): boolean {
  return PART.test(part);
}

export {
  type Flip,
  parseFlip,
  parseRotate,
  parseSize,
  type Rotation,
} from "./customise.js";
export {
  ALIAS_CHAIN_LIMIT,
  type IconData,
  type IconifyAlias,
  type IconifyIcon,
  type IconifySet,
  iconData,
} from "./icon.js";
export { cleanNumber, formatNumber } from "./number.js";
export {
  calculateSize,
  iconToSvg,
  SVG_NS,
  type SvgBox,
  type SvgCustomisations,
  type SvgParts,
  svgToString,
} from "./svg.js";
