import type { IconSetSummary } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import type { Install } from "./install.js";
import { lookCode, normalizeColor, setupFor } from "./look.js";
import {
  cardName,
  PICKER_FORMAT,
  type PickerIcon,
  type PickerPayload,
  parsePickerPayload,
  pickerChoice,
  pickerContextText,
  pickerHasColor,
  pickerMessage,
  pickerPayload,
  pickerStyles,
} from "./picker.js";

const INSTALL: Install = {
  script: '<script type="module" src="https://cdn.example/x.js"></script>',
  tag: { package: "@iconavo-ui/icon", import: 'import "@iconavo-ui/icon";' },
  react: {
    package: "@iconavo-ui/react",
    import: 'import { Icon } from "@iconavo-ui/react";',
  },
};

const LINE: PickerIcon = {
  body: '<path fill="none" stroke="currentColor" d="M1 1h4"/>',
  left: 0,
  top: 0,
  width: 24,
  height: 24,
};
const FILL: PickerIcon = {
  ...LINE,
  body: '<path fill="currentColor" d="M0 0h4"/>',
};
const EMOJI: PickerIcon = {
  body: '<path fill="#f00" d="M0 0h4"/>',
  left: 0,
  top: 0,
  width: 32,
  height: 32,
};

const DEMO: IconSetSummary = {
  prefix: "demo",
  name: "Demo",
  author: { name: "Demo Authors" },
  license: { title: "ISC", spdx: "ISC" },
  palette: false,
};
const EMOJIS: IconSetSummary = {
  prefix: "emo",
  name: "Emoji",
  author: { name: "Emoji Authors" },
  license: { title: "MIT", spdx: "MIT" },
  palette: true,
};

function payload(over: Partial<PickerPayload> = {}): PickerPayload {
  return {
    ...pickerPayload({
      query: "house",
      api: "https://api.example",
      site: "https://site.example",
      format: "html",
      size: 24,
      cards: [
        {
          n: 1,
          icon: "demo:house",
          style: "outline",
          styles: { outline: "demo:house", filled: "demo:house-fill" },
        },
        {
          n: 2,
          icon: "emo:house",
          style: "color",
          styles: { color: "emo:house" },
        },
      ],
      icons: new Map([
        ["demo:house", LINE],
        ["demo:house-fill", FILL],
        ["emo:house", EMOJI],
      ]),
      sets: [DEMO, EMOJIS],
      install: INSTALL,
    }),
    ...over,
  };
}

