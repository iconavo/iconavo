import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { serializeSvg } from "../svg/serialize.js";
import { SVG_NS, XLINK_NS } from "../svg/xml.js";
import { checkSafeSvg } from "./check.js";
import { type Removal, type RemovalKind, sanitizeSvg } from "./sanitize.js";

const FIXTURES = fileURLToPath(
  new URL("../../fixtures/harmful-svg/", import.meta.url),
);
const fixture = (file: string) => readFileSync(`${FIXTURES}${file}`);

const NS = `xmlns="${SVG_NS}"`;
const SQUARE = `<path d="M4 4h16v16H4z"/>`;
const svg = (body: string, attrs = `viewBox="0 0 24 24"`) =>
  `<svg ${NS} ${attrs}>${body}</svg>`;

function kept(input: Uint8Array | string) {
  const r = sanitizeSvg(input);
  if (r.status !== "kept") throw new Error(`иконка исключена: ${r.reason}`);
  return { ...r, out: serializeSvg(r.svg, { xmlns: true }) };
}

function excluded(input: Uint8Array | string) {
  const r = sanitizeSvg(input);
  if (r.status !== "excluded") {
    throw new Error(`иконка не исключена: ${serializeSvg(r.svg)}`);
  }
  return r;
}

const removed = (r: { removals: Removal[] }, kind?: RemovalKind) =>
  Object.fromEntries(
    r.removals
      .filter((x) => kind === undefined || x.kind === kind)
      .map((x) => [x.what, x.count]),
  );

const dangerous = (r: { removals: Removal[] }) =>
  r.removals
    .filter((x) => x.kind === "dangerous")
    .reduce((n, x) => n + x.count, 0);

/** Результат проходит независимую проверку, а повторная очистка ничего не меняет. */
function expectSafeFixedPoint(out: string) {
  expect(checkSafeSvg(out)).toEqual([]);
  const again = kept(out);
  expect(again.removals).toEqual([]);
  expect(again.out).toBe(out);
}

