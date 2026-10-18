// Строгий разбор XML для SVG-иконок — свой код без зависимостей (ADR-0013).
// DTD с объявлениями и любые сущности, кроме пяти стандартных и числовых, запрещены:
// так закрыты XXE и «миллиард смехов». Разбор без рекурсии, с лимитом вложенности.

export const SVG_NS = "http://www.w3.org/2000/svg";
export const XLINK_NS = "http://www.w3.org/1999/xlink";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";
export const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Самый большой файл в пяти наборах — 40 КБ, лимит с большим запасом. */
export const MAX_SVG_BYTES = 512 * 1024;
/** Самая глубокая вложенность в пяти наборах — 3. */
export const MAX_DEPTH = 64;

/** size, encoding, depth — лимиты; dtd, entity — запрещённые DTD и сущности; syntax — сломанный XML. */
export type XmlErrorCode =
  | "size"
  | "encoding"
  | "syntax"
  | "dtd"
  | "entity"
  | "depth";

export class XmlParseError extends Error {
  constructor(
    readonly code: XmlErrorCode,
    readonly detail: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(
      line === undefined
        ? detail
        : `${detail} (строка ${line}, позиция ${column})`,
    );
    this.name = "XmlParseError";
  }
}

export interface XmlAttr {
  /** Пространство имён; у атрибута без приставки — null. */
  ns: string | null;
  local: string;
  /** Имя как в файле, например `xlink:href`. */
  qname: string;
  value: string;
}

export interface XmlText {
  type: "text";
  text: string;
}

export interface XmlElement {
  type: "element";
  /** Пространство имён; null — элемент без пространства имён. */
  ns: string | null;
  local: string;
  /** Имя как в файле, например `svg:path`. */
  qname: string;
  attrs: XmlAttr[];
  children: XmlNode[];
  /** Строка файла, на которой начинается элемент. */
  line: number;
}

export type XmlNode = XmlElement | XmlText;

export interface XmlDocument {
  root: XmlElement;
  /** Был ли DOCTYPE (только без внутренних объявлений — с ними разбор падает). */
  doctype: boolean;
  /** Сколько комментариев было в файле. */
  comments: number;
  /** Цели инструкций обработки, кроме `<?xml … ?>`, например `xml-stylesheet`. */
  instructions: string[];
}

/** Байты файла → текст. Только UTF-8 (BOM допускается) и не больше maxBytes. */
export function decodeSvg(bytes: Uint8Array, maxBytes = MAX_SVG_BYTES): string {
  if (bytes.length > maxBytes) {
    throw new XmlParseError(
      "size",
      `файл больше ${Math.round(maxBytes / 1024)} КБ`,
    );
  }
  const utf16 =
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe);
  if (utf16) {
    throw new XmlParseError(
      "encoding",
      "файл в кодировке UTF-16, а нужна UTF-8",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new XmlParseError("encoding", "файл не в кодировке UTF-8");
  }
}

/** Разбирает текст SVG. Любое нарушение правил XML — исключение XmlParseError. */
export function parseXml(
  text: string,
  options: { maxDepth?: number } = {},
): XmlDocument {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return new Parser(
    body.replace(/\r\n?/g, "\n"),
    options.maxDepth ?? MAX_DEPTH,
  ).parse();
}

const NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;

const PREDEFINED: ReadonlyMap<string, string> = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);

const isSpace = (c: number) => c === 0x20 || c === 0x9 || c === 0xa;

/** Допустимый символ XML 1.0 (по коду). */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function splitName(qname: string): [prefix: string, local: string] {
  const colon = qname.indexOf(":");
  return colon === -1
    ? ["", qname]
    : [qname.slice(0, colon), qname.slice(colon + 1)];
}

const isNamespaceDecl = (qname: string) =>
  qname === "xmlns" || qname.startsWith("xmlns:");

interface Open {
  el: XmlElement;
  scope: ReadonlyMap<string, string>;
}

class Parser {
  private pos = 0;
  private lineCountedTo = 0;
  private lineNo = 1;
  private comments = 0;
  private readonly instructions: string[] = [];
  private doctype = false;

  constructor(
    private readonly s: string,
    private readonly maxDepth: number,
  ) {}

