// Независимая проверка готового SVG: не доверяем белому списку санитайзера, а смотрим на результат.
// Список тегов здесь — намеренно своя копия: ошибка в одной таблице не пройдёт незамеченной.

import {
  parseXml,
  SVG_NS,
  type XmlDocument,
  type XmlElement,
} from "../svg/xml.js";

const SAFE_TAGS: ReadonlySet<string> = new Set(
  `svg g defs symbol use path rect circle ellipse line polyline polygon linearGradient
   radialGradient stop pattern clipPath mask marker filter feBlend feColorMatrix
   feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap
   feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge
   feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile
   feTurbulence`
    .split(/\s+/)
    .filter(Boolean),
);

const PATTERNS: [RegExp, string][] = [
  [/<[!?]/, "DOCTYPE, комментарий или инструкция"],
  [/]]>/, "конец блока CDATA"],
  [/\son[a-z]*\s*=/i, "обработчик on…"],
  [/\s(?:style|class)\s*=/i, "атрибут style или class"],
  [/\s[\w-]+:[\w-]+\s*=/, "атрибут с приставкой (xlink:, xml: …)"],
  [/(?:^|[^a-z0-9+.-])(?:javascript|vbscript|data):/i, "опасная схема ссылки"],
  [/https?:|\/\//i, "внешний адрес"],
  [/\\/, "обратная косая черта"],
  [/&(?!(?:amp|quot|lt|gt);)/, "необычная ссылка на символ"],
  [/\shref="(?!#)/, "ссылка не на #id"],
  [/url\((?!#)/i, "url() не на #id"],
  [
    /<\/?(?:script|style|image|foreignObject|a|text|set|animate\w*|iframe)[\s/>]/i,
    "запрещённый тег",
  ],
];

/** Список проблем готового SVG (с xmlns у корня); пустой список — результат безопасен. */
export function checkSafeSvg(svg: string): string[] {
  const problems = new Set<string>();
  const body = svg.replace(` xmlns="${SVG_NS}"`, "");
  for (const [re, what] of PATTERNS) if (re.test(body)) problems.add(what);

  let doc: XmlDocument;
  try {
    doc = parseXml(svg);
  } catch (e) {
    problems.add(`не разбирается как XML: ${(e as Error).message}`);
    return [...problems];
  }
  if (doc.doctype || doc.comments > 0 || doc.instructions.length > 0) {
    problems.add("DOCTYPE, комментарий или инструкция");
  }
  const stack: XmlElement[] = [doc.root];
  while (stack.length > 0) {
    const el = stack.pop() as XmlElement;
    if (el.ns !== SVG_NS || !SAFE_TAGS.has(el.local)) {
      problems.add(`тег <${el.qname}> не из списка`);
    }
    if (el !== doc.root && el.local === "svg") problems.add("вложенный <svg>");
    for (const a of el.attrs) {
      if (a.ns !== null) problems.add(`атрибут с приставкой ${a.qname}`);
    }
    for (const child of el.children) {
      if (child.type === "text") problems.add("текст внутри SVG");
      else stack.push(child);
    }
  }
  return [...problems];
}
