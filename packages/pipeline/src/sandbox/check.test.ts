import { describe, expect, it } from "vitest";
import {
  type BrowserResult,
  CHECKS,
  delayVerdict,
  EXPECTED_WARNINGS,
  errorsVerdict,
  motionVerdict,
  sandboxCheckFailed,
  warningsVerdict,
} from "./check.js";
import {
  formatSandboxCheck,
  markdownSandboxCheck,
  renderSandboxCheckPage,
} from "./check-report.js";
import {
  isAbortedPrefetch,
  isAbortedScript,
  isRequestFailure,
  layoutVerdict,
  shot,
} from "./verdict.js";

/** Страница для shot(): «снимок» добавляет то, что приходит во время него в WebKit, и ещё настоящее. */
function snapshotPage(seen: { errors: string[] }) {
  const win = { violations: [] as string[] };
  const style =
    "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";
  const page = {
    evaluate: async <A, R>(fn: (arg: A) => R, arg: A) => {
      const g = globalThis as unknown as { window?: unknown };
      g.window = win;
      try {
        return fn(arg);
      } finally {
        delete g.window;
      }
    },
    screenshot: async () => {
      win.violations.push(
        "style-src-elem inline :5 ",
        "script-src-elem inline http://127.0.0.1:4282/tag:40 ",
      );
      seen.errors.push(style, "TypeError: настоящая ошибка");
      return Buffer.from("png");
    },
    waitForTimeout: async () => {},
  };
  return { page, win, style };
}

