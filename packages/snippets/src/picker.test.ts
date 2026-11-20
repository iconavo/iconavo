import type { IconSetSummary } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import { cssClassCode } from "./code.js";
import type { Install } from "./install.js";
import { FORMATS, lookCode, normalizeColor, setupFor } from "./look.js";
import {
  cardHasStroke,
  PICKER_FORMAT,
  PICKER_FORMAT_GROUPS,
  type PickerIcon,
  type PickerPayload,
  parsePickerPayload,
  pickerChoice,
  pickerContextText,
  pickerHasColor,
  pickerMessage,
  pickerPayload,
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
  body: '<path fill="none" stroke="currentColor" stroke-width="2" d="M1 1h4"/>',
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

  it("цвет — если есть монохромный набор; толщина — у карточек с линиями (hasStrokeWidth ядра)", () => {
    const p = payload();
    const [house, emoji] = p.cards;
    if (house === undefined || emoji === undefined) throw new Error("карточки");
    expect(pickerHasColor(p)).toBe(true);
    expect(pickerHasColor(payload({ sets: [EMOJIS] }))).toBe(false);
    expect(cardHasStroke(p, house)).toBe(true);
    expect(cardHasStroke(p, emoji)).toBe(false);
  });

  it("кнопки формата — группы панели сайта: работают все форматы get_icon, остальное — Soon", () => {
    expect(
      PICKER_FORMAT_GROUPS.map((g) => [
        g.label,
        g.options.map((o) => o.format ?? `${o.label} (Soon)`),
      ]),
    ).toEqual([
      ["SVG and CSS", ["svg", "SVG+CSS (Soon)", "css"]],
      [
        "Components",
        [
          "html",
          "react",
          "Vue (Soon)",
          "Svelte (Soon)",
          "Solid (Soon)",
          "Astro (Soon)",
        ],
      ],
    ]);
    const working = PICKER_FORMAT_GROUPS.flatMap((g) =>
      g.options.flatMap((o) => (o.format === undefined ? [] : [o.format])),
    );
    expect([...working].sort()).toEqual([...FORMATS].sort());
  });
});

describe("выбор", () => {
  it("код — функциями get_icon: тег, React, SVG с адресом edge API и CSS; цвет и толщина — из сетки", () => {
    const p = payload();
    const [house] = p.cards;
    if (house === undefined) throw new Error("карточка");
    const html = pickerChoice(p, house, {
      format: "html",
      color: "#E11D48",
      stroke: 1.5,
    });
    expect(html?.code).toBe(
      '<iconavo-icon icon="demo:house" width="24" color="#e11d48" stroke-width="1.5"></iconavo-icon>',
    );
    expect(html?.setup).toEqual(setupFor("html", INSTALL));
    expect(html).toMatchObject({ color: "#e11d48", stroke: 1.5, notes: [] });
    const react = pickerChoice(p, house, { format: "react" });
    expect(react?.code).toBe(
      lookCode(
        "https://api.example",
        "react",
        "demo:house",
        { size: 24, rotate: 0, hflip: false, vflip: false },
        { palette: false, strokes: true },
        INSTALL,
      ).code,
    );
    const svg = pickerChoice(p, house, { format: "svg", color: "#e11d48" });
    expect(svg?.code).toMatch(/^<!-- demo:house\. Icons: Demo by Demo Authors/);
    expect(svg?.svgUrl).toBe(
      "https://api.example/demo/house.svg?width=24&color=e11d48",
    );
    expect(svg?.setup).toBeUndefined();
    expect(svg?.page).toBe("https://site.example/demo/house");
    const css = pickerChoice(p, house, { format: "css", stroke: 1.5 });
    expect(css?.code).toBe(
      `${cssClassCode(
        "demo:house",
        LINE,
        { size: 24, stroke: 1.5, rotate: 0, hflip: false, vflip: false },
        { palette: false, strokes: true },
      )}\n\n<span class="demo--house"></span>`,
    );
    expect(css?.setup).toBeUndefined();
  });

  it("цвет у цветного набора и толщина без линий не применяются — заметки, как у get_icon", () => {
    const emoji = payload().cards[1];
    if (emoji === undefined) throw new Error("карточка");
    const choice = pickerChoice(payload(), emoji, {
      format: "html",
      color: normalizeColor("#abc"),
      stroke: 1.5,
    });
    expect(choice?.color).toBeUndefined();
    expect(choice?.stroke).toBeUndefined();
    expect(choice?.code).toBe(
      '<iconavo-icon icon="emo:house" width="24"></iconavo-icon>',
    );
    expect(choice?.notes).toEqual([
      "Color is not applied: Emoji is a multicolor set.",
      "Stroke width is not applied: this icon has no lines that change with it.",
    ]);
  });

  it("контекст модели — как ответ get_icon, с форматом из сетки; без «<script>» и «<style>»: строка живёт внутри тега <script> страницы", () => {
    const [house] = payload().cards;
    if (house === undefined) throw new Error("карточка");
    for (const format of FORMATS) {
      const choice = pickerChoice(payload(), house, { format });
      if (choice === undefined) throw new Error("выбор");
      expect(pickerContextText(choice)).not.toMatch(/<script|<style/i);
    }
    const choice = pickerChoice(payload(), house, { format: "react" });
    if (choice === undefined) throw new Error("выбор");
    const text = pickerContextText(choice);
    expect(text).toMatch(
      /^The user picked demo:house — Demo, outline — in the Iconavo picker for "house" and asked for React code\./,
    );
    expect(text).toContain("Code (React <Icon> from @iconavo-ui/react):");
    expect(text).toMatch(
      /License — keep this attribution: Icons: Demo by Demo Authors/,
    );
    expect(text).toMatch(/Reply with this code, ready to paste/);
  });

  it("сообщение в чат — просьба о коде выбранного формата; не принят контекст — просьба взять код у get_icon", () => {
    const [house, emoji] = payload().cards;
    if (house === undefined || emoji === undefined) throw new Error("карточки");
    const choice = pickerChoice(payload(), house, {
      format: "react",
      color: "#e11d48",
      stroke: 1.5,
    });
    if (choice === undefined) throw new Error("выбор");
    expect(pickerMessage(choice, true)).toBe(
      "Use demo:house (Demo, outline, #E11D48, stroke 1.5) — give me the React code.",
    );
    expect(pickerMessage(choice, false)).toBe(
      "Use demo:house (Demo, outline, #E11D48, stroke 1.5) — give me the React code. Get it with get_icon (format react, color #E11D48, strokeWidth 1.5).",
    );
    const big = pickerChoice(payload({ size: 32 }), emoji, { format: "svg" });
    if (big === undefined) throw new Error("выбор");
    expect(pickerMessage(big, true)).toBe(
      "Use emo:house (Emoji, color) — give me the SVG code.",
    );
    expect(pickerMessage(big, false)).toBe(
      "Use emo:house (Emoji, color) — give me the SVG code. Get it with get_icon (format svg, size 32).",
    );
  });
});