describe("данные сетки", () => {
  it("стили и карточки без рисунка выпадают, рисунки и наборы — только нужные", () => {
    const p = pickerPayload({
      query: "q",
      api: "a",
      site: "s",
      format: "html",
      size: 24,
      cards: [
        {
          n: 1,
          icon: "demo:a",
          style: "outline",
          styles: { outline: "demo:a", filled: "demo:a-fill" },
        },
        { n: 2, icon: "demo:lost", style: null, styles: {} },
      ],
      icons: new Map([
        ["demo:a", LINE],
        ["demo:unused", FILL],
      ]),
      sets: [DEMO, EMOJIS],
      install: INSTALL,
    });
    expect(p.v).toBe(PICKER_FORMAT);
    expect(p.cards).toEqual([
      { n: 1, icon: "demo:a", style: "outline", styles: { outline: "demo:a" } },
    ]);
    expect(Object.keys(p.icons)).toEqual(["demo:a"]);
    expect(p.sets).toEqual([DEMO]);
  });

  it("разбор: свои данные — те же; чужой формат, нет полей, не та версия — undefined", () => {
    const p = payload();
    expect(parsePickerPayload(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parsePickerPayload(undefined)).toBeUndefined();
    expect(parsePickerPayload({ ...p, v: 2 })).toBeUndefined();
    expect(parsePickerPayload({ ...p, format: "vue" })).toBeUndefined();
    expect(
      parsePickerPayload({ ...p, icons: { "demo:house": { body: 1 } } }),
    ).toBeUndefined();
    expect(
      parsePickerPayload({
        ...p,
        cards: [{ n: 1, icon: "demo:house", style: "bold", styles: {} }],
      }),
    ).toBeUndefined();
  });

  it("разбор: карточка без рисунка или без набора не показывается", () => {
    const p = payload();
    const parsed = parsePickerPayload({
      ...p,
      cards: [...p.cards, { n: 3, icon: "nope:x", style: null, styles: {} }],
    });
    expect(parsed?.cards.map((c) => c.n)).toEqual([1, 2]);
  });

  it("стили переключателя — «Любой» и те, что есть у карточек, по шкале", () => {
    expect(pickerStyles(payload())).toEqual([
      "any",
      "outline",
      "filled",
      "color",
    ]);
    const [house, emoji] = payload().cards;
    if (house === undefined || emoji === undefined) throw new Error("карточки");
    expect(cardName(payload(), house, "filled")).toBe("demo:house-fill");
    expect(cardName(payload(), emoji, "filled")).toBeUndefined();
    expect(pickerHasColor(payload())).toBe(true);
    expect(pickerHasColor(payload({ sets: [EMOJIS] }))).toBe(false);
  });
});

describe("выбор", () => {
  it("код — функциями get_icon: тег, React, SVG с адресом edge API", () => {
    const [house] = payload().cards;
    if (house === undefined) throw new Error("карточка");
    const html = pickerChoice(payload(), house, "filled", "#E11D48");
    expect(html?.code).toBe(
      '<iconavo-icon icon="demo:house-fill" width="24" color="#e11d48"></iconavo-icon>',
    );
    expect(html?.setup).toEqual(setupFor("html", INSTALL));
    expect(html?.style).toBe("filled");
    const react = pickerChoice(
      payload({ format: "react" }),
      house,
      "any",
      undefined,
    );
    expect(react?.code).toBe(
      lookCode(
        "https://api.example",
        "react",
        "demo:house",
        { size: 24, rotate: 0, hflip: false, vflip: false },
        { palette: false, strokes: false },
        INSTALL,
      ).code,
    );
    const svg = pickerChoice(
      payload({ format: "svg" }),
      house,
      "any",
      "#e11d48",
    );
    expect(svg?.code).toMatch(/^<!-- demo:house\. Icons: Demo by Demo Authors/);
    expect(svg?.svgUrl).toBe(
      "https://api.example/demo/house.svg?width=24&color=e11d48",
    );
    expect(svg?.setup).toBeUndefined();
    expect(svg?.page).toBe("https://site.example/demo/house");
  });

  it("цвет у цветного набора не применяется — заметка, как у get_icon; нет стиля — нет выбора", () => {
    const emoji = payload().cards[1];
    if (emoji === undefined) throw new Error("карточка");
    const choice = pickerChoice(
      payload(),
      emoji,
      "any",
      normalizeColor("#abc"),
    );
    expect(choice?.color).toBeUndefined();
    expect(choice?.notes).toEqual([
      "Color is not applied: Emoji is a multicolor set.",
    ]);
    expect(
      pickerChoice(payload(), emoji, "outline", undefined),
    ).toBeUndefined();
  });

  it("контекст модели — как ответ get_icon; без «<script>» и «<style>»: строка живёт внутри тега <script> страницы", () => {
    const [house] = payload().cards;
    if (house === undefined) throw new Error("карточка");
    const choice = pickerChoice(payload(), house, "any", undefined);
    if (choice === undefined) throw new Error("выбор");
    const text = pickerContextText(choice);
    expect(text).toMatch(
      /^The user picked demo:house — Demo, outline — in the Iconavo picker for "house"\./,
    );
    expect(text).toMatch(
      /License — keep this attribution: Icons: Demo by Demo Authors/,
    );
    expect(text).toMatch(/Insert this code/);
    expect(text).not.toMatch(/<script|<style/i);
  });

  it("сообщение в чат — коротко на языке чата; не принят контекст — просьба взять код у get_icon", () => {
    const [house] = payload().cards;
    if (house === undefined) throw new Error("карточка");
    const choice = pickerChoice(
      payload({ format: "react" }),
      house,
      "filled",
      "#e11d48",
    );
    if (choice === undefined) throw new Error("выбор");
    expect(pickerMessage(choice, "ru", true)).toBe(
      "Выбрана иконка demo:house-fill · Заливка · #E11D48.",
    );
    expect(pickerMessage(choice, "en", true)).toBe(
      "Picked demo:house-fill · Filled · #E11D48.",
    );
    expect(pickerMessage(choice, "ru", false)).toBe(
      "Выбрана иконка demo:house-fill · Заливка · #E11D48. Код возьми через get_icon (react).",
    );
    expect(pickerMessage(choice, "en", false)).toBe(
      "Picked demo:house-fill · Filled · #E11D48. Get the code with get_icon (react).",
    );
  });
});