describe("снимок страницы (ревизия фазы 5, И-7)", () => {
  it("не в счёт только стиль Playwright и сообщение о нём; настоящее остаётся", async () => {
    const seen = { errors: ["ошибка до снимка"] };
    const { page, win } = snapshotPage(seen);
    win.violations.push("connect-src https://evil.example/ :1 ");
    await shot(page as never, seen);
    expect(win.violations).toEqual([
      "connect-src https://evil.example/ :1 ",
      "script-src-elem inline http://127.0.0.1:4282/tag:40 ",
    ]);
    expect(seen.errors).toEqual([
      "ошибка до снимка",
      "TypeError: настоящая ошибка",
    ]);
    // Сообщение о стиле без своего нарушения — сайт сам вставил стиль: остаётся.
    const alone = { errors: [] as string[] };
    const quiet = snapshotPage(alone);
    quiet.page.screenshot = async () => {
      alone.errors.push(quiet.style);
      return Buffer.from("png");
    };
    await shot(quiet.page as never, alone);
    expect(alone.errors).toEqual([quiet.style]);
  });
});

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

  it("заглушка: скрыта при вставке и в раннем кадре, потом видна и анимирована; поздний кадр не судится", () => {
    const measured = {
      startVisibility: "hidden",
      earlyAt: 16.7,
      earlyVisibility: "hidden",
      lateVisibility: "visible",
      skeleton: "h, p",
      spinner: "h, s",
    };
    expect(delayVerdict(measured)).toEqual({
      ok: true,
      note: "при вставке и на 17 мс анимации скрыта, после 150 мс видна; анимации h, p / h, s",
    });
    // Медленная машина: первый кадр пришёл после конца задержки — он не судится, вставка судится.
    const late = { ...measured, earlyAt: 150, earlyVisibility: "visible" };
    expect(delayVerdict(late)).toEqual({
      ok: null,
      note: "при вставке скрыта, первый кадр анимации пришёл поздно (150 мс), после задержки — видна; анимации h, p / h, s",
    });
    expect(delayVerdict({ ...late, startVisibility: "visible" }).ok).toBe(
      false,
    );
    expect(delayVerdict({ ...measured, earlyVisibility: "visible" })).toEqual({
      ok: false,
      note: "при вставке — hidden, на 17 мс анимации — visible, после задержки — visible; анимации h, p / h, s",
    });
    expect(delayVerdict({ ...measured, lateVisibility: "hidden" }).ok).toBe(
      false,
    );
    expect(delayVerdict({ ...measured, skeleton: "h" }).ok).toBe(false);
    expect(delayVerdict({ ...measured, spinner: "h" }).ok).toBe(false);
    expect(delayVerdict({ ...measured, earlyAt: null })).toEqual({
      ok: false,
      note: "у заглушки нет анимации задержки h; анимации h, p",
    });
    expect(delayVerdict(null)).toEqual({
      ok: false,
      note: "класс skeleton не появился за 10 с",
    });
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

  it("записи о неудавшихся запросах — не ошибки страницы, настоящая ошибка CORS — ошибка", () => {
    expect(
      isRequestFailure(
        "Failed to load resource: the server responded with a status of 404 (Not Found)",
      ),
    ).toBe(true);
    expect(
      isRequestFailure(
        "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at http://127.0.0.1:1/x.json. (Reason: CORS request did not succeed). Status code: (null).",
      ),
    ).toBe(true);
    expect(
      isRequestFailure(
        "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at http://127.0.0.1:1/x.json. (Reason: CORS header ‘Access-Control-Allow-Origin’ missing). Status code: 200.",
      ),
    ).toBe(false);
    expect(isRequestFailure("TypeError: boom")).toBe(false);
    // WebKit: запрос ядра к статике превью, отменённый ядром или переходом, — не ошибка; настоящий отказ
    // CORS WebKit сообщает своей строкой — она ошибка, как и отмена запроса не к /_static/.
    expect(
      isRequestFailure(
        "Fetch API cannot load http://127.0.0.1:34427/_static/manifest.json due to access control checks.",
      ),
    ).toBe(true);
    expect(
      isRequestFailure(
        "Origin http://127.0.0.1:5000 is not allowed by Access-Control-Allow-Origin. Status code: 200",
      ),
    ).toBe(false);
    expect(
      isRequestFailure(
        "Fetch API cannot load http://127.0.0.1:34427/lucide.json?icons=house due to access control checks.",
      ),
    ).toBe(false);
    // Firefox: скрипт Next.js, оборванный перезагрузкой, — не ошибка; скрипт тега или примера — ошибка.
    expect(
      isAbortedScript(
        '[JavaScript Warning: "Loading failed for the <script> with source “http://127.0.0.1:37397/_next/static/chunks/1n69piibvegtq.js”." {file: "http://127.0.0.1:37397/" line: 1}]',
      ),
    ).toBe(true);
    expect(
      isAbortedScript(
        "Loading failed for the <script> with source “http://127.0.0.1:4282/icon/iconavo-icon.js”.",
      ),
    ).toBe(false);
    expect(isAbortedScript("Some other warning")).toBe(false);
    // WebKit: предзагрузка Next.js, оборванная уходом со страницы, — не ошибка; та же запись о хосте
    // иконок — ошибка.
    expect(
      isRequestFailure(
        "Fetch API cannot load http://127.0.0.1:45569/changelog?_rsc=JNBreH5MGdaz7Hmy due to access control checks.",
      ),
    ).toBe(true);
    expect(
      isRequestFailure(
        "/127.0.0.1:45569/?_rsc=AyO1lXZyYIZqO9o0 due to access control checks.",
      ),
    ).toBe(true);
    expect(
      isRequestFailure(
        "Fetch API cannot load http://127.0.0.1:4281/lucide.json?icons=house due to access control checks.",
      ),
    ).toBe(false);
    // Та же запись приходит и необработанной ошибкой страницы — её отсеивает isAbortedPrefetch.
    expect(
      isAbortedPrefetch(
        "/127.0.0.1:40037/licenses?_rsc=Pl0muESTIEMhrDNY due to access control checks.",
      ),
    ).toBe(true);
    expect(isAbortedPrefetch("TypeError: Load failed")).toBe(false);
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

  it("сводка CI: та же таблица в Markdown, что не так и итог", () => {
    const md = markdownSandboxCheck(results);
    expect(md).toContain(
      "| Проверка | Chrome | Firefox | WebKit (Safari) |\n| --- | --- | --- | --- |",
    );
    expect(md).toMatch(/\| Подпись[^|]* \| да \| — \| сбой \|/);
    expect(md).toContain(
      "- Firefox — Иконка перекрашивается вслед за цветом текста: цвет иконки rgb(0, 0, 0)",
    );
    expect(md).toContain("Итог: есть проблемы.");
    expect(markdownSandboxCheck(results.slice(0, 1))).not.toContain("Не так:");
  });
});

describe("заглушка без движения (ревизия фазы 5, И-19)", () => {
  const still = {
    startVisibility: "hidden",
    earlyAt: 20,
    earlyVisibility: "hidden",
    lateVisibility: "visible",
    skeleton: "h",
    spinner: "h",
  };
  it("только задержка, скрыта при вставке и видна после — «да»", () => {
    expect(motionVerdict(still).ok).toBe(true);
  });
  it("скрыта навсегда, мерцает или нет задержки — «нет»", () => {
    expect(motionVerdict({ ...still, lateVisibility: "hidden" }).ok).toBe(
      false,
    );
    expect(motionVerdict({ ...still, skeleton: "h, p" }).ok).toBe(false);
    expect(motionVerdict({ ...still, earlyAt: null }).ok).toBe(false);
    expect(motionVerdict(null).ok).toBe(false);
  });
});
