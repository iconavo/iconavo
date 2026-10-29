import { describe, expect, it } from "vitest";
import {
  AXE_TAGS,
  axeVerdict,
  canaryVerdict,
  consoleVerdict,
  type ExampleNames,
  type ExampleResult,
  expectedWarnings,
  LIVE_HOSTS,
  networkVerdict,
  type Placeholder,
  placeholderVerdict,
  requested,
} from "./check.js";
import { formatExampleCheck, markdownExampleCheck } from "./check-report.js";
import { react18Csp, react18Page } from "./react18.js";

const API = "http://127.0.0.1:5000";

const NAMES: ExampleNames = {
  server: ["lucide:house"],
  browser: ["lucide:cat", "ph:fish"],
  toggle: [],
  more: [],
  moreBrowser: [],
  tag: "lucide:search",
  missing: "lucide:no-such-icon",
  missingTag: "lucide:no-such-tag-icon",
};

describe("запросы к хостам иконок", () => {
  it("имена из пачек API, статика — счётом, чужие адреса не в счёт", () => {
    expect(
      requested(
        [
          `${API}/lucide.json?icons=cat,search`,
          `${API}/ph.json?icons=fish`,
          `${API}/_static/manifest.json`,
          "http://127.0.0.1:4283/more",
        ],
        API,
      ),
    ).toEqual({
      names: ["lucide:cat", "lucide:search", "ph:fish"],
      batches: 2,
      statics: 1,
    });
  });

  it("сеть: иконки обёртки, повторы, пропуски и статика — проблемы", () => {
    const expected = [...NAMES.browser, NAMES.tag];
    expect(
      networkVerdict(
        [`${API}/lucide.json?icons=cat,search`, `${API}/ph.json?icons=fish`],
        API,
        NAMES.server,
        expected,
      ).ok,
    ).toBe(true);
    const bad = networkVerdict(
      [
        `${API}/lucide.json?icons=cat,house`,
        `${API}/lucide.json?icons=cat`,
        `${API}/_static/manifest.json`,
      ],
      API,
      NAMES.server,
      expected,
    );
    expect(bad.ok).toBe(false);
    expect(bad.note).toContain("запрошены иконки обёртки: lucide:house");
    expect(bad.note).toContain("дважды: lucide:cat");
    expect(bad.note).toContain("не запрошены: ph:fish, lucide:search");
    expect(bad.note).toContain("запросов к статике: 1");
    const live = networkVerdict(
      [`${API}/lucide.json?icons=cat,search`, `${API}/ph.json?icons=fish`],
      API,
      NAMES.server,
      expected,
      ["https://api.iconavo.dev/lucide.json?icons=bird"],
    );
    expect(live.ok).toBe(false);
    expect(live.note).toBe("к живым хостам: 1 (api.iconavo.dev)");
    expect(LIVE_HOSTS.test("https://cdn2.iconavo.dev/manifest.json")).toBe(
      true,
    );
    expect(LIVE_HOSTS.test("https://iconavo.b-cdn.net/manifest.json")).toBe(
      true,
    );
    expect(LIVE_HOSTS.test(`${API}/lucide.json`)).toBe(false);
  });
});

describe("заглушки", () => {
  const p = (over: Partial<Placeholder>): Placeholder => ({
    name: "lucide:cat",
    className: "iconavo-skeleton",
    drawn: false,
    early: "hidden",
    visibility: "visible",
    animation: "iconavo-h, iconavo-p",
    ...over,
  });

  it("первые 150 мс скрыты, потом видны и анимированы: скелетон мерцает, спиннер крутится", () => {
    const v = placeholderVerdict([
      p({}),
      p({ className: "iconavo-spinner", animation: "iconavo-h, iconavo-s" }),
      p({ early: null }),
    ]);
    expect(v.ok).toBe(true);
    expect(v.note).toContain("скелетон и спиннер");
    expect(v.note).toContain("застали 2 из 3");
  });

  it("видна раньше 150 мс, скрыта потом или неподвижна — проблема; все иконки уже пришли — только сведения", () => {
    const early = placeholderVerdict([p({ early: "visible" })]);
    expect(early.ok).toBe(false);
    expect(early.note).toContain("видна раньше 150 мс");
    expect(placeholderVerdict([p({ visibility: "hidden" })]).ok).toBe(false);
    expect(
      placeholderVerdict([
        p({ className: "iconavo-spinner", animation: "iconavo-h, iconavo-p" }),
      ]).ok,
    ).toBe(false);
    expect(placeholderVerdict([p({ drawn: true })]).ok).toBeNull();
  });
});

