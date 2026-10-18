import { describe, expect, it } from "vitest";
import {
  CssError,
  cascade,
  cssOnlyReason,
  isJunkProperty,
  parseDeclarations,
  parseStyleSheet,
} from "./css.js";

describe("объявления CSS", () => {
  it("свойство, значение, !important; «;» внутри кавычек и скобок не делит", () => {
    expect(
      parseDeclarations(
        `FILL: red; stroke:url("#a;b") !important; font-family: "a;b" ;;`,
      ),
    ).toEqual([
      { property: "fill", value: "red", important: false },
      { property: "stroke", value: `url("#a;b")`, important: true },
      { property: "font-family", value: `"a;b"`, important: false },
    ]);
  });

  it("комментарии убираются", () => {
    expect(parseDeclarations("fill:/* цвет */red")).toEqual([
      { property: "fill", value: "red", important: false },
    ]);
  });

  it.each([
    ["нет двоеточия", "fill red"],
    ["переменная CSS", "--brand: red"],
    ["экранирование", "fill: \\72 ed"],
    ["фигурные скобки", "fill: {red}"],
    ["пустое значение", "fill:"],
    ["незакрытый комментарий", "fill: red /*"],
    ["незакрытая строка", `font-family: "a`],
    ["разметка <!--", "<!-- fill: red -->"],
  ])("ошибка: %s", (_name, text) => {
    expect(() => parseDeclarations(text)).toThrow(CssError);
  });
});

describe("таблица стилей", () => {
  it("селекторы: тег, классы, id, списки; специфичность", () => {
    const [rule] = parseStyleSheet(
      "path.a#b, .c.d , g { fill: red } .e{stroke:blue}",
    );
    expect(rule?.selectors).toEqual([
      { tag: "path", classes: ["a"], id: "b", specificity: 10101 },
      { tag: null, classes: ["c", "d"], id: null, specificity: 200 },
      { tag: "g", classes: [], id: null, specificity: 1 },
    ]);
    expect(parseStyleSheet(".a{}")).toEqual([
      {
        selectors: [{ tag: null, classes: ["a"], id: null, specificity: 100 }],
        declarations: [],
      },
    ]);
  });

  it.each([
    ["@import", "@import url(x.css); .a { fill: red }"],
    ["@media", "@media print { .a { fill: red } }"],
    ["@keyframes", "@keyframes spin { to { opacity: 0 } }"],
    ["потомок", "g path { fill: red }"],
    ["дочерний", "g > path { fill: red }"],
    ["псевдокласс", "path:hover { fill: red }"],
    ["селектор атрибута", "[fill] { fill: red }"],
    ["звёздочка", "* { fill: red }"],
    ["пространство имён", "svg|path { fill: red }"],
    ["два id", "#a#b { fill: red }"],
    ["пустой селектор", ", .a { fill: red }"],
    ["вложенный блок", ".a { .b { fill: red } }"],
    ["незакрытый блок", ".a { fill: red"],
    ["лишняя скобка", ".a { fill: red } }"],
    ["мусор без блока", ".a"],
    ["экранирование", ".a\\:b { fill: red }"],
  ])("не поддерживается: %s", (_name, text) => {
    expect(() => parseStyleSheet(text)).toThrow(CssError);
  });
});

describe("каскад", () => {
  const rules = parseStyleSheet(
    "path { fill: blue } .a { fill: green } #p { fill: red } .b { stroke: black } .c { stroke: white !important }",
  );
  const el = (classes: string[], id?: string) => ({
    tag: "path",
    classes: new Set(classes),
    id,
  });

  it("id сильнее класса, класс сильнее тега", () => {
    expect(cascade(rules, [], el(["a"], "p")).get("fill")).toBe("red");
    expect(cascade(rules, [], el(["a"])).get("fill")).toBe("green");
    expect(cascade(rules, [], el([])).get("fill")).toBe("blue");
  });

  it("при равной специфичности побеждает последнее правило", () => {
    const r = parseStyleSheet(".a { fill: red } .b { fill: blue }");
    expect(cascade(r, [], el(["b", "a"])).get("fill")).toBe("blue");
  });

  it("у списка селекторов считается самая сильная подходящая часть", () => {
    const r = parseStyleSheet("#p, g { fill: red } .a { fill: blue }");
    expect(cascade(r, [], el(["a"], "p")).get("fill")).toBe("red");
  });

  it("inline сильнее таблицы, но слабее !important таблицы", () => {
    const inline = parseDeclarations("fill: yellow; stroke: gray");
    const result = cascade(rules, inline, el(["a", "b", "c"], "p"));
    expect(result.get("fill")).toBe("yellow");
    expect(result.get("stroke")).toBe("white");
  });

  it("inline !important сильнее !important таблицы", () => {
    const inline = parseDeclarations("stroke: gray !important");
    expect(cascade(rules, inline, el(["c"])).get("stroke")).toBe("gray");
  });

  it("регистр классов и тегов важен, как в XML", () => {
    const r = parseStyleSheet(".A { fill: red } Path { stroke: red }");
    expect(cascade(r, [], el(["a"])).size).toBe(0);
  });
});

describe("что переносится в атрибуты", () => {
  it.each([
    ["transform", "rotate(45deg)"],
    ["transform-origin", "center"],
    ["animation", "spin 1s infinite"],
    ["transition-duration", "1s"],
    ["mix-blend-mode", "multiply"],
    ["isolation", "isolate"],
    ["fill", "var(--brand)"],
    ["clip-path", "circle(50%)"],
    ["filter", "blur(2px)"],
    ["mask", "linear-gradient(red, blue)"],
  ])("%s: %s — есть только в CSS", (property, value) => {
    expect(cssOnlyReason(property, value)).not.toBeNull();
  });

  it.each([
    ["fill", "red"],
    ["clip-path", "url(#c)"],
    ["filter", "none"],
    ["mix-blend-mode", "normal"],
    ["isolation", "auto"],
  ])("%s: %s — переносится", (property, value) => {
    expect(cssOnlyReason(property, value)).toBeNull();
  });

  it.each([
    ["-inkscape-stroke", "none"],
    ["font-family", "Arial"],
    ["font", "12px Arial"],
    ["text-anchor", "middle"],
    ["line-height", "1.25"],
    ["enable-background", "new"],
    ["overflow", "visible"],
    ["mix-blend-mode", "normal"],
  ])("мусор из редакторов: %s", (property, value) => {
    expect(isJunkProperty(property, value)).toBe(true);
  });

  it("свойства оформления — не мусор", () => {
    expect(isJunkProperty("fill", "red")).toBe(false);
    expect(isJunkProperty("stroke-width", "2")).toBe(false);
  });
});