describe("15 вредных SVG", () => {
  const files = readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".svg"))
    .sort();

  it("их ровно 15", () => {
    expect(files).toHaveLength(15);
  });

  it("01: все пять скриптов удалены", () => {
    const r = kept(fixture("01-script.svg"));
    expect(removed(r, "dangerous")).toEqual({ "скрипт <script>": 5 });
    expect(r.out).toBe(svg(`<g/>${SQUARE}`));
  });

  it("02: обработчики в любом регистре удалены", () => {
    const r = kept(fixture("02-event-handlers.svg"));
    expect(removed(r, "dangerous")).toEqual({
      "обработчик ONCLICK": 1,
      "обработчик onBegin": 1,
      "обработчик onclick": 1,
      "обработчик onload": 1,
      "обработчик onmouseover": 1,
    });
    expect(r.out).toBe(svg(`<g>${SQUARE}</g>`));
  });

  it("03: javascript: и data: удалены, ссылка на #dot осталась", () => {
    const r = kept(fixture("03-javascript-urls.svg"));
    expect(removed(r, "dangerous")).toEqual({ "href: опасная ссылка": 4 });
    expect(r.out).toBe(
      svg(
        `<defs><circle id="dot" cx="12" cy="12" r="4"/><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><use href="#dot"/>`,
      ),
    );
  });

  it("04: внешние ресурсы удалены, локальный url(#g) остался", () => {
    const r = kept(fixture("04-external-resources.svg"));
    expect(dangerous(r)).toBe(6);
    expect(removed(r, "dangerous")).toMatchObject({
      "внешний стиль <?xml-stylesheet?>": 1,
      "внешний адрес xml:base": 1,
    });
    expect(r.out).toContain(`fill="url(#g)"`);
    expect(r.out.replace(NS, "")).not.toMatch(/evil|base|https?:|\/\//);
  });

  it("05: картинки удалены, фильтр без feImage остался", () => {
    const r = kept(fixture("05-raster-images.svg"));
    expect(removed(r, "dangerous")).toEqual({
      "картинка <image>": 2,
      "картинка в фильтре <feImage>": 1,
    });
    expect(r.out).toBe(
      svg(
        `<filter id="f"><feOffset dx="1"/></filter><path d="M4 4h16v16H4z" filter="url(#f)"/>`,
      ),
    );
  });

  it("06: HTML и его скрипты удалены", () => {
    const r = kept(fixture("06-html-in-svg.svg"));
    expect(removed(r, "dangerous")).toEqual({
      "HTML-элемент <p>": 1,
      "встроенный HTML <foreignObject>": 1,
      "скрипт <script>": 1,
    });
    expect(r.out).toBe(svg(SQUARE));
  });

  it("07: трюки «прорыва» в HTML не доходят до результата", () => {
    const r = kept(fixture("07-html-breakout.svg"));
    expect(r.out).toBe(svg(`<g/>${SQUARE}`));
    expect(removed(r)).toMatchObject({
      "<desc>": 1,
      комментарии: 2,
      "текст вне элементов": 1,
      "fill: подозрительные символы": 1,
    });
  });

  it("08: экспорт Illustrator — служебное удалено, классы стали атрибутами", () => {
    const r = kept(fixture("08-illustrator-export.svg"));
    expect(r.out).toBe(
      svg(
        `<g><path d="M4,12h16" fill="none" stroke="#000000" stroke-linecap="round" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#FF0000"/></g>`,
      ),
    );
    expect(dangerous(r)).toBe(0);
  });

  it("09: экспорт Inkscape — метаданные удалены, style стал атрибутами", () => {
    const r = kept(fixture("09-inkscape-export.svg"));
    expect(r.out).toBe(
      svg(
        `<g id="layer1"><path d="M 4,4 H 20 V 20 H 4 Z" id="rect1" fill="#000000" fill-opacity="1" stroke="none" stroke-width="0.264583"/></g>`,
        `width="24" height="24" viewBox="0 0 24 24"`,
      ),
    );
    expect(dangerous(r)).toBe(0);
  });

  it.each([
    ["10-xxe.svg", /DTD с внутренними объявлениями/],
    ["11-billion-laughs.svg", /DTD с внутренними объявлениями/],
    ["12-css-import.svg", /CSS не поддерживается: @-правила/],
    ["13-smil-href.svg", /<set> — анимация/],
    ["14-use-bomb.svg", /use-бомба/],
    ["15-unknown-element.svg", /<handler>/],
  ])("%s исключена", (file, reason) => {
    expect(excluded(fixture(file)).reason).toMatch(reason);
  });

  it("«миллиард смехов» отбрасывается мгновенно", () => {
    const started = performance.now();
    excluded(fixture("11-billion-laughs.svg"));
    expect(performance.now() - started).toBeLessThan(200);
  });

  it.each(files)(
    "%s: результат безопасен, повторная очистка ничего не меняет",
    (file) => {
      const r = sanitizeSvg(fixture(file));
      if (r.status === "kept") {
        expectSafeFixedPoint(serializeSvg(r.svg, { xmlns: true }));
      }
    },
  );
});

describe("иконки в стиле пяти наборов", () => {
  const unchanged: [string, string][] = [
    [
      "lucide",
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\r\n  <path d="m3 16 4 4 4-4" />\r\n  <path d="M7 20V4" />\r\n  <circle cx="17" cy="7" r="3" />\r\n  <rect x="14" y="14" width="6" height="6" rx="1" />\r\n  <line x1="2" y1="2" x2="4" y2="4" />\r\n  <polyline points="1 2 3 4" />\r\n</svg>\r\n`,
    ],
    [
      "material-symbols",
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -960 960 960"><path d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Z"/></svg>`,
    ],
    [
      "ph",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,120v96H40V120l88-88Z" opacity="0.2"/><path d="M219.31,108.68l-80-80a16,16,0,0,0-22.62,0Z"/></svg>`,
    ],
    [
      "fluent-emoji-flat",
      `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_1_2)">
<g filter="url(#filter0_i_1_2)">
<path d="M16 2C8.3 2 2 8.3 2 16s6.3 14 14 14 14-6.3 14-14S23.7 2 16 2Z" fill="url(#paint0_radial_1_2)"/>
</g>
<rect x="4" y="4" width="10" height="10" rx="2" transform="rotate(15 9 9)" fill="#FFB02E"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M10 20h12v2H10z" fill="#402A32" opacity="0.8"/>
<ellipse cx="11" cy="14" rx="2" ry="3" fill="white"/>
</g>
<defs>
<filter id="filter0_i_1_2" x="2" y="2" width="28" height="29" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="1"/>
<feGaussianBlur stdDeviation="0.5"/>
<feBlend mode="normal" in2="shape" result="effect1_innerShadow_1_2"/>
</filter>
<radialGradient id="paint0_radial_1_2" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(16 16) rotate(90) scale(14)">
<stop offset="0.5" stop-color="#FFD54F"/>
<stop offset="1" stop-color="#FFB02E" stop-opacity="0.9"/>
</radialGradient>
<linearGradient id="paint1_linear_1_2" x1="0" y1="0" x2="1" y2="1" gradientUnits="userSpaceOnUse"><stop stop-color="#000"/></linearGradient>
<clipPath id="clip0_1_2">
<rect width="32" height="32" fill="white" transform="matrix(1 0 0 1 0 0)"/>
</clipPath>
</defs>
</svg>
`,
    ],
  ];

  it.each(unchanged)("%s: иконка не меняется", (_set, source) => {
    const r = kept(source);
    expect(r.removals).toEqual([]);
    expect(r.changed).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.lost).toEqual([]);
    expect(r.shapes.after).toBe(r.shapes.before);
    expectSafeFixedPoint(r.out);
  });

  it("tabler: удаляется только class корня", () => {
    const r = kept(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-heart"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" /></svg>`,
    );
    expect(r.removals).toEqual([
      { kind: "junk", what: "атрибут class", count: 1 },
    ]);
    expect(r.out).toBe(
      svg(
        `<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"/>`,
        `width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`,
      ),
    );
  });

  it("одинаковый вход — одинаковый результат", () => {
    const source = fixture("08-illustrator-export.svg");
    expect(kept(source).out).toBe(kept(source).out);
  });
});

