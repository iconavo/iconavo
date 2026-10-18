// Санитайзер SVG по белому списку (ADR-0013). Шаги — как в Iconify Tools: разбор без DTD
// и сущностей, перевод style и <style> в атрибуты, чистка корня, проверка тегов и атрибутов.
// Результат собирается заново из того, что разрешено, поэтому всё непонятое в него не попадает.

import { refsOf } from "../svg/refs.js";
import type { SvgElement } from "../svg/serialize.js";
import {
  decodeSvg,
  MAX_DEPTH,
  MAX_SVG_BYTES,
  parseXml,
  SVG_NS,
  XHTML_NS,
  XLINK_NS,
  XML_NS,
  type XmlElement,
  XmlParseError,
} from "../svg/xml.js";
import {
  type CssDeclaration,
  CssError,
  type CssRule,
  cascade,
  cssOnlyReason,
  isJunkProperty,
  parseDeclarations,
  parseStyleSheet,
} from "./css.js";
import {
  checkValue,
  DANGEROUS_ELEMENTS,
  ELEMENTS,
  type ElementRule,
  FORBIDDEN_ELEMENTS,
  isEditorNamespace,
  isJunkAttr,
  JUNK_ELEMENTS,
  PRESENTATION,
  RENDERING_ATTRS,
  ROOT_JUNK_ATTRS,
  STYLE_PROPERTIES,
  XML_EVENTS_NS,
} from "./policy.js";

/** dangerous — опасное, junk — лишнее, style — стили переведены в атрибуты, unknown — неизвестное. */
export type RemovalKind = "dangerous" | "junk" | "style" | "unknown";

export interface Removal {
  kind: RemovalKind;
  /** Что удалено или переведено, по-русски: «скрипт <script>», «атрибут class». */
  what: string;
  count: number;
}

export interface SanitizeOptions {
  maxBytes?: number;
  maxDepth?: number;
  /** Сколько элементов может получиться после раскрытия всех <use> (защита от «use-бомбы»). */
  maxExpanded?: number;
}

export type SanitizeResult =
  | {
      status: "kept";
      svg: SvgElement;
      /** Удалено или переведено хоть что-то. */
      changed: boolean;
      removals: Removal[];
      warnings: string[];
      /** Атрибуты геометрии и цвета, которые пришлось удалить: повод посмотреть глазами. */
      lost: string[];
      /** Фигур в исходнике и после очистки. */
      shapes: { before: number; after: number };
    }
  | { status: "excluded"; reason: string; removals: Removal[] };

export const MAX_EXPANDED = 20_000;

const KIND_ORDER: readonly RemovalKind[] = [
  "dangerous",
  "junk",
  "style",
  "unknown",
];

/** Иконку нельзя оставить: причина уходит в отчёт. */
class Excluded extends Error {}

const ROOT_RULE = ELEMENTS.get("svg") as ElementRule;

/** Очищает одну иконку. Не бросает исключений из-за содержимого файла — только возвращает итог. */
export function sanitizeSvg(
  input: Uint8Array | string,
  options: SanitizeOptions = {},
): SanitizeResult {
  const s = new Sanitizer(options);
  try {
    return s.run(input);
  } catch (e) {
    if (
      e instanceof Excluded ||
      e instanceof XmlParseError ||
      e instanceof CssError
    ) {
      return { status: "excluded", reason: reasonOf(e), removals: s.list() };
    }
    throw e;
  }
}

function reasonOf(e: Excluded | XmlParseError | CssError): string {
  if (e instanceof CssError) return `CSS не поддерживается: ${e.message}`;
  if (e instanceof XmlParseError && e.code === "syntax") {
    return `XML не читается: ${e.message}`;
  }
  return e.message;
}

/** Сколько фигур в дереве (вместе с теми, что рисуются только по ссылке). */
export const countShapes = (el: SvgElement): number =>
  (ELEMENTS.get(el.tag)?.shape ? 1 : 0) +
  el.children.reduce((n, child) => n + countShapes(child), 0);

