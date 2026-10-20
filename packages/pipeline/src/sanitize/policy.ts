// Белые списки санитайзера (ADR-0013), по образцу Iconify Tools: что остаётся, что удаляется,
// что исключает иконку. Таблицы — Map и Set, а не объекты: у объекта нашлись бы «свойства»
// constructor и __proto__, и элемент с таким именем прошёл бы проверку.

const list = (names: string): ReadonlySet<string> =>
  new Set(names.split(/\s+/).filter(Boolean));

const NONE: ReadonlySet<string> = new Set();

/** Атрибуты оформления: допустимы на фигурах, группах, корне, градиентах, масках и т. п. */
export const PRESENTATION = list(`
  clip-path clip-rule color color-interpolation color-interpolation-filters display
  fill fill-opacity fill-rule filter marker-start marker-mid marker-end mask opacity
  paint-order stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin
  stroke-miterlimit stroke-opacity stroke-width transform vector-effect visibility
`);

/** Свойства CSS, которые переводятся в одноимённые атрибуты (если атрибут разрешён элементу). */
export const STYLE_PROPERTIES: ReadonlySet<string> = new Set([
  ...PRESENTATION,
  ...list(
    "stop-color stop-opacity flood-color flood-opacity lighting-color mask-type",
  ),
]);

export interface ElementRule {
  /** Разрешённые атрибуты, кроме атрибутов оформления. */
  attrs: ReadonlySet<string>;
  /** Разрешены ли атрибуты оформления (PRESENTATION). */
  presentation: boolean;
  /** Внутри каких элементов может лежать; не задано — внутри любого разрешённого. */
  parents?: ReadonlySet<string>;
  /** Какие элементы может содержать; не задано — любые разрешённые. */
  children?: ReadonlySet<string>;
  /** Фигура: рисует сама. */
  shape?: true;
  /** Сам не рисуется, только по ссылке (defs, clipPath, градиенты…). */
  hidden?: true;
}

const shape = (attrs: string): ElementRule => ({
  attrs: list(`id pathLength ${attrs}`),
  presentation: true,
  children: NONE,
  shape: true,
});

const IN_FILTER = list("filter");
const LIGHTS = list("feDistantLight fePointLight feSpotLight");
const LIGHTING = list("feDiffuseLighting feSpecularLighting");
const FUNCS = list("feFuncR feFuncG feFuncB feFuncA");

/** Примитив фильтра: общие атрибуты плюс свои. */
const primitive = (
  attrs: string,
  children: ReadonlySet<string> = NONE,
): ElementRule => ({
  attrs: list(
    `id x y width height result color-interpolation-filters ${attrs}`,
  ),
  presentation: false,
  parents: IN_FILTER,
  children,
});

const leaf = (attrs: string, parents: ReadonlySet<string>): ElementRule => ({
  attrs: list(`id ${attrs}`),
  presentation: false,
  parents,
  children: NONE,
});

const PRIMITIVES: [string, ElementRule][] = [
  ["feBlend", primitive("in in2 mode")],
  ["feColorMatrix", primitive("in type values")],
  ["feComponentTransfer", primitive("in", FUNCS)],
  ["feComposite", primitive("in in2 operator k1 k2 k3 k4")],
  [
    "feConvolveMatrix",
    primitive(
      "in order kernelMatrix divisor bias targetX targetY edgeMode kernelUnitLength preserveAlpha",
    ),
  ],
  [
    "feDiffuseLighting",
    primitive(
      "in surfaceScale diffuseConstant kernelUnitLength lighting-color",
      LIGHTS,
    ),
  ],
  [
    "feDisplacementMap",
    primitive("in in2 scale xChannelSelector yChannelSelector"),
  ],
  [
    "feDropShadow",
    primitive("in dx dy stdDeviation flood-color flood-opacity"),
  ],
  ["feFlood", primitive("flood-color flood-opacity")],
  ["feGaussianBlur", primitive("in stdDeviation edgeMode")],
  ["feMerge", primitive("", list("feMergeNode"))],
  ["feMorphology", primitive("in operator radius")],
  ["feOffset", primitive("in dx dy")],
  [
    "feSpecularLighting",
    primitive(
      "in surfaceScale specularConstant specularExponent kernelUnitLength lighting-color",
      LIGHTS,
    ),
  ],
  ["feTile", primitive("in")],
  ["feTurbulence", primitive("baseFrequency numOctaves seed stitchTiles type")],
];

/** Разрешённые элементы SVG и их атрибуты. Всё, чего здесь нет, иконку исключает. */
export const ELEMENTS: ReadonlyMap<string, ElementRule> = new Map<
  string,
  ElementRule