describe("элементы", () => {
  it.each([
    ["a", `<a href="#x">${SQUARE}</a>`, /<a> — ссылка/],
    ["text", `<text>Привет</text>${SQUARE}`, /<text> — текст и шрифты/],
    ["switch", `<switch>${SQUARE}</switch>`, /<switch> — условная разметка/],
    [
      "animate",
      `<path d="M0 0"><animate attributeName="d"/></path>`,
      /анимация/,
    ],
    ["view", `<view/>${SQUARE}`, /<view> — элемент не нужен иконке/],
    ["вложенный svg", `<svg>${SQUARE}</svg>`, /вложенный <svg>/],
    ["неизвестный", `<foo/>${SQUARE}`, /неизвестный элемент <foo>/],
    ["PATH заглавными", `<PATH d="M0 0"/>`, /неизвестный элемент <PATH>/],
    [
      "clippath строчными",
      `<clippath/>${SQUARE}`,
      /неизвестный элемент <clippath>/,
    ],
    [
      "чужое пространство имён",
      `<x:foo xmlns:x="urn:x"/>${SQUARE}`,
      /неизвестного пространства имён urn:x/,
    ],
    [
      "stop вне градиента",
      `<g><stop/></g>${SQUARE}`,
      /<stop> не может лежать внутри <g>/,
    ],
    [
      "примитив вне filter",
      `<g><feOffset/></g>${SQUARE}`,
      /<feOffset> не может лежать внутри <g>/,
    ],
    [
      "feFuncR прямо в filter",
      `<filter id="f"><feFuncR/></filter>${SQUARE}`,
      /<feFuncR> не может лежать внутри <filter>/,
    ],
    [
      "фигура в filter",
      `<filter id="f">${SQUARE}</filter>`,
      /<filter> не может содержать <path>/,
    ],
    [
      "g в градиенте",
      `<linearGradient id="g"><g/></linearGradient>${SQUARE}`,
      /<linearGradient> не может содержать <g>/,
    ],
    [
      "потомок у фигуры",
      `<path d="M0 0"><g/></path>`,
      /<path> не может содержать <g>/,
    ],
  ])("%s — иконка исключена", (_name, body, reason) => {
    expect(excluded(svg(body)).reason).toMatch(reason);
  });

  it("корень — не <svg> или <svg> не из SVG: иконка исключена", () => {
    expect(excluded(`<g ${NS}>${SQUARE}</g>`).reason).toMatch(
      /корневой элемент — <g>/,
    );
    expect(
      excluded(`<svg xmlns="http://www.w3.org/1999/xhtml">${SQUARE}</svg>`)
        .reason,
    ).toMatch(/корневой элемент/);
  });

  it("корень без xmlns — иконка не меняется, xmlns появляется в результате", () => {
    const r = kept(`<svg viewBox="0 0 24 24">${SQUARE}</svg>`);
    expect(r.changed).toBe(false);
    expect(r.out).toBe(svg(SQUARE));
  });

  it("приставка к пространству SVG снимается", () => {
    const r = kept(
      `<s:svg xmlns:s="${SVG_NS}" viewBox="0 0 24 24"><s:path d="M4 4h16v16H4z"/></s:svg>`,
    );
    expect(r.out).toBe(svg(SQUARE));
  });

  it("title, desc, metadata и элементы редакторов удаляются как лишнее", () => {
    const r = kept(
      svg(
        `<title>Т</title><desc>Д</desc><metadata><x/></metadata><sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"/><i:pgf xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/"/>${SQUARE}`,
      ),
    );
    expect(removed(r, "junk")).toEqual({
      "<desc>": 1,
      "<metadata>": 1,
      "<title>": 1,
      "метаданные редактора <i:pgf>": 1,
      "метаданные редактора <sodipodi:namedview>": 1,
    });
    expect(r.out).toBe(svg(SQUARE));
  });

  it("после очистки не осталось видимых фигур — иконка исключена", () => {
    expect(excluded(svg(`<image href="#a"/>`)).reason).toMatch(
      /не осталось фигур/,
    );
    expect(excluded(svg(`<defs>${SQUARE}</defs>`)).reason).toMatch(
      /не осталось фигур/,
    );
  });
});