/** Фигуры, которые видны сами, а не только по ссылке из defs, clipPath и т. п. */
const countVisibleShapes = (el: SvgElement): number => {
  const rule = ELEMENTS.get(el.tag);
  if (rule?.hidden) return 0;
  return (
    (rule?.shape ? 1 : 0) +
    el.children.reduce((n, child) => n + countVisibleShapes(child), 0)
  );
};

class Sanitizer {
  private readonly removals = new Map<string, Removal>();
  private readonly warnings = new Set<string>();
  private readonly lost: string[] = [];
  private rules: CssRule[] = [];
  private noNamespace = false;
  private sourceShapes = 0;
  private readonly maxBytes: number;
  private readonly maxDepth: number;
  private readonly maxExpanded: number;

  constructor(options: SanitizeOptions) {
    this.maxBytes = options.maxBytes ?? MAX_SVG_BYTES;
    this.maxDepth = options.maxDepth ?? MAX_DEPTH;
    this.maxExpanded = options.maxExpanded ?? MAX_EXPANDED;
  }

  list(): Removal[] {
    return [...this.removals.values()].sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        (a.what < b.what ? -1 : a.what > b.what ? 1 : 0),
    );
  }

  private remove(kind: RemovalKind, what: string, count = 1): void {
    const key = `${kind} ${what}`;
    const r = this.removals.get(key);
    if (r) r.count += count;
    else this.removals.set(key, { kind, what, count });
  }

  run(input: Uint8Array | string): SanitizeResult {
    const text =
      typeof input === "string" ? input : decodeSvg(input, this.maxBytes);
    const doc = parseXml(text, { maxDepth: this.maxDepth });
    if (doc.doctype) this.remove("junk", "DOCTYPE");
    if (doc.comments > 0) this.remove("junk", "комментарии", doc.comments);
    for (const target of doc.instructions) {
      if (target.toLowerCase() === "xml-stylesheet") {
        this.remove("dangerous", "внешний стиль <?xml-stylesheet?>");
      } else {
        this.remove("junk", `инструкция <?${target}?>`);
      }
    }

    const root = doc.root;
    this.noNamespace = root.ns === null;
    if (root.local !== "svg" || !this.isSvg(root)) {
      throw new Excluded(`корневой элемент — <${root.qname}>, а не <svg>`);
    }
    this.rules = this.collectStyles(root);
    const svg = this.element(root, null, ROOT_RULE);

    this.checkReferences(svg);
    if (countVisibleShapes(svg) === 0) {
      throw new Excluded("после очистки не осталось фигур");
    }
    const removals = this.list();
    return {
      status: "kept",
      svg,
      changed: removals.length > 0,
      removals,
      warnings: [...this.warnings],
      lost: this.lost,
      shapes: { before: this.sourceShapes, after: countShapes(svg) },
    };
  }

  private isSvg(el: XmlElement): boolean {
    return el.ns === SVG_NS || (this.noNamespace && el.ns === null);
  }

  /** Элемент, который удаляется вместе с содержимым: опасный, лишний или из редактора. */
  private isRemovedSubtree(el: XmlElement): boolean {
    return (
      DANGEROUS_ELEMENTS.has(el.local.toLowerCase()) ||
      el.ns === XHTML_NS ||
      (this.isSvg(el) && JUNK_ELEMENTS.has(el.local)) ||
      (el.ns !== null && isEditorNamespace(el.ns))
    );
  }

  /** Все таблицы стилей из <style> — до обхода: CSS действует на весь файл, где бы ни стоял. */
  private collectStyles(root: XmlElement): CssRule[] {
    const rules: CssRule[] = [];
    const stack: XmlElement[] = [root];
    while (stack.length > 0) {
      const el = stack.pop() as XmlElement;
      if (el !== root && this.isRemovedSubtree(el)) continue;
      if (this.isSvg(el) && el.local === "style") {
        rules.push(...this.styleElement(el));
        continue;
      }
      if (this.isSvg(el) && ELEMENTS.get(el.local)?.shape) this.sourceShapes++;
      // Дети кладутся с конца: так стек отдаёт их в порядке документа, и порядок правил верный.
      for (let i = el.children.length - 1; i >= 0; i--) {
        const child = el.children[i];
        if (child?.type === "element") stack.push(child);
      }
    }
    return rules;
  }

  private styleElement(el: XmlElement): CssRule[] {
    for (const a of el.attrs) {
      if (a.ns !== null) continue;
      const v = a.value.trim().toLowerCase();
      if (a.local === "type" && v !== "" && v !== "text/css") {
        throw new Excluded(`<style type="${a.value}"> не поддерживается`);
      }
      if (a.local === "media") {
        throw new Excluded("<style media=…> не поддерживается");
      }
    }
    let css = "";
    for (const child of el.children) {
      if (child.type === "element") {
        throw new Excluded(`внутри <style> элемент <${child.qname}>`);
      }
      css += child.text;
    }
    return parseStyleSheet(css);
  }

  /** Что делать с элементом: оставить, удалить (и как посчитать) или исключить иконку. */
  private classify(
    el: XmlElement,
    parent: string,
  ): { rule: ElementRule } | { kind: RemovalKind; what: string } | "style" {
    const danger = DANGEROUS_ELEMENTS.get(el.local.toLowerCase());
    if (danger) return { kind: "dangerous", what: danger };
    if (el.ns === XHTML_NS) {
      return { kind: "dangerous", what: `HTML-элемент <${el.local}>` };
    }
    const where = `(строка ${el.line})`;
    if (this.isSvg(el)) {
      if (JUNK_ELEMENTS.has(el.local)) {
        return { kind: "junk", what: `<${el.local}>` };
      }
      if (el.local === "style") return "style";
      if (el.local === "svg") throw new Excluded(`вложенный <svg> ${where}`);
      const rule = ELEMENTS.get(el.local);
      if (!rule) {
        const why = FORBIDDEN_ELEMENTS.get(el.local);
        throw new Excluded(
          why
            ? `<${el.local}> — ${why} ${where}`
            : `неизвестный элемент <${el.qname}> ${where}`,
        );
      }
      if (rule.parents && !rule.parents.has(parent)) {
        throw new Excluded(
          `<${el.local}> не может лежать внутри <${parent}> ${where}`,
        );
      }
      const parentRule = ELEMENTS.get(parent);
      if (parentRule?.children && !parentRule.children.has(el.local)) {
        throw new Excluded(
          `<${parent}> не может содержать <${el.local}> ${where}`,
        );
      }
      return { rule };
    }
    if (el.ns !== null && isEditorNamespace(el.ns)) {
      return { kind: "junk", what: `метаданные редактора <${el.qname}>` };
    }
    throw new Excluded(
      `элемент <${el.qname}> из неизвестного пространства имён ${el.ns ?? "(без пространства имён)"} ${where}`,
    );
  }

  private element(
    el: XmlElement,
    parent: string | null,
    rule: ElementRule,
  ): SvgElement {
    const tag = el.local;
    const out: SvgElement = {
      tag,
      attrs: this.attributes(el, tag, rule, parent === null),
      children: [],
    };
    for (const child of el.children) {
      if (child.type === "text") {
        if (child.text.trim() !== "")
          this.remove("junk", "текст вне элементов");
        continue;
      }
      const c = this.classify(child, tag);
      if (c === "style") {
        this.remove("style", "таблица <style> → атрибуты");
        continue;
      }
      if ("kind" in c) {
        this.remove(c.kind, c.what);
        continue;
      }
      const cleaned = this.element(child, tag, c.rule);
      if (cleaned.tag === "use" && cleaned.attrs.href === undefined) {
        this.remove("junk", "<use> без ссылки");
        continue;
      }
      out.children.push(cleaned);
    }
    return out;
  }

  private attributes(
    el: XmlElement,
    tag: string,
    rule: ElementRule,
    isRoot: boolean,
  ): Record<string, string> {
    const attrs: Record<string, string> = {};
    let inline: CssDeclaration[] = [];
    let classes: ReadonlySet<string> = new Set();
    let id: string | undefined;
    const hasHref = el.attrs.some((a) => a.ns === null && a.local === "href");
    for (const a of el.attrs) {
      if (a.local.toLowerCase().startsWith("on") || a.ns === XML_EVENTS_NS) {
        this.remove("dangerous", `обработчик ${a.qname}`);
      } else if (a.ns === null) {
        if (a.local === "style") {
          inline = parseDeclarations(a.value);
        } else if (a.local === "class") {
          classes = new Set(a.value.split(/\s+/).filter(Boolean));
          this.remove("junk", "атрибут class");
        } else {
          if (a.local === "id") id = a.value.trim();
          this.attribute(attrs, tag, rule, isRoot, a.local, a.value);
        }
      } else if (a.ns === XLINK_NS && a.local === "href") {
        if (hasHref) this.remove("junk", "xlink:href рядом с href");
        else this.attribute(attrs, tag, rule, isRoot, "href", a.value);
      } else if (a.ns === XLINK_NS) {
        this.remove("junk", a.qname);
      } else if (a.ns === XML_NS) {
        if (a.local === "base")
          this.remove("dangerous", "внешний адрес xml:base");
        else this.remove("junk", `xml:${a.local}`);
      } else if (isEditorNamespace(a.ns)) {
        this.remove("junk", `метаданные редактора ${a.qname}`);
      } else {
        this.remove("unknown", `${a.qname} у <${tag}>`);
      }
    }
    if (inline.length > 0 || this.rules.length > 0) {
      this.applyCss(attrs, tag, rule, { tag, classes, id }, inline);
    }
    return attrs;
  }

  private attribute(
    attrs: Record<string, string>,
    tag: string,
    rule: ElementRule,
    isRoot: boolean,
    name: string,
    value: string,
  ): void {
    if (isRoot && ROOT_JUNK_ATTRS.has(name)) {
      this.remove("junk", `${name} у корня`);
      return;
    }
    if (isJunkAttr(name)) {
      this.remove("junk", name);
      return;
    }
    if (!this.allowed(rule, name)) {
      this.remove("unknown", `${name} у <${tag}>`);
      if (PRESENTATION.has(name)) this.lost.push(`<${tag}> ${name}`);
      return;
    }
    const check = checkValue(name, value);
    if (!check.ok) {
      this.remove(
        check.dangerous ? "dangerous" : "unknown",
        `${name}: ${check.why}`,
      );
      if (RENDERING_ATTRS.has(name) && name !== "href") {
        this.lost.push(`<${tag}> ${name}`);
      }
      return;
    }
    attrs[name] = check.value;
  }

  private allowed(rule: ElementRule, name: string): boolean {
    return (
      rule.attrs.has(name) || (rule.presentation && PRESENTATION.has(name))
    );
  }

  /** Победившие по каскаду свойства становятся атрибутами (CSS сильнее атрибутов оформления). */
  private applyCss(
    attrs: Record<string, string>,
    tag: string,
    rule: ElementRule,
    element: {
      tag: string;
      classes: ReadonlySet<string>;
      id: string | undefined;
    },
    inline: readonly CssDeclaration[],
  ): void {
    const added: [string, string][] = [];
    for (const [property, value] of cascade(this.rules, inline, element)) {
      const cssOnly = cssOnlyReason(property, value);
      if (cssOnly) throw new Excluded(`CSS-свойство ${property}: ${cssOnly}`);
      if (isJunkProperty(property, value)) {
        this.remove("junk", `CSS ${property}`);
        continue;
      }
      if (!STYLE_PROPERTIES.has(property)) {
        this.remove("unknown", `CSS ${property}`);
        if (RENDERING_ATTRS.has(property))
          this.lost.push(`<${tag}> ${property}`);
        continue;
      }
      if (!this.allowed(rule, property)) {
        this.remove("junk", `CSS ${property} не действует на <${tag}>`);
        continue;
      }
      const check = checkValue(property, value);
      if (!check.ok) {
        const kind = check.dangerous ? "dangerous" : "unknown";
        this.remove(kind, `CSS ${property}: ${check.why}`);
        this.lost.push(`<${tag}> ${property}`);
        continue;
      }
      this.remove("style", `${property} → атрибут`);
      if (Object.hasOwn(attrs, property)) attrs[property] = check.value;
      else added.push([property, check.value]);
    }
    added.sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [property, value] of added) attrs[property] = value;
  }

  /** Ссылки #id: циклы и «use-бомбы» исключают иконку, ссылки в никуда — предупреждение. */
  private checkReferences(root: SvgElement): void {
    const all: SvgElement[] = [];
    const byId = new Map<string, SvgElement>();
    const stack: SvgElement[] = [root];
    while (stack.length > 0) {
      const el = stack.pop() as SvgElement;
      all.push(el);
      const id = el.attrs.id;
      if (id !== undefined) {
        if (byId.has(id)) this.warnings.add(`id «${id}» повторяется`);
        else byId.set(id, el);
      }
      stack.push(...el.children);
    }

    const refs = new Map<SvgElement, SvgElement[]>();
    for (const el of all) {
      const targets: SvgElement[] = [];
      for (const [name, value] of Object.entries(el.attrs)) {
        for (const id of refsOf(name, value)) {
          const target = byId.get(id);
          if (target) targets.push(target);
          else this.warnings.add(`ссылка на несуществующий #${id}`);
        }
      }
      refs.set(el, targets);
    }

    // Цикл по дочерним элементам и ссылкам: обход в глубину без рекурсии.
    const state = new Map<SvgElement, "open" | "done">();
    for (const start of all) {
      if (state.has(start)) continue;
      const path: { el: SvgElement; next: SvgElement[] }[] = [];
      const enter = (el: SvgElement) => {
        state.set(el, "open");
        path.push({ el, next: [...el.children, ...(refs.get(el) ?? [])] });
      };
      enter(start);
      while (path.length > 0) {
        const top = path[path.length - 1] as (typeof path)[number];
        const next = top.next.pop();
        if (next === undefined) {
          state.set(top.el, "done");
          path.pop();
        } else if (state.get(next) === "open") {
          throw new Excluded("ссылки по кругу: элемент ссылается сам на себя");
        } else if (!state.has(next)) {
          enter(next);
        }
      }
    }

    // Сколько элементов получится, если раскрыть все <use>; циклов уже нет.
    const limit = this.maxExpanded;
    const size = new Map<SvgElement, number>();
    const work: SvgElement[] = [root];
    while (work.length > 0) {
      const el = work[work.length - 1] as SvgElement;
      if (size.has(el)) {
        work.pop();
        continue;
      }
      const deps =
        el.tag === "use"
          ? [...el.children, ...(refs.get(el) ?? [])]
          : el.children;
      const pending = deps.filter((d) => !size.has(d));
      if (pending.length > 0) {
        work.push(...pending);
        continue;
      }
      const total = deps.reduce((n, d) => n + (size.get(d) ?? 0), 1);
      size.set(el, Math.min(total, limit + 1));
      work.pop();
    }
    if ((size.get(root) ?? 0) > limit) {
      throw new Excluded(
        `после раскрытия <use> больше ${limit} элементов («use-бомба»)`,
      );
    }
  }
}