>([
  [
    "svg",
    {
      attrs: list("width height viewBox preserveAspectRatio"),
      presentation: true,
    },
  ],
  ["g", { attrs: list("id"), presentation: true }],
  ["defs", { attrs: NONE, presentation: false, hidden: true }],
  [
    "symbol",
    {
      attrs: list("id viewBox preserveAspectRatio x y width height refX refY"),
      presentation: true,
      hidden: true,
    },
  ],
  [
    "use",
    {
      attrs: list("id href x y width height"),
      presentation: true,
      children: NONE,
      shape: true,
    },
  ],
  ["path", shape("d")],
  ["rect", shape("x y width height rx ry")],
  ["circle", shape("cx cy r")],
  ["ellipse", shape("cx cy rx ry")],
  ["line", shape("x1 y1 x2 y2")],
  ["polyline", shape("points")],
  ["polygon", shape("points")],
  [
    "linearGradient",
    {
      attrs: list(
        "id x1 y1 x2 y2 gradientUnits gradientTransform spreadMethod href",
      ),
      presentation: true,
      children: list("stop"),
      hidden: true,
    },
  ],
  [
    "radialGradient",
    {
      attrs: list(
        "id cx cy r fx fy fr gradientUnits gradientTransform spreadMethod href",
      ),
      presentation: true,
      children: list("stop"),
      hidden: true,
    },
  ],
  [
    "stop",
    leaf(
      "offset stop-color stop-opacity",
      list("linearGradient radialGradient"),
    ),
  ],
  [
    "pattern",
    {
      attrs: list(
        "id x y width height patternUnits patternContentUnits patternTransform viewBox preserveAspectRatio href",
      ),
      presentation: true,
      hidden: true,
    },
  ],
  [
    "clipPath",
    { attrs: list("id clipPathUnits"), presentation: true, hidden: true },
  ],
  [
    "mask",
    {
      attrs: list("id x y width height maskUnits maskContentUnits mask-type"),
      presentation: true,
      hidden: true,
    },
  ],
  [
    "marker",
    {
      attrs: list(
        "id viewBox preserveAspectRatio refX refY markerUnits markerWidth markerHeight orient",
      ),
      presentation: true,
      hidden: true,
    },
  ],
  [
    "filter",
    {
      attrs: list(
        "id x y width height filterUnits primitiveUnits color-interpolation-filters",
      ),
      presentation: false,
      children: new Set(PRIMITIVES.map(([name]) => name)),
      hidden: true,
    },
  ],
  ...PRIMITIVES,
  ["feMergeNode", leaf("in", list("feMerge"))],
  ...[...FUNCS].map((name): [string, ElementRule] => [
    name,
    leaf(
      "type tableValues slope intercept amplitude exponent offset",
      list("feComponentTransfer"),
    ),
  ]),
  ["feDistantLight", leaf("azimuth elevation", LIGHTING)],
  ["fePointLight", leaf("x y z", LIGHTING)],
  [
    "feSpotLight",
    leaf(
      "x y z pointsAtX pointsAtY pointsAtZ specularExponent limitingConeAngle",
      LIGHTING,
    ),
  ],
]);

/** Атрибуты, которые влияют на рисунок: их потеря — повод посмотреть на иконку глазами. */
export const RENDERING_ATTRS: ReadonlySet<string> = new Set(
  [
    ...PRESENTATION,
    ...[...ELEMENTS.values()].flatMap((rule) => [...rule.attrs]),
  ].filter((name) => name !== "id"),
);

/** Опасные элементы: удаляются со всем содержимым, в любом регистре и пространстве имён. */
export const DANGEROUS_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ["script", "скрипт <script>"],
  ["foreignobject", "встроенный HTML <foreignObject>"],
  ["image", "картинка <image>"],
  ["feimage", "картинка в фильтре <feImage>"],
]);

/** Лишние элементы SVG: удаляются со всем содержимым. */
export const JUNK_ELEMENTS = list("title desc metadata");

const reason = (names: string, why: string) =>
  [...list(names)].map((name): [string, string] => [name, why]);

/** Запрещённые элементы с понятной причиной; любой другой неизвестный элемент тоже исключает иконку. */
export const FORBIDDEN_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ...reason("a", "ссылка"),
  ...reason(
    `text tspan textPath tref altGlyph altGlyphDef altGlyphItem glyph glyphRef missing-glyph
     font font-face font-face-src font-face-uri font-face-format font-face-name hkern vkern`,
    "текст и шрифты",
  ),
  ...reason(
    "animate animateMotion animateTransform animateColor set mpath discard",
    "анимация (пока не разрешена)",
  ),
  ...reason("switch", "условная разметка"),
  ...reason("handler listener", "обработчик событий SVG Tiny"),
  ...reason(
    "view cursor color-profile solidcolor hatch hatchpath",
    "элемент не нужен иконке",
  ),
]);

/** Пространство имён XML Events: атрибуты оттуда назначают обработчики. */
export const XML_EVENTS_NS = "http://www.w3.org/2001/xml-events";

const EDITOR_NAMESPACES: ReadonlySet<string> = new Set([
  "http://www.inkscape.org/namespaces/inkscape",
  "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
  "http://inkscape.sourceforge.net/DTD/sodipodi-0.dtd",
  "http://www.bohemiancoding.com/sketch/ns",
  "http://www.serif.com/",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "http://purl.org/dc/elements/1.1/",
  "http://creativecommons.org/ns#",
  "http://web.resource.org/cc/",
]);