describe("атрибуты", () => {
  it("служебные атрибуты корня удаляются, оформление остаётся", () => {
    const r = kept(
      `<svg ${NS} id="s" x="0" y="0" version="1.1" overflow="visible" class="icon" data-x="1" aria-hidden="true" role="img" focusable="false" viewBox="0 0 24 24" fill="none">${SQUARE}</svg>`,
    );
    expect(r.out).toBe(svg(SQUARE, `viewBox="0 0 24 24" fill="none"`));
    expect(r.removals.every((x) => x.kind === "junk")).toBe(true);
  });

  it("xlink:href становится href; если есть оба — побеждает href", () => {
    const defs = `<defs><path id="a" d="M0 0"/><path id="b" d="M1 1"/></defs>`;
    const r = kept(
      `<svg ${NS} xmlns:xlink="${XLINK_NS}">${defs}<use xlink:href="#a"/><use xlink:href="#b" href="#a"/></svg>`,
    );
    expect(r.out).toContain(`<use href="#a"/><use href="#a"/>`);
    expect(removed(r, "junk")).toEqual({ "xlink:href рядом с href": 1 });
  });

  it("обработчик из XML Events удаляется как опасное", () => {
    const r = kept(
      svg(
        `<path xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="click" d="M0 0"/>`,
      ),
    );
    expect(removed(r, "dangerous")).toEqual({ "обработчик ev:event": 1 });
  });

  it("неизвестный атрибут удаляется и попадает в отчёт", () => {
    const r = kept(
      svg(`<path d="M0 0" foo="1" shape-rendering="crispEdges"/>`),
    );
    expect(removed(r, "unknown")).toEqual({
      "foo у <path>": 1,
      "shape-rendering у <path>": 1,
    });
    expect(r.lost).toEqual([]);
  });

  it("атрибут оформления на элементе, где он не разрешён, — в списке потерь", () => {
    const r = kept(
      svg(`<filter id="f" fill="red"><feOffset/></filter>${SQUARE}`),
    );
    expect(r.lost).toEqual(["<filter> fill"]);
  });
});

