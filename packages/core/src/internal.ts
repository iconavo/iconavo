// Внутренний вход ядра — @iconavo-ui/core/internal (ADR-0029): для наших адаптеров (тег, React) и
// edge API. Это не обещание разработчикам: публичное API — только то, что описано в README пакета
// (index.ts).

export {
  type Flip,
  parseFlip,
  parseRotate,
  parseSize,
  type Rotation,
} from "./customise.js";
export { ALIAS_CHAIN_LIMIT, type IconData, iconData } from "./icon.js";
export {
  loadIcon,
  MAX_NAMES,
  MAX_URL,
  RETRIES,
  ROTATE,
  TIMEOUT,
} from "./load.js";
export { isValidIconName, isValidNamePart } from "./name.js";
export { cleanNumber, formatNumber } from "./number.js";
export {
  DEFAULT_API,
  DEFAULT_CDN,
  getIcon,
  type IconState,
  subscribeIcon,
} from "./store.js";
export {
  calculateSize,
  iconToSvg,
  SVG_NS,
  type SvgBox,
  type SvgCustomisations,
  type SvgParts,
  svgToString,
} from "./svg.js";