/** Пространства имён редакторов и метаданных: Inkscape, Sodipodi, Illustrator, Sketch, Affinity, RDF. */
export function isEditorNamespace(uri: string): boolean {
  return EDITOR_NAMESPACES.has(uri) || uri.startsWith("http://ns.adobe.com/");
}

const JUNK_ATTRS = list(`
  version baseProfile enable-background contentScriptType contentStyleType zoomAndPan
  focusable tabindex role
`);

/** Служебные атрибуты: на рисунок не влияют. */
export const isJunkAttr = (name: string) =>
  JUNK_ATTRS.has(name) || name.startsWith("data-") || name.startsWith("aria-");

/** Атрибуты корня, которые иконке не нужны (остальные служебные — в isJunkAttr). */
export const ROOT_JUNK_ATTRS = list("id x y overflow");

export type ValueCheck =
  | { ok: true; value: string }
  | { ok: false; dangerous: boolean; why: string };

const ID = "[A-Za-z0-9_.:-]+";
const LOCAL_HREF = new RegExp(`^#${ID}$`);
const LOCAL_URL = new RegExp(
  `^url\\(\\s*(["']?)#(${ID})\\1\\s*\\)(?:\\s+(.+))?$`,
  "i",
);
const URL_ATTRS = list(
  "fill stroke clip-path mask filter marker-start marker-mid marker-end",
);
const PAINT_ATTRS = list("fill stroke");
const COLOR_ATTRS = list(
  "fill stroke color stop-color flood-color lighting-color",
);
const TRANSFORM_ATTRS = list("transform gradientTransform patternTransform");
const COLOR_FUNCTIONS = list("rgb rgba hsl hsla");
const TRANSFORM_FUNCTIONS = list("matrix translate scale rotate skewX skewY");
/** Функции CSS, которые умеют загрузить что-то извне или выполнить код. */
const FETCHING_FUNCTIONS = list(`
  url image image-set -webkit-image-set cross-fade -webkit-cross-fade element -moz-element
  src expression paint
`);

/**
 * Есть ли символы ниже пробела (управляющие); проверка по кодам, без регулярных выражений.
 * Табуляция и переводы строк сюда не доходят: checkValue заменяет их пробелами.
 */
const hasControlChars = (value: string) => {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};

/** Без пробелов и управляющих символов: так браузер читает схему ссылки. */
const compact = (value: string) => {
  let out = "";
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    if (c > 0x20 && c !== 0x7f) out += ch.toLowerCase();
  }
  return out;
};

/**
 * Проверяет значение разрешённого атрибута. Ссылки — только на `#id` внутри иконки,
 * url() — только в атрибутах оформления, функции — только цветовые и функции transform.
 */
export function checkValue(name: string, raw: string): ValueCheck {
  // Табуляция и переводы строк — пробелы, как их читает браузер: в атрибут они попадают ссылками
  // &#9; &#10; &#13;, в CSS из <style> — как есть. Схему ссылки это не прячет: compact их убирает.
  const value = raw.replace(/[\t\n\r]/g, " ").trim();
  // Схема — в начале значения или после разделителя: `url(data:…)`, но не `id="metadata:1"`.
  if (/(?:^|[^a-z0-9+.-])(?:javascript|vbscript|data):/.test(compact(value))) {
    return { ok: false, dangerous: true, why: "опасная ссылка" };
  }
  if (hasControlChars(value)) {
    return { ok: false, dangerous: true, why: "управляющий символ" };
  }
  if (name === "href") {
    return LOCAL_HREF.test(value)
      ? { ok: true, value }
      : { ok: false, dangerous: true, why: "внешняя ссылка" };
  }
  let rest = value;
  let normalized = value;
  if (/url\s*\(/i.test(value)) {
    if (!URL_ATTRS.has(name)) {
      return { ok: false, dangerous: true, why: "url() в этом атрибуте" };
    }
    const m = LOCAL_URL.exec(value);
    if (!m)
      return { ok: false, dangerous: true, why: "внешняя ссылка в url()" };
    const fallback = m[3];
    if (fallback !== undefined && !PAINT_ATTRS.has(name)) {
      return { ok: false, dangerous: false, why: "лишнее после url()" };
    }
    rest = fallback ?? "";
    normalized = `url(#${m[2]})${fallback === undefined ? "" : ` ${fallback}`}`;
  }
  if (/[\\"'`<>]/.test(rest)) {
    return { ok: false, dangerous: true, why: "подозрительные символы" };
  }
  for (const m of rest.matchAll(/(-?[A-Za-z][\w-]*)\s*\(/g)) {
    const fn = m[1] ?? "";
    if (FETCHING_FUNCTIONS.has(fn.toLowerCase())) {
      return { ok: false, dangerous: true, why: `функция ${fn}()` };
    }
    const allowed =
      (COLOR_ATTRS.has(name) && COLOR_FUNCTIONS.has(fn.toLowerCase())) ||
      (TRANSFORM_ATTRS.has(name) && TRANSFORM_FUNCTIONS.has(fn));
    if (!allowed)
      return { ok: false, dangerous: false, why: `функция ${fn}()` };
  }
  return { ok: true, value: normalized };
}