describe("значения", () => {
  /** Кавычки вокруг значения — те, которых в нём нет. */
  const withFill = (value: string) => {
    const quoted = value.includes("'") ? `"${value}"` : `'${value}'`;
    return svg(
      `<defs><linearGradient id="a"><stop/></linearGradient></defs><path d="M0 0" fill=${quoted}/>`,
    );
  };

  it.each([
    ["url(#a)", "url(#a)"],
    [`url('#a')`, "url(#a)"],
    [` URL( "#a" ) `, "url(#a)"],
    ["url(#a) red", "url(#a) red"],
    ["rgb(0, 0, 0)", "rgb(0, 0, 0)"],
    ["currentColor", "currentColor"],
  ])("fill=%j остаётся как %j", (value, expected) => {
    const r = kept(withFill(value));
    expect(r.out).toContain(`fill="${expected}"`);
  });

  it.each([
    ["url(https://evil.example/p.svg#p)", "dangerous"],
    ["url(data:image/svg+xml,x)", "dangerous"],
    ["url(#a) url(#a)", "dangerous"],
    ["image-set(x 1x)", "dangerous"],
    ["paint(worklet)", "dangerous"],
    ["u\\72 l(https://evil.example/)", "dangerous"],
    ["re&#9;d", "dangerous"],
    ["red&lt;", "dangerous"],
    ["var(--brand)", "unknown"],
    ["color-mix(in srgb, red, blue)", "unknown"],
  ])("fill=%j удаляется (%s)", (value, kind) => {
    const r = kept(withFill(value));
    expect(r.out).not.toContain("fill=");
    expect(
      r.removals.some((x) => x.kind === kind && x.what.startsWith("fill:")),
    ).toBe(true);
    expect(r.lost).toEqual(["<path> fill"]);
  });

  it.each([
    ["clip-path", "url(#a) red", "unknown"],
    ["opacity", "url(#a)", "dangerous"],
    ["transform", "rotate(45) foo(1)", "unknown"],
    ["transform", "expression(alert(1))", "dangerous"],
  ])("%s=%j удаляется (%s)", (name, value, kind) => {
    const r = kept(svg(`<path d="M0 0" ${name}="${value}"/>`));
    expect(r.out).not.toContain(`${name}=`);
    expect(r.removals.some((x) => x.kind === kind)).toBe(true);
  });

  it("transform с разрешёнными функциями остаётся", () => {
    const r = kept(
      svg(
        `<path d="M0 0" transform="translate(1 2) rotate(45) scale(2) skewX(10) matrix(1 0 0 1 0 0)"/>`,
      ),
    );
    expect(r.changed).toBe(false);
  });

  it("href: только #id, пробелы по краям убираются", () => {
    const defs = `<defs><path id="a" d="M0 0"/></defs>`;
    expect(kept(svg(`${defs}<use href=" #a "/>`)).out).toContain(
      `<use href="#a"/>`,
    );
    const r = kept(svg(`${defs}<use href="a.svg#a"/>${SQUARE}`));
    expect(removed(r, "dangerous")).toEqual({ "href: внешняя ссылка": 1 });
    expect(removed(r, "junk")).toEqual({ "<use> без ссылки": 1 });
  });

  it("id с «metadata:» — не опасная ссылка", () => {
    expect(kept(svg(`<g id="metadata:1">${SQUARE}</g>`)).changed).toBe(false);
  });
});

describe("стили в атрибуты", () => {
  it("таблица сильнее атрибута оформления: значение меняется на месте", () => {
    const r = kept(
      svg(
        `<style>.a { fill: red }</style><path fill="blue" class="a" d="M0 0"/>`,
      ),
    );
    expect(r.out).toBe(svg(`<path fill="red" d="M0 0"/>`));
  });

  it("новые атрибуты добавляются по алфавиту", () => {
    const r = kept(
      svg(`<path d="M0 0" style="stroke-width: 2; fill: red; opacity: .5"/>`),
    );
    expect(r.out).toBe(
      svg(`<path d="M0 0" fill="red" opacity=".5" stroke-width="2"/>`),
    );
  });

  it("свойство, которое не действует на элемент, отбрасывается", () => {
    const r = kept(svg(`<path d="M0 0" style="stop-color: red; fill: blue"/>`));
    expect(r.out).toBe(svg(`<path d="M0 0" fill="blue"/>`));
    expect(removed(r, "junk")).toEqual({
      "CSS stop-color не действует на <path>": 1,
    });
  });

  it("неизвестное свойство отбрасывается и попадает в отчёт", () => {
    const r = kept(svg(`<path d="M0 0" style="zoom: 2"/>`));
    expect(removed(r, "unknown")).toEqual({ "CSS zoom": 1 });
  });

  it("CSS-эффекты, которых нет в атрибутах, исключают иконку", () => {
    expect(
      excluded(svg(`<path d="M0 0" style="transform: rotate(45deg)"/>`)).reason,
    ).toMatch(/CSS-свойство transform/);
    expect(
      excluded(svg(`<style>path { mix-blend-mode: multiply }</style>${SQUARE}`))
        .reason,
    ).toMatch(/mix-blend-mode/);
  });

  it("внешний url() в CSS удаляется как опасное", () => {
    const r = kept(
      svg(`<path d="M0 0" style="fill: url(https://evil.example/p)"/>`),
    );
    expect(removed(r, "dangerous")).toEqual({
      "CSS fill: внешняя ссылка в url()": 1,
    });
  });

  it.each([
    ["media", `<style media="print">.a{fill:red}</style>`, /media/],
    ["type", `<style type="text/less">.a{fill:red}</style>`, /text\/less/],
    ["элемент внутри", `<style><g/></style>`, /внутри <style>/],
    [
      "ошибка в style",
      `<path d="M0 0" style="fill red"/>`,
      /CSS не поддерживается/,
    ],
  ])("<style> с %s — иконка исключена", (_name, body, reason) => {
    expect(excluded(svg(`${body}${SQUARE}`)).reason).toMatch(reason);
  });
});