describe("консоль", () => {
  const expected = expectedWarnings(NAMES);

  it("два ожидаемых предупреждения — по разу, больше ничего", () => {
    expect(expected).toEqual([
      'Iconavo: icon "lucide:no-such-icon" not found',
      'Iconavo: icon "lucide:no-such-tag-icon" not found',
    ]);
    expect(consoleVerdict(expected, [], expected).ok).toBe(true);
  });

  it("лишнее предупреждение, повтор и ошибка гидратации — проблемы", () => {
    const v = consoleVerdict(
      [...expected, expected[0] as string, "A tree hydrated but…"],
      ["Hydration failed"],
      expected,
    );
    expect(v.ok).toBe(false);
    expect(v.note).toContain("2 раз:");
    expect(v.note).toContain("предупреждение: A tree hydrated but…");
    expect(v.note).toContain("ошибка: Hydration failed");
  });

  it("контрольный запуск React 18: предупреждение разработки и ошибка продакшена — замечено", () => {
    expect(
      canaryVerdict([
        'Warning: Text content did not match. Server: "From the server, spoiled" Client: "From the server"',
      ]).ok,
    ).toBe(true);
    expect(canaryVerdict(["Minified React error #425; visit …"]).ok).toBe(true);
  });

  it("контрольный запуск: сказано про гидратацию — да; тишина или чужая ошибка — проверка слепая", () => {
    expect(
      canaryVerdict(["noise", "Minified React error #418; visit…"]).note,
    ).toContain("#418");
    expect(canaryVerdict([]).ok).toBe(false);
    const other = canaryVerdict(["WebSocket connection failed"]);
    expect(other.ok).toBe(false);
    expect(other.note).toContain("было: WebSocket connection failed");
  });
});

describe("доступность (axe-core)", () => {
  it("только правила WCAG A и AA, без рекомендаций axe", () => {
    expect(AXE_TAGS).toContain("wcag22aa");
    expect(AXE_TAGS).not.toContain("best-practice");
  });

  it("нет нарушений — да; нарушение — страница, правило, важность и элементы", () => {
    expect(
      axeVerdict([
        { path: "/", violations: [] },
        { path: "/more", violations: [] },
      ]),
    ).toEqual({
      ok: true,
      note: "нарушений нет: / и /more, правила WCAG 2.2 A и AA",
    });
    const v = axeVerdict([
      {
        path: "/more",
        violations: [
          { id: "svg-img-alt", impact: "serious", nodes: ["svg:nth-child(2)"] },
        ],
      },
    ]);
    expect(v.ok).toBe(false);
    expect(v.note).toBe("/more: svg-img-alt (serious) — svg:nth-child(2)");
  });
});

describe("React 18 без Next.js", () => {
  it("политика: только свои скрипты и стили, сеть — превью API, Trusted Types только у iconavo", () => {
    const csp = react18Csp("http://127.0.0.1:5000");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("style-src 'self';");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:5000;");
    expect(csp).toContain(
      "require-trusted-types-for 'script'; trusted-types iconavo",
    );
  });

  it("страница: разметка с сервера в #root, данные обёрток блоком JSON, скрипт и стили — файлами", () => {
    const html = react18Page('<main><svg data-name="a"></svg></main>', {
      server: [{ prefix: "x", icons: { y: { body: "</script>" } } }],
    });
    expect(html).toContain(
      '<div id="root"><main><svg data-name="a"></svg></main></div>',
    );
    expect(html).toContain('"body":"\\u003c/script>"');
    expect(html).toContain('<script type="module" src="/client.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).not.toMatch(/<script>|style="/);
  });

  it("отчёт: у столбцов React 18 — пометка, у Next.js — нет", () => {
    const result = (app: ExampleResult["app"]): ExampleResult => ({
      app,
      mode: "dev",
      browser: "chrome",
      verdicts: { html: { ok: true, note: "да" } },
      shots: [],
    });
    const text = formatExampleCheck([result("next"), result("react18")]).join(
      "\n",
    );
    expect(text).toContain("Chrome, разработка");
    expect(text).toContain("Chrome, React 18, разработка");
    expect(markdownExampleCheck([result("react18")])).toContain(
      "| Проверка | Chrome, React 18, разработка |",
    );
  });
});