  parse(): XmlDocument {
    this.checkChars();
    if (this.s.startsWith("<?xml") && /[\s?]/.test(this.s[5] ?? "")) {
      this.xmlDeclaration();
    }
    this.misc(true);
    if (this.s[this.pos] !== "<")
      throw this.error("syntax", "нет корневого элемента");
    const root = this.elementTree();
    this.misc(false);
    if (this.pos < this.s.length) {
      throw this.error(
        "syntax",
        "после корневого элемента есть лишнее содержимое",
      );
    }
    return {
      root,
      doctype: this.doctype,
      comments: this.comments,
      instructions: this.instructions,
    };
  }

  private error(code: XmlErrorCode, detail: string, at = this.pos) {
    const before = this.s.slice(0, at);
    const line = before.split("\n").length;
    const column = at - before.lastIndexOf("\n");
    return new XmlParseError(code, detail, line, column);
  }

  /** Номер строки для позиции; позиции элементов растут, поэтому считаем по ходу. */
  private lineAt(at: number): number {
    for (; this.lineCountedTo < at; this.lineCountedTo++) {
      if (this.s.charCodeAt(this.lineCountedTo) === 0xa) this.lineNo++;
    }
    return this.lineNo;
  }

  private at(text: string): boolean {
    return this.s.startsWith(text, this.pos);
  }

  private skipSpaces(): number {
    const from = this.pos;
    while (isSpace(this.s.charCodeAt(this.pos))) this.pos++;
    return this.pos - from;
  }

  private name(): string {
    NAME.lastIndex = this.pos;
    const m = NAME.exec(this.s);
    if (!m) throw this.error("syntax", "ожидалось имя тега или атрибута");
    this.pos += m[0].length;
    return m[0];
  }

