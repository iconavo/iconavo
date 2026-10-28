import { describe, expect, it } from "vitest";
import { formatVisual, markdownVisual, renderVisualReport } from "./report.js";
import type { Mismatch, SetResult, VisualResult } from "./run.js";

const shown = (icon: string, pixels: number): Mismatch => ({
  icon,
  pixels,
  images: {
    ref: "data:image/png;base64,QQ==",
    own: "data:image/png;base64,Qg==",
    diff: "data:image/png;base64,Qw==",
  },
});

const set = (over: Partial<SetResult>): SetResult => ({
  set: "lucide",
  names: 2193,
  ms: 14_000,
  counts: { tag: 0, react: 0 },
  shown: { tag: [], react: [] },
  noise: {
    tag: { count: 0, max: 0, shown: [] },
    react: { count: 0, max: 0, shown: [] },
  },
  ...over,
});

const results: VisualResult[] = [
  {
    browser: "chrome",
    sets: [
      set({}),
      set({
        set: "material-symbols",
        names: 23622,
        counts: { tag: 0, react: 2 },
        shown: {
          tag: [],
          react: [
            shown("material-symbols:csv", 40),
            shown("material-symbols:pin", 30),
          ],
        },
        noise: {
          tag: {
            count: 7,
            max: 3,
            shown: [shown("material-symbols:csv-<x>", 2)],
          },
          react: { count: 6, max: 3, shown: [] },
        },
      }),
    ],
    problems: [],
  },
  {
    browser: "webkit",
    failure: "WebKit не запустился",
    sets: [],
    problems: [],
  },
];

describe("отчёт визуального сравнения", () => {
  it("терминал: «набор × браузер» — расхождения тега / React, в допуске, итог", () => {
    const text = formatVisual(results).join("\n");
    expect(text).toMatch(/lucide\s+2193\s+0 \/ 0\s+сбой/);
    expect(text).toMatch(/material-symbols\s+23622\s+0 \/ 2\s+сбой/);
    expect(text).toContain(
      "Chrome, material-symbols: тег — 7, React — 6; больше всего — 3 пикс.",
    );
    expect(text).toContain("до 0,5% пикселей иконки — 12 при 48 px");
    expect(text).toContain("WebKit (Safari): WebKit не запустился");
    expect(text).toContain("Итог: есть расхождения или проблемы.");
  });

  it("сводка CI: та же таблица в Markdown", () => {
    const md = markdownVisual(results);
    expect(md).toContain(
      "| Набор | Имён | Chrome: тег / React | WebKit (Safari): тег / React |",
    );
    expect(md).toContain("| material-symbols | 23622 | 0 / 2 | сбой |");
    expect(md).toContain("- Chrome, material-symbols: тег — 7, React — 6");
  });

  it("страница: таблица с отметками, расхождения и примеры в допуске картинками, текст экранирован", () => {
    const html = renderVisualReport(results);
    expect(html).toContain('<td class="ok">0 / 0</td>');
    expect(html).toContain('<td class="stop">0 / 2</td>');
    expect(html).toContain("<h3>Chrome, material-symbols, React</h3>");
    expect(html).toContain(
      '<img alt="React" src="data:image/png;base64,Qg==">',
    );
    expect(html).toContain("<h2>В допуске — сглаживание краёв</h2>");
    expect(html).toContain(
      "<h3>Chrome, material-symbols, тег — первые 1 из 7</h3>",
    );
    expect(html).toContain("material-symbols:csv-&lt;x&gt;");
    expect(html).toContain("<li>WebKit (Safari): WebKit не запустился</li>");
  });

  it("всё совпало — зелёный итог без разделов расхождений", () => {
    const ok: VisualResult[] = [
      { browser: "firefox", sets: [set({})], problems: [] },
    ];
    expect(formatVisual(ok).at(-1)).toContain(
      "выглядят так же, как SVG статики",
    );
    const html = renderVisualReport(ok);
    expect(html).not.toContain("<h2>Расхождения</h2>");
    expect(html).not.toContain("В допуске");
  });
});
