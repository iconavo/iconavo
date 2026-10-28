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
export { replaceIds } from "./ids.js";
export {
  loadIcon,
  MAX_NAMES,
  MAX_URL,
  RETRIES,
  ROTATE,
  ROTATE_CDN,
  TIMEOUT,
  warn,
} from "./load.js";
export { isValidIconName, isValidNamePart } from "./name.js";
export { cleanNumber, formatNumber } from "./number.js";
export { type RenderOptions, renderIcon, setStrokeWidth } from "./render.js";
export {
  DEFAULT_API,
  DEFAULT_CDN,
  getIcon,
  type IconState,
  type Settings,
  type Store,
  store,
  subscribeIcon,
} from "./store.js";
export {
  calculateSize,
  iconToSvg,
  SVG_NS,
  type SvgAttributes,
  type SvgBox,
  type SvgCustomisations,
  type SvgParts,
  svgToString,
} from "./svg.js";
