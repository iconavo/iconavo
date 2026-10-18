// Свой разбор простого CSS (ADR-0013): правила с селекторами «тег», «.класс», «#id»
// и их сочетаниями, объявления «свойство: значение». Всё сложнее — повод исключить
// иконку, а не гадать, как её нарисует браузер.

/** CSS, который нельзя честно перевести в атрибуты: иконка исключается. */
export class CssError extends Error {
  override name = "CssError";
}

export interface CssDeclaration {
  property: string;
  value: string;
  important: boolean;
}

export interface CssSelector {
  tag: string | null;
  classes: string[];
  id: string | null;
  /** Специфичность одним числом: id — 10000, класс — 100, тег — 1. */
  specificity: number;
}

export interface CssRule {
  selectors: CssSelector[];
  declarations: CssDeclaration[];
}

function checkText(text: string): void {
  if (text.includes("\\")) {
    throw new CssError("обратная косая черта (экранирование) в CSS");
  }
  if (text.includes("<!--") || text.includes("-->")) {
    throw new CssError("разметка <!-- --> внутри CSS");
  }
}

function stripComments(text: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const start = text.indexOf("/*", i);
    if (start === -1) return out + text.slice(i);
    const end = text.indexOf("*/", start + 2);
    if (end === -1) throw new CssError("незакрытый комментарий в CSS");
    out += `${text.slice(i, start)} `;
    i = end + 2;
  }
}

/** Делит по «;» вне кавычек и скобок. */
function splitDeclarations(text: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (ch === ";" && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (quote) throw new CssError("незакрытая строка в CSS");
  parts.push(text.slice(start));
  return parts;
}

/** Объявления из атрибута style или из блока правила. */
export function parseDeclarations(text: string): CssDeclaration[] {
  checkText(text);
  const body = stripComments(text);
  if (/[{}]/.test(body))
    throw new CssError("фигурные скобки внутри объявлений");
  const out: CssDeclaration[] = [];
  for (const part of splitDeclarations(body)) {
    if (part.trim() === "") continue;
    const colon = part.indexOf(":");
    if (colon === -1) throw new CssError(`ошибка в CSS: «${part.trim()}»`);
    const property = part.slice(0, colon).trim().toLowerCase();
    if (property.startsWith("--")) {
      throw new CssError(`переменные CSS (${property}) не поддерживаются`);
    }
    if (!/^-?[a-z][a-z0-9-]*$/.test(property)) {
      throw new CssError(`ошибка в CSS: свойство «${property}»`);
    }
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, "").trim();
    if (value === "") throw new CssError(`у свойства ${property} нет значения`);
    out.push({ property, value, important });
  }
  return out;
}