  /** Символы вне XML 1.0 (управляющие, одиночные суррогаты, U+FFFE/U+FFFF) — ошибка. */
  private checkChars(): void {
    const s = this.s;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (
        (c >= 0x20 && c <= 0xd7ff) ||
        c === 0x9 ||
        c === 0xa ||
        (c >= 0xe000 && c <= 0xfffd)
      ) {
        continue;
      }
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i++;
          continue;
        }
      }
      const hex = c.toString(16).toUpperCase().padStart(4, "0");
      throw this.error("syntax", `недопустимый символ U+${hex}`, i);
    }
  }

  private xmlDeclaration(): void {
    const end = this.s.indexOf("?>", 5);
    if (end === -1) throw this.error("syntax", "объявление <?xml не закрыто");
    const m =
      /^\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])([A-Za-z][\w.-]*)\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\4)?\s*$/.exec(
        this.s.slice(5, end),
      );
    if (!m) throw this.error("syntax", "неверное объявление <?xml … ?>");
    const encoding = m[3];
    if (encoding !== undefined && encoding.toLowerCase() !== "utf-8") {
      throw this.error("encoding", `кодировка «${encoding}», а нужна UTF-8`);
    }
    this.pos = end + 2;
  }

  /** Комментарии, инструкции и пробелы до или после корня; DOCTYPE — только до корня. */
  private misc(beforeRoot: boolean): void {
    for (;;) {
      this.skipSpaces();
      if (this.at("<!--")) this.comment();
      else if (this.at("<?")) this.instruction();
      else if (beforeRoot && this.at("<!DOCTYPE")) this.doctypeDecl();
      else return;
    }
  }

  private comment(): void {
    const start = this.pos;
    const end = this.s.indexOf("-->", start + 4);
    if (end === -1) throw this.error("syntax", "комментарий не закрыт", start);
    const body = this.s.slice(start + 4, end);
    if (body.includes("--") || body.endsWith("-")) {
      throw this.error(
        "syntax",
        "внутри комментария не может быть «--»",
        start,
      );
    }
    this.comments++;
    this.pos = end + 3;
  }

  private instruction(): void {
    const start = this.pos;
    this.pos += 2;
    const target = this.name();
    if (target.toLowerCase() === "xml") {
      throw this.error(
        "syntax",
        "объявление <?xml?> должно стоять в самом начале файла",
        start,
      );
    }
    const end = this.s.indexOf("?>", this.pos);
    if (end === -1) {
      throw this.error("syntax", `инструкция <?${target} не закрыта`, start);
    }
    if (end !== this.pos && !isSpace(this.s.charCodeAt(this.pos))) {
      throw this.error("syntax", `неверная инструкция <?${target}`, start);
    }
    this.instructions.push(target);
    this.pos = end + 2;
  }

  /** DOCTYPE пропускается и никогда не загружается; внутренние объявления `[…]` запрещены. */
  private doctypeDecl(): void {
    const start = this.pos;
    if (this.doctype) throw this.error("syntax", "второй DOCTYPE", start);
    this.pos += "<!DOCTYPE".length;
    for (;;) {
      const ch = this.s[this.pos];
      if (ch === undefined)
        throw this.error("syntax", "DOCTYPE не закрыт", start);
      if (ch === "[") {
        throw this.error(
          "dtd",
          "DTD с внутренними объявлениями запрещён (защита от XXE и «миллиарда смехов»)",
          start,
        );
      }
      if (ch === '"' || ch === "'") {
        const close = this.s.indexOf(ch, this.pos + 1);
        if (close === -1)
          throw this.error("syntax", "DOCTYPE не закрыт", start);
        this.pos = close + 1;
        continue;
      }
      this.pos++;
      if (ch === ">") break;
    }
    this.doctype = true;
  }

  /** Заменяет ссылки на символы; разрешены только пять стандартных и числовые. */
  private references(raw: string, offset: number): string {
    if (!raw.includes("&")) return raw;
    let out = "";
    let i = 0;
    for (;;) {
      const amp = raw.indexOf("&", i);
      if (amp === -1) return out + raw.slice(i);
      out += raw.slice(i, amp);
      const semi = raw.indexOf(";", amp + 1);
      const ref = semi === -1 ? "" : raw.slice(amp + 1, semi);
      if (!/^(?:#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z_][\w.-]*)$/.test(ref)) {
        throw this.error("entity", "одиночный «&» (нужно &amp;)", offset + amp);
      }
      if (ref.startsWith("#")) {
        const code =
          ref[1] === "x"
            ? Number.parseInt(ref.slice(2), 16)
            : Number.parseInt(ref.slice(1), 10);
        if (!isXmlChar(code)) {
          throw this.error(
            "entity",
            `недопустимый символ &${ref};`,
            offset + amp,
          );
        }
        out += String.fromCodePoint(code);
      } else {
        const ch = PREDEFINED.get(ref);
        if (ch === undefined) {
          throw this.error(
            "entity",
            `неизвестная сущность &${ref}; (DTD и сущности отключены)`,
            offset + amp,
          );
        }
        out += ch;
      }
      i = semi + 1;
    }
  }

  private attrValue(): string {
    const quote = this.s[this.pos];
    if (quote !== '"' && quote !== "'") {
      throw this.error("syntax", "значение атрибута должно быть в кавычках");
    }
    const end = this.s.indexOf(quote, this.pos + 1);
    if (end === -1) throw this.error("syntax", "значение атрибута не закрыто");
    const raw = this.s.slice(this.pos + 1, end);
    const lt = raw.indexOf("<");
    if (lt !== -1) {
      throw this.error(
        "syntax",
        "символ «<» внутри значения атрибута",
        this.pos + 1 + lt,
      );
    }
    // Нормализация по XML: табуляции и переводы строк становятся пробелами.
    const value = this.references(raw.replace(/[\t\n]/g, " "), this.pos + 1);
    this.pos = end + 1;
    return value;
  }

  private resolve(
    scope: ReadonlyMap<string, string>,
    prefix: string,
    isElement: boolean,
    at: number,
  ): string | null {
    if (prefix === "") return isElement ? scope.get("") || null : null;
    const uri = scope.get(prefix);
    if (uri === undefined) {
      throw this.error("syntax", `приставка «${prefix}:» не объявлена`, at);
    }
    return uri;
  }

  /** Открывающий тег с атрибутами; пространства имён разрешаются здесь же. */
  private startTag(
    parentScope: ReadonlyMap<string, string>,
    depth: number,
  ): Open & { selfClosing: boolean } {
    const start = this.pos;
    if (depth >= this.maxDepth) {
      throw this.error(
        "depth",
        `вложенность элементов больше ${this.maxDepth}`,
        start,
      );
    }
    const line = this.lineAt(start);
    this.pos++;
    const qname = this.name();
    const raw: { qname: string; value: string; at: number }[] = [];
    let selfClosing = false;
    for (;;) {
      const spaced = this.skipSpaces() > 0;
      if (this.at("/>")) {
        this.pos += 2;
        selfClosing = true;
        break;
      }
      if (this.at(">")) {
        this.pos++;
        break;
      }
      if (this.pos >= this.s.length) {
        throw this.error("syntax", `тег <${qname}> не закрыт`, start);
      }
      if (!spaced) throw this.error("syntax", "между атрибутами нужен пробел");
      const at = this.pos;
      const name = this.name();
      this.skipSpaces();
      if (this.s[this.pos] !== "=") {
        throw this.error("syntax", `у атрибута ${name} нет значения`);
      }
      this.pos++;
      this.skipSpaces();
      const value = this.attrValue();
      if (raw.some((a) => a.qname === name)) {
        throw this.error("syntax", `атрибут ${name} повторяется`, at);
      }
      raw.push({ qname: name, value, at });
    }

    let own: Map<string, string> | undefined;
    for (const a of raw) {
      if (!isNamespaceDecl(a.qname)) continue;
      const prefix = a.qname === "xmlns" ? "" : a.qname.slice(6);
      const bad =
        prefix === "xmlns" ||
        (prefix === "xml") !== (a.value === XML_NS) ||
        (prefix !== "" && a.value === "");
      if (bad) {
        throw this.error("syntax", `недопустимое объявление ${a.qname}`, a.at);
      }
      own ??= new Map(parentScope);
      own.set(prefix, a.value);
    }
    const scope = own ?? parentScope;

    const [prefix, local] = splitName(qname);
    const ns = this.resolve(scope, prefix, true, start);
    const attrs: XmlAttr[] = [];
    const seen = new Set<string>();
    for (const a of raw) {
      if (isNamespaceDecl(a.qname)) continue;
      const [p, l] = splitName(a.qname);
      const attrNs = this.resolve(scope, p, false, a.at);
      const key = `${attrNs ?? ""} ${l}`;
      if (seen.has(key)) {
        throw this.error("syntax", `атрибут ${a.qname} повторяется`, a.at);
      }
      seen.add(key);
      attrs.push({ ns: attrNs, local: l, qname: a.qname, value: a.value });
    }
    const el: XmlElement = {
      type: "element",
      ns,
      local,
      qname,
      attrs,
      children: [],
      line,
    };
    return { el, scope, selfClosing };
  }

  /** Корень со всем содержимым — стеком, без рекурсии. */
  private elementTree(): XmlElement {
    const rootScope: ReadonlyMap<string, string> = new Map([["xml", XML_NS]]);
    const first = this.startTag(rootScope, 0);
    const stack: Open[] = first.selfClosing ? [] : [first];
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as Open;
      const lt = this.s.indexOf("<", this.pos);
      if (lt === -1) {
        throw this.error("syntax", `тег <${top.el.qname}> не закрыт`);
      }
      if (lt > this.pos) {
        this.text(top.el, this.s.slice(this.pos, lt), this.pos);
        this.pos = lt;
      }
      if (this.at("</")) {
        const at = this.pos;
        this.pos += 2;
        const name = this.name();
        this.skipSpaces();
        if (this.s[this.pos] !== ">")
          throw this.error("syntax", "ожидался «>»");
        this.pos++;
        if (name !== top.el.qname) {
          throw this.error(
            "syntax",
            `закрывающий тег </${name}> не совпадает с <${top.el.qname}>`,
            at,
          );
        }
        stack.pop();
      } else if (this.at("<!--")) {
        this.comment();
      } else if (this.at("<![CDATA[")) {
        const end = this.s.indexOf("]]>", this.pos + 9);
        if (end === -1) throw this.error("syntax", "блок CDATA не закрыт");
        top.el.children.push({
          type: "text",
          text: this.s.slice(this.pos + 9, end),
        });
        this.pos = end + 3;
      } else if (this.at("<?")) {
        this.instruction();
      } else if (this.at("<!")) {
        throw this.error(
          "syntax",
          "объявления <!…> внутри элементов недопустимы",
        );
      } else {
        const child = this.startTag(top.scope, stack.length);
        top.el.children.push(child.el);
        if (!child.selfClosing) stack.push(child);
      }
    }
    return first.el;
  }

  private text(el: XmlElement, raw: string, offset: number): void {
    const cdataEnd = raw.indexOf("]]>");
    if (cdataEnd !== -1) {
      throw this.error("syntax", "«]]>» в тексте", offset + cdataEnd);
    }
    el.children.push({ type: "text", text: this.references(raw, offset) });
  }
}