describe("ссылки между элементами", () => {
  it("use на своего предка — цикл, иконка исключена", () => {
    expect(excluded(svg(`<g id="a"><use href="#a"/></g>`)).reason).toMatch(
      /по кругу/,
    );
  });

  it("градиенты ссылаются друг на друга — цикл", () => {
    const body = `<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs><path d="M0 0" fill="url(#a)"/>`;
    expect(excluded(svg(body)).reason).toMatch(/по кругу/);
  });

  it("clipPath внутри группы, которую он обрезает, — не цикл", () => {
    const body = `<g clip-path="url(#c)"><clipPath id="c"><rect width="1" height="1"/></clipPath>${SQUARE}</g>`;
    expect(kept(svg(body)).warnings).toEqual([]);
  });

  it("ссылка в никуда и повтор id — предупреждения", () => {
    const r = kept(
      svg(
        `<g id="x">${SQUARE}</g><g id="x"><path d="M0 0" fill="url(#nope)"/></g>`,
      ),
    );
    expect(r.warnings.sort()).toEqual([
      "id «x» повторяется",
      "ссылка на несуществующий #nope",
    ]);
  });

  it("лимит раскрытия <use> настраивается", () => {
    const body = `<defs><path id="p" d="M0 0"/></defs>${'<use href="#p"/>'.repeat(10)}`;
    expect(sanitizeSvg(svg(body)).status).toBe("kept");
    expect(sanitizeSvg(svg(body), { maxExpanded: 15 }).status).toBe("excluded");
  });
});

describe("лимиты и кодировка", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it("файл больше 512 КБ исключается до разбора", () => {
    const big = encode(svg(`<path d="${"M0 0 ".repeat(110_000)}"/>`));
    expect(big.length).toBeGreaterThan(512 * 1024);
    expect(excluded(big).reason).toMatch(/больше 512 КБ/);
  });

  it("вложенность больше 64 — исключается, 60 — норма", () => {
    const nested = (n: number) =>
      svg(`${"<g>".repeat(n)}${SQUARE}${"</g>".repeat(n)}`);
    expect(excluded(nested(70)).reason).toMatch(/вложенность/);
    expect(kept(nested(60)).changed).toBe(false);
  });

  it("не UTF-8 и UTF-16 исключаются, UTF-8 с BOM — норма", () => {
    const bytes = encode(svg(`<path d="M0 0"/>`));
    expect(
      excluded(
        Uint8Array.from([
          ...bytes.slice(0, 10),
          0xc3,
          0x28,
          ...bytes.slice(10),
        ]),
      ).reason,
    ).toMatch(/UTF-8/);
    expect(excluded(Uint8Array.from([0xff, 0xfe, ...bytes])).reason).toMatch(
      /UTF-16/,
    );
    expect(kept(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes])).changed).toBe(
      false,
    );
  });

  it("ошибка XML называет строку и позицию", () => {
    expect(excluded(`<svg ${NS}>\n<g></svg>`).reason).toMatch(
      /^XML не читается: .*\(строка 2, позиция 4\)$/,
    );
  });
});

describe("независимая проверка результата", () => {
  it.each([
    [`<svg ${NS}><script/></svg>`],
    [`<svg ${NS}><path onclick="x" d="M0 0"/></svg>`],
    [`<svg ${NS}><use href="https://evil.example/x"/></svg>`],
    [`<svg ${NS}><path style="fill:red" d="M0 0"/></svg>`],
    [`<svg ${NS}><!-- x --><path d="M0 0"/></svg>`],
    [`<svg ${NS}><foo/></svg>`],
    [`<svg ${NS}>текст</svg>`],
    [`<svg ${NS}><path fill="url(x.svg#a)" d="M0 0"/></svg>`],
    [`<svg ${NS} xmlns:x="${XLINK_NS}"><use x:href="#a"/></svg>`],
    [`<svg ${NS}><svg/></svg>`],
  ])("находит проблему: %s", (text) => {
    expect(checkSafeSvg(text).length).toBeGreaterThan(0);
  });

  it("чистый результат — без проблем", () => {
    expect(checkSafeSvg(svg(SQUARE))).toEqual([]);
  });
});