const COMPOUND = /^([A-Za-z][\w-]*)?((?:[.#][A-Za-z_-][\w-]*)*)$/;

function parseSelectors(text: string): CssSelector[] {
  return text.split(",").map((raw) => {
    const selector = raw.trim();
    const m = COMPOUND.exec(selector);
    if (!selector || !m) {
      throw new CssError(
        `селектор «${selector}» не поддерживается (только тег, .класс и #id)`,
      );
    }
    const tag = m[1] ?? null;
    const classes: string[] = [];
    const ids: string[] = [];
    for (const part of (m[2] ?? "").match(/[.#][^.#]+/g) ?? []) {
      (part.startsWith(".") ? classes : ids).push(part.slice(1));
    }
    if (ids.length > 1) {
      throw new CssError(`селектор «${selector}» не поддерживается (два id)`);
    }
    return {
      tag,
      classes,
      id: ids[0] ?? null,
      specificity: ids.length * 10000 + classes.length * 100 + (tag ? 1 : 0),
    };
  });
}

/** Таблица стилей из <style>. @-правила, вложенность и сложные селекторы — CssError. */
export function parseStyleSheet(text: string): CssRule[] {
  checkText(text);
  const body = stripComments(text);
  if (body.includes("@")) {
    throw new CssError(
      "@-правила (@import, @media, @keyframes, @font-face…) не поддерживаются",
    );
  }
  const rules: CssRule[] = [];
  let i = 0;
  for (;;) {
    const open = body.indexOf("{", i);
    const head = body.slice(i, open === -1 ? undefined : open);
    if (head.includes("}")) throw new CssError("лишняя «}» в CSS");
    if (open === -1) {
      if (head.trim()) throw new CssError(`ошибка в CSS: «${head.trim()}»`);
      return rules;
    }
    const close = body.indexOf("}", open + 1);
    if (close === -1) throw new CssError("незакрытый блок в CSS");
    const block = body.slice(open + 1, close);
    if (block.includes("{")) {
      throw new CssError("вложенные блоки CSS не поддерживаются");
    }
    rules.push({
      selectors: parseSelectors(head),
      declarations: parseDeclarations(block),
    });
    i = close + 1;
  }
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Победившие значения свойств для элемента по правилам каскада CSS:
 * inline `!important` → `!important` таблицы → inline → таблица (по специфичности, затем по порядку).
 * Атрибуты оформления слабее любого из них.
 */
export function cascade(
  rules: readonly CssRule[],
  inline: readonly CssDeclaration[],
  element: {
    tag: string;
    classes: ReadonlySet<string>;
    id: string | undefined;
  },
): Map<string, string> {
  const best = new Map<string, { value: string; key: number[] }>();
  const consider = (d: CssDeclaration, key: number[]) => {
    const current = best.get(d.property);
    if (!current || compareKeys(key, current.key) >= 0) {
      best.set(d.property, { value: d.value, key });
    }
  };
  rules.forEach((rule, order) => {
    let specificity = -1;
    for (const s of rule.selectors) {
      const matches =
        (s.tag === null || s.tag === element.tag) &&
        (s.id === null || s.id === element.id) &&
        s.classes.every((c) => element.classes.has(c));
      if (matches) specificity = Math.max(specificity, s.specificity);
    }
    if (specificity < 0) return;
    rule.declarations.forEach((d, j) => {
      consider(d, [d.important ? 1 : 0, 0, specificity, order, j]);
    });
  });
  inline.forEach((d, j) => {
    consider(d, [d.important ? 1 : 0, 1, 0, 0, j]);
  });
  return new Map([...best].map(([property, c]) => [property, c.value]));
}

/** Почему свойство нельзя перенести в атрибут без искажений; null — можно. */
export function cssOnlyReason(property: string, value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/(?:^|[^\w-])var\s*\(/.test(v))
    return "переменные var() есть только в CSS";
  if (
    property === "transform" ||
    property.startsWith("transform-") ||
    property.startsWith("animation") ||
    property.startsWith("transition")
  ) {
    return "есть только в CSS, в атрибут без искажений не переносится";
  }
  if (property === "mix-blend-mode" && v !== "normal") {
    return "режим наложения есть только в CSS";
  }
  if (property === "isolation" && v !== "auto") {
    return "isolation есть только в CSS";
  }
  const effect =
    property === "clip-path" || property === "mask" || property === "filter";
  if (effect && v !== "none" && !v.startsWith("url(")) {
    return "CSS-эффект без url() в атрибут не переносится";
  }
  return null;
}

const JUNK_PROPERTIES = new Set([
  "font",
  "writing-mode",
  "direction",
  "unicode-bidi",
  "baseline-shift",
  "dominant-baseline",
  "alignment-baseline",
  "white-space",
  "inline-size",
  "enable-background",
  "shape-rendering",
  "image-rendering",
  "color-rendering",
  "cursor",
  "solid-color",
  "solid-opacity",
  "overflow",
  "marker",
]);

/** Мусор из редакторов, который на рисунок иконки не влияет: отбрасывается. */
export function isJunkProperty(property: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    property.startsWith("-") ||
    /^(?:font|text|letter|word|line)-/.test(property) ||
    JUNK_PROPERTIES.has(property) ||
    (property === "isolation" && v === "auto") ||
    (property === "mix-blend-mode" && v === "normal")
  );
}
