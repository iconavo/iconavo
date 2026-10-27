import { describe, expect, it } from "vitest";
import {
  type BrowserResult,
  CHECKS,
  EXPECTED_WARNINGS,
  errorsVerdict,
  layoutVerdict,
  sandboxCheckFailed,
  warningsVerdict,
} from "./check.js";
import { formatSandboxCheck, renderSandboxCheckPage } from "./check-report.js";

describe("разбор проверки в браузерах", () => {
  it("предупреждения: каждое ожидаемое — ровно один раз, чужие предупреждения пакета — проблема", () => {
    expect(warningsVerdict([...EXPECTED_WARNINGS, "React says hi"]).ok).toBe(
      true,
    );
    const twice = warningsVerdict([
      ...EXPECTED_WARNINGS,
      EXPECTED_WARNINGS[0] as string,
    ]);
    expect(twice.ok).toBe(false);
    expect(twice.note).toContain("2 раз");
    const missing = warningsVerdict(EXPECTED_WARNINGS.slice(1));
    expect(missing.note).toContain("0 раз");
    const extra = warningsVerdict([...EXPECTED_WARNINGS, "Iconavo: surprise"]);
    expect(extra).toEqual({ ok: false, note: "лишнее: Iconavo: surprise" });
  });

  it("раскладка: имена на месте с точностью до полпикселя", () => {
    const before = [
      { left: 10, top: 20 },
      { left: 50, top: 20 },
    ];
    expect(
      layoutVerdict(before, [
        { left: 10.4, top: 20 },
        { left: 50, top: 19.6 },
      ]),
    ).toEqual({ ok: true, note: "2 имён на месте" });
    expect(
      layoutVerdict(before, [
        { left: 26, top: 20 },
        { left: 50, top: 20 },
      ]),
    ).toEqual({ ok: false, note: "сдвинулось 1 из 2 имён" });
    expect(layoutVerdict([], []).ok).toBe(false);
  });

  it("ошибки и нарушения CSP — проблема, без них — «нет»", () => {
    expect(errorsVerdict([], [])).toEqual({ ok: true, note: "нет" });
    expect(
      errorsVerdict(["boom"], ["require-trusted-types-for trusted-types-sink"]),
    ).toEqual({
      ok: false,
      note: "boom; CSP: require-trusted-types-for trusted-types-sink",
    });
  });
});

const results: BrowserResult[] = [
  {
    browser: "chrome",
    verdicts: Object.fromEntries(
      CHECKS.map(([id]) => [id, { ok: true, note: `ок ${id}` }]),
    ),
    shots: [{ title: "Тег <начало>", png: "iVBORw0KGgo=" }],
  },
  {
    browser: "firefox",
    verdicts: {
      copies: { ok: true, note: "ок" },
      label: { ok: null, note: "вручную — Экранным диктором" },
      recolor: { ok: false, note: "цвет иконки rgb(0, 0, 0)" },
    },
    shots: [],
  },
  {
    browser: "webkit",
    failure: "WebKit не запустился",
    verdicts: {},
    shots: [],
  },
];

describe("отчёт проверки", () => {
  it("провал — «нет» в любой строке или сбой браузера; «—» провалом не считается", () => {
    expect(sandboxCheckFailed(results)).toBe(true);
    expect(sandboxCheckFailed(results.slice(0, 1))).toBe(false);
    const manual: BrowserResult = {
      browser: "firefox",
      verdicts: { label: { ok: null, note: "вручную" } },
      shots: [],
    };
    expect(sandboxCheckFailed([manual])).toBe(false);
  });

  it("терминал: таблица «проверка × браузер», что не так и итог", () => {
    const text = formatSandboxCheck(results).join("\n");
    expect(text).toContain("Проверка");
    expect(text).toContain("WebKit (Safari)");
    expect(text).toMatch(/Подпись.*да\s+—\s+сбой/);
    expect(text).toContain(
      "Firefox — Иконка перекрашивается вслед за цветом текста: цвет иконки rgb(0, 0, 0)",
    );
    expect(text).toContain("WebKit (Safari): WebKit не запустился");
    expect(text).toContain("Итог: есть проблемы.");
  });

  it("страница: таблица с пояснениями, снимки картинками data:, текст экранирован", () => {
    const html = renderSandboxCheckPage(results);
    expect(html).toContain("<th>WebKit (Safari)</th>");
    expect(html).toContain(
      '<td class="stop">НЕТ<span class="note">цвет иконки rgb(0, 0, 0)</span></td>',
    );
    expect(html).toContain(
      '<td class="">—<span class="note">вручную — Экранным диктором</span></td>',
    );
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain("Тег &lt;начало&gt;");
    expect(html).toContain("<li>WebKit (Safari): WebKit не запустился</li>");
  });
});
