import { describe, expect, it } from "vitest";
import { serializeSvg } from "./serialize.js";
import {
  decodeSvg,
  parseXml,
  SVG_NS,
  XLINK_NS,
  XML_NS,
  type XmlElement,
  XmlParseError,
} from "./xml.js";

const NS = `xmlns="${SVG_NS}"`;
/** Первый дочерний элемент (текст между тегами пропускается). */
const first = (el: XmlElement) =>
  el.children.find((c) => c.type === "element") as XmlElement;
const encode = (text: string) => new TextEncoder().encode(text);

/** Ошибка разбора, которую бросает fn; если не бросает — тест падает. */
function failure(fn: () => unknown): XmlParseError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(XmlParseError);
    return e as XmlParseError;
  }
  throw new Error("ожидалась ошибка разбора");
}

describe("разбор XML", () => {
  it("элементы, атрибуты по порядку и пространства имён", () => {
    const doc = parseXml(
      `<svg ${NS} xmlns:x="${XLINK_NS}" viewBox="0 0 24 24" fill="none"><g><use x:href="#a"/></g></svg>`,
    );
    expect(doc.root).toMatchObject({ ns: SVG_NS, local: "svg", qname: "svg" });
    expect(doc.root.attrs).toEqual([
      { ns: null, local: "viewBox", qname: "viewBox", value: "0 0 24 24" },
      { ns: null, local: "fill", qname: "fill", value: "none" },
    ]);
    const use = first(first(doc.root));
    expect(use).toMatchObject({ ns: SVG_NS, local: "use" });
    expect(use.attrs).toEqual([
      { ns: XLINK_NS, local: "href", qname: "x:href", value: "#a" },
    ]);
  });

  it("приставка к пространству SVG — тот же элемент SVG", () => {
    const doc = parseXml(
      `<s:svg xmlns:s="${SVG_NS}"><s:path d="M0 0"/></s:svg>`,
    );
    expect(doc.root).toMatchObject({ ns: SVG_NS, local: "svg" });
    expect(first(doc.root)).toMatchObject({ ns: SVG_NS, local: "path" });
  });

  it("без xmlns элемент без пространства имён, приставка xml: объявлена заранее", () => {
    const doc = parseXml(`<svg xml:space="preserve"/>`);
    expect(doc.root.ns).toBeNull();
    expect(doc.root.attrs[0]).toMatchObject({ ns: XML_NS, local: "space" });
  });

  it("переводы строк CRLF и нормализация значений атрибутов", () => {
    const doc = parseXml(`<svg ${NS}\r\n  d="a\r\nb\tc"\r>x&#10;y</svg>`);
    expect(doc.root.attrs[0]?.value).toBe("a b c");
    expect(doc.root.children).toEqual([{ type: "text", text: "x\ny" }]);
  });

  it("стандартные и числовые ссылки на символы, CDATA", () => {
    const doc = parseXml(
      `<svg ${NS} a="&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&#x1F600;"><![CDATA[<b>&amp;]]></svg>`,
    );
    expect(doc.root.attrs[0]?.value).toBe(`<>&"'AB😀`);
    expect(doc.root.children).toEqual([{ type: "text", text: "<b>&amp;" }]);
  });

  it("считает комментарии, DOCTYPE без объявлений и инструкции", () => {
    const doc = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?><!-- a --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><?xml-stylesheet href="x.css"?><svg ${NS}><!-- b --></svg><!-- c -->`,
    );
    expect(doc).toMatchObject({
      doctype: true,
      comments: 3,
      instructions: ["xml-stylesheet"],
    });
  });

  it("BOM в начале строки пропускается", () => {
    expect(parseXml(`﻿<svg ${NS}/>`).root.local).toBe("svg");
  });

  it("номер строки у элементов и в ошибках", () => {
    const doc = parseXml(`<svg ${NS}>\n  <g>\n    <path/>\n  </g>\n</svg>`);
    expect(first(first(doc.root)).line).toBe(3);
    expect(() => parseXml(`<svg ${NS}>\n  <g></svg>`)).toThrow(
      /не совпадает с <g> \(строка 2, позиция 6\)/,
    );
  });

  it("разбор без рекурсии: 50 000 уровней не переполняют стек", () => {
    const deep = `<svg ${NS}>${"<g>".repeat(50_000)}${"</g>".repeat(50_000)}</svg>`;
    expect(parseXml(deep, { maxDepth: 60_000 }).root.local).toBe("svg");
  });

  it.each([
    ["несовпадающие теги", `<svg ${NS}><g></svg>`, "syntax", /не совпадает/],
    ["незакрытый тег", `<svg ${NS}><g>`, "syntax", /не закрыт/],
    ["два корня", `<svg ${NS}/><svg ${NS}/>`, "syntax", /лишнее содержимое/],
    ["текст после корня", `<svg ${NS}/>x`, "syntax", /лишнее содержимое/],
    ["нет корня", `<!-- пусто -->`, "syntax", /нет корневого элемента/],
    ["значение без кавычек", `<svg ${NS} a=1/>`, "syntax", /в кавычках/],
    ["повтор атрибута", `<svg ${NS} a="1" a="2"/>`, "syntax", /повторяется/],
    [
      "повтор через разные приставки",
      `<svg ${NS} xmlns:p="${XLINK_NS}" xmlns:q="${XLINK_NS}" p:href="#a" q:href="#b"/>`,
      "syntax",
      /повторяется/,
    ],
    [
      "нет пробела между атрибутами",
      `<svg ${NS} a="1"b="2"/>`,
      "syntax",
      /пробел/,
    ],
    ["«<» в значении", `<svg ${NS} a="<"/>`, "syntax", /«<»/],
    ["«--» в комментарии", `<!-- a -- b --><svg ${NS}/>`, "syntax", /«--»/],
    ["«]]>» в тексте", `<svg ${NS}>]]></svg>`, "syntax", /]]>/],
    [
      "неизвестная сущность",
      `<svg ${NS}>&nbsp;</svg>`,
      "entity",
      /неизвестная сущность &nbsp;/,
    ],
    ["одиночный &", `<svg ${NS} a="x & y"/>`, "entity", /одиночный/],
    ["символ &#0;", `<svg ${NS} a="&#0;"/>`, "entity", /недопустимый символ/],
    [
      "суррогат &#xD800;",
      `<svg ${NS} a="&#xD800;"/>`,
      "entity",
      /недопустимый символ/,
    ],
    [
      "необъявленная приставка",
      `<svg ${NS}><x:path/></svg>`,
      "syntax",
      /не объявлена/,
    ],
    [
      "пустое xmlns:p",
      `<svg ${NS} xmlns:p=""/>`,
      "syntax",
      /недопустимое объявление/,
    ],
    [
      "DTD с объявлениями",
      `<!DOCTYPE svg [<!ENTITY a "b">]><svg ${NS}>&a;</svg>`,
      "dtd",
      /DTD с внутренними объявлениями/,
    ],
    [
      "второй DOCTYPE",
      `<!DOCTYPE svg><!DOCTYPE svg><svg ${NS}/>`,
      "syntax",
      /второй DOCTYPE/,
    ],
    [
      "<!ENTITY внутри элемента",
      `<svg ${NS}><!ENTITY a "b"></svg>`,
      "syntax",
      /объявления/,
    ],
    [
      "<?xml?> не в начале",
      ` <?xml version="1.0"?><svg ${NS}/>`,
      "syntax",
      /в самом начале/,
    ],
    [
      "кодировка не UTF-8",
      `<?xml version="1.0" encoding="windows-1251"?><svg ${NS}/>`,
      "encoding",
      /windows-1251/,
    ],
    [
      "XML 1.1",
      `<?xml version="1.1"?><svg ${NS}/>`,
      "syntax",
      /неверное объявление/,
    ],
    ["управляющий символ", `<svg ${NS}>\u0001</svg>`, "syntax", /U\+0001/],
    [
      "вложенность больше 64",
      `<svg ${NS}>${"<g>".repeat(64)}${"</g>".repeat(64)}</svg>`,
      "depth",
      /вложенность элементов больше 64/,
    ],
  ])("ошибка: %s", (_name, text, code, message) => {
    const error = failure(() => parseXml(text));
    expect(error.code).toBe(code);
    expect(error.message).toMatch(message);
  });

  it("вложенность ровно 64 — норма", () => {
    const text = `<svg ${NS}>${"<g>".repeat(63)}${"</g>".repeat(63)}</svg>`;
    expect(parseXml(text).root.local).toBe("svg");
  });
});

describe("байты файла", () => {
  it("UTF-8 с BOM и без", () => {
    expect(
      decodeSvg(Uint8Array.from([0xef, 0xbb, 0xbf, ...encode("<svg/>")])),
    ).toBe("<svg/>");
    expect(decodeSvg(encode("<svg>ё</svg>"))).toBe("<svg>ё</svg>");
  });

  it.each([
    ["UTF-16", Uint8Array.from([0xff, 0xfe, 0x3c, 0x00]), "encoding"],
    ["битый UTF-8", Uint8Array.from([0x3c, 0xc3, 0x28, 0x3e]), "encoding"],
    ["больше лимита", new Uint8Array(1025), "size"],
  ])("ошибка: %s", (_name, bytes, code) => {
    expect(failure(() => decodeSvg(bytes, 1024)).code).toBe(code);
  });
});

describe("запись SVG", () => {
  it("экранирует значения, xmlns только у корня по запросу", () => {
    const el = {
      tag: "svg",
      attrs: { viewBox: "0 0 24 24" },
      children: [
        { tag: "path", attrs: { d: `a"<b>&c` }, children: [] },
        { tag: "g", attrs: {}, children: [] },
      ],
    };
    expect(serializeSvg(el, { xmlns: true })).toBe(
      `<svg ${NS} viewBox="0 0 24 24"><path d="a&quot;&lt;b&gt;&amp;c"/><g/></svg>`,
    );
    expect(serializeSvg(el)).toMatch(/^<svg viewBox/);
  });
});
