import { describe, expect, it } from "vitest";
import {
  CONTENT_META,
  CRAWL_ICON_NAMES,
  CRAWL_ICONS,
  followLink,
  HIDDEN_ICON,
  iconPath,
  isIconPath,
  MOCKUPS,
  REDIRECT_CODES,
} from "./config.js";
import {
  anchorsOf,
  type CrawledPage,
  contentVerdict,
  counterpartOf,
  freshnessVerdict,
  headersVerdict,
  headingsOf,
  htmlLang,
  iconPagesProblems,
  idsOf,
  langVerdict,
  linksVerdict,
  parseCsp,
  readmeSections,
  robotsBlocksAll,
  robotsMetaVerdict,
  robotsTxtVerdict,
  searchFormVerdict,
  sectionsVerdict,
  statusVerdict,
  switchVerdict,
  versionMetaOf,
} from "./crawl.js";

const page = (
  path: string,
  html: string,
  status = 200,
  headers = {},
): CrawledPage => ({
  path,
  status,
  headers,
  html,
});

describe("обход сайта: ссылки и якоря", () => {
  it("ссылки и id страницы", () => {
    const html =
      '<a href="/docs?a=1&amp;b=2#x">x</a><h2 id="install">Install</h2>';
    expect(anchorsOf(html)).toEqual(["/docs?a=1&b=2#x"]);
    expect([...idsOf(html)]).toEqual(["install"]);
  });

  it("внутренние ссылки ведут на страницы и якоря, внешние — только https", () => {
    const pages = [
      page(
        "/",
        '<a href="/docs#install">a</a><a href="https://github.com/iconavo/iconavo">b</a>',
      ),
      page("/docs", '<h2 id="install">Install</h2><a href="#install">c</a>'),
    ];
    expect(linksVerdict(pages).ok).toBe(true);
    const broken = linksVerdict([
      ...pages,
      page(
        "/x",
        '<a href="/nowhere">1</a><a href="/docs#nope">2</a><a href="http://a.b">3</a><a href="https://stackblitz.com/edit/x">4</a>',
      ),
      page("/nowhere", "", 404),
    ]);
    expect(broken.ok).toBe(false);
    expect(broken.note).toContain("/nowhere — 404");
    expect(broken.note).toContain("якоря #nope нет на /docs");
    expect(broken.note).toContain("не по https");
    expect(broken.note).toContain("не из starters/links.ts");
  });
});

describe("заголовки ответа", () => {
  const ok = {
    "x-robots-tag": "noindex, nofollow",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "x-iconavo-build": "abcd1234",
    "content-security-policy":
      "default-src 'self'; style-src 'self'; connect-src 'self' https://api.iconavo.dev; frame-ancestors 'none'; object-src 'none'",
  };

  it("разбор CSP", () => {
    expect(parseCsp(ok["content-security-policy"]).get("connect-src")).toEqual([
      "'self'",
      "https://api.iconavo.dev",
    ]);
  });

  it("всё на месте — без замечаний", () => {
    expect(
      headersVerdict(page("/", "", 200, ok), {
        production: true,
        hosts: ["https://api.iconavo.dev"],
        build: "abcd1234",
      }),
    ).toEqual([]);
  });

  it("без noindex, со стилями inline и лишним хостом — замечания", () => {
    const bad = {
      ...ok,
      "x-robots-tag": "all",
      "content-security-policy":
        "style-src 'self' 'unsafe-inline'; connect-src 'self' https://evil.example",
    };
    const problems = headersVerdict(page("/", "", 200, bad), {
      production: true,
      hosts: ["https://api.iconavo.dev"],
      build: "other000",
    });
    expect(problems.join("; ")).toMatch(
      /X-Robots-Tag: all.*сборка abcd1234.*style-src.*connect-src/,
    );
  });
});

describe("метка robots и разделы README", () => {
  it("ровно одна метка noindex, nofollow", () => {
    expect(
      robotsMetaVerdict('<meta name="robots" content="noindex, nofollow">').ok,
    ).toBe(true);
    expect(robotsMetaVerdict("<p></p>").ok).toBe(false);
    expect(robotsMetaVerdict('<meta name="robots" content="index">').ok).toBe(
      false,
    );
  });

  it("разделы «##» README — без кода, без строк внутри блоков кода", () => {
    expect(
      readmeSections(
        "# A\n\n## One\n\n```md\n## Not a section\n```\n\n## Icon data: `/{set}.json`\n",
      ),
    ).toEqual(["One", "Icon data: /{set}.json"]);
  });

  it("каждый раздел — ровно на одной странице документации (только /docs)", () => {
    const pages = [
      page("/docs", "<h1>Quick start</h1><h2>Install</h2>"),
      page("/docs/recipes", "<h1>Recipes</h1><h2>Code &amp; more</h2>"),
    ];
    expect(headingsOf(pages[1]?.html ?? "")).toEqual([
      "Recipes",
      "Code & more",
    ]);
    expect(
      sectionsVerdict(pages, ["Install", "Recipes", "Code & more"]).ok,
    ).toBe(true);
    expect(sectionsVerdict(pages, ["Missing"]).note).toContain(
      "раздела «Missing» нет",
    );
  });
});

describe("коды ответов", () => {
  const expected = {
    missing: ["/__missing__"],
    redirects: { "/ru/docs": "/docs" },
    redirect: 307,
  };

  it("страницы — 200, несуществующая — 404, переход — 307 на нужный адрес", () => {
    const pages = [
      page("/", ""),
      page("/__missing__", "", 404),
      page("/ru/docs", "", 307, { location: "/docs" }),
    ];
    expect(statusVerdict(pages, expected).ok).toBe(true);
    // Vercel отдаёт адрес перехода целиком.
    expect(
      statusVerdict(
        [
          page("/", ""),
          page("/__missing__", "", 404),
          page("/ru/docs", "", 307, { location: "https://iconavo.dev/docs" }),
        ],
        expected,
      ).ok,
    ).toBe(true);
  });

  it("переход не тем кодом и не туда, 404 вместо 200, пропущенный адрес — замечания", () => {
    const v = statusVerdict(
      [page("/", "", 500), page("/ru/docs", "", 308, { location: "/ru" })],
      expected,
    );
    expect(v.ok).toBe(false);
    expect(v.note).toContain("/ — 500");
    expect(v.note).toContain("/ru/docs — 308 → /ru, а ждали 307 → /docs");
    expect(v.note).toContain("/__missing__ не открыт");
  });
});

describe("свежесть данных наборов", () => {
  const meta = (version: string) =>
    `<head><meta name="robots" content="noindex, nofollow"/><meta name="iconavo-version" content="${version}"/></head>`;

  it("метка версии — из <meta name=iconavo-version>, в любом порядке атрибутов", () => {
    expect(versionMetaOf(meta("8d1ee623"))).toBe("8d1ee623");
    expect(versionMetaOf('<meta content="abc" name="iconavo-version">')).toBe(
      "abc",
    );
    expect(versionMetaOf('<meta name="robots" content="x">')).toBeUndefined();
  });

  it("страницы наборов на обоих языках — с версиями манифеста", () => {
    const sets = { lucide: { version: "8d1ee623" }, ph: { version: "aa" } };
    const pages = [
      page("/lucide", meta("8d1ee623")),
      page("/ru/lucide", meta("8d1ee623")),
      page("/ph", meta("aa")),
      page("/ru/ph", meta("aa")),
    ];
    expect(freshnessVerdict(pages, sets).ok).toBe(true);
    const stale = freshnessVerdict(
      [
        page("/lucide", meta("c3b3f7a7")),
        page("/ru/lucide", "<head></head>"),
        page("/ph", "", 404),
      ],
      sets,
    );
    expect(stale.ok).toBe(false);
    expect(stale.note).toContain("/lucide: c3b3f7a7, а в манифесте 8d1ee623");
    expect(stale.note).toContain("/ru/lucide: без метки версии");
    expect(stale.note).toContain("/ph: ответ 404");
    expect(stale.note).toContain("/ru/ph: страницы нет");
    expect(stale.note).toContain("пересборка после «Выкладки»");
  });
});

describe("языки страниц", () => {
  const en = (path: string, body: string) =>
    page(path, `<html lang="en"><body>${body}</body></html>`);
  const ru = (path: string, body: string) =>
    page(path, `<html lang="ru"><body>${body}</body></html>`);
  const search = (action: string) =>
    `<search class="header-search"><form action="${action}" class="f"></form></search>`;

  it("lang у <html> — по адресу", () => {
    expect(htmlLang('<html lang="ru" class="x">')).toBe("ru");
    expect(langVerdict([en("/", ""), ru("/ru", "")]).ok).toBe(true);
    const wrong = langVerdict([en("/ru/x", "")]);
    expect(wrong.ok).toBe(false);
    expect(wrong.note).toContain('/ru/x: lang="en"');
  });

  it("пара страницы: у документации — русская главная", () => {
    expect(counterpartOf("/")).toEqual({ lang: "ru", path: "/ru" });
    expect(counterpartOf("/search")).toEqual({
      lang: "ru",
      path: "/ru/search",
    });
    expect(counterpartOf("/docs/api")).toEqual({ lang: "ru", path: "/ru" });
    expect(counterpartOf("/ru/search")).toEqual({
      lang: "en",
      path: "/search",
    });
  });

  it("на каждой странице — ссылка на пару на другом языке", () => {
    const pages = [
      en("/", '<a href="/ru" hrefLang="ru" lang="ru">Русский</a>'),
      en("/docs", '<a href="/ru" hreflang="ru">Русский</a>'),
      ru("/ru", '<a href="/" hreflang="en">English</a>'),
    ];
    expect(switchVerdict(pages).ok).toBe(true);
    const broken = switchVerdict([
      ...pages,
      en("/search", '<a href="/ru" hreflang="ru">Русский</a>'),
    ]);
    expect(broken.ok).toBe(false);
    expect(broken.note).toContain("/search: нет ссылки на /ru/search");
  });

  it("поиск в шапке ведёт на поиск своего языка", () => {
    const pages = [
      en("/", search("/search")),
      ru("/ru", search("/ru/search")),
      en("/search", search("/search")),
      ru("/ru/search", search("/ru/search")),
    ];
    expect(searchFormVerdict(pages).ok).toBe(true);
    const broken = searchFormVerdict([
      ...pages,
      ru("/ru/x", search("/search")),
      en("/docs", "<p>без поиска</p>"),
    ]);
    expect(broken.ok).toBe(false);
    expect(broken.note).toContain(
      "/ru/x: форма поиска — /search, а ждали /ru/search",
    );
    expect(broken.note).toContain("/docs: форма поиска — нет");
  });
});

describe("страницы иконок в обходе (шаг 4 фазы 4)", () => {
  it("форма адреса: /набор/иконка и /ru/набор/иконка, но не документация и не русская страница набора", () => {
    expect(isIconPath("/lucide/house")).toBe(true);
    expect(isIconPath("/ru/lucide/house")).toBe(true);
    expect(isIconPath("/ru/lucide")).toBe(false);
    expect(isIconPath("/docs/reference")).toBe(false);
    expect(isIconPath("/ru/docs/reference")).toBe(false);
    expect(isIconPath("/lucide")).toBe(false);
    expect(isIconPath("/Lucide/House")).toBe(false);
  });

  it("обход идёт только по выборке, переходам и 404", () => {
    expect(CRAWL_ICONS).toContain("/ru/ph/house-bold");
    expect(followLink("/ph/house-bold")).toBe(true);
    expect(followLink("/lucide/home")).toBe(true);
    expect(followLink("/lucide/iconavo-missing")).toBe(true);
    expect(followLink("/lucide/heart")).toBe(false);
    expect(followLink("/sets")).toBe(true);
  });

  it("ссылка на страницу иконки вне выборки — по форме; на неоткрытую обычную — проблема", () => {
    const pages = [page("/", `<a href="/lucide/heart">h</a>`)];
    expect(linksVerdict(pages, isIconPath).ok).toBe(true);
    expect(linksVerdict(pages).ok).toBe(false);
  });

  it("у старых имён иконок свой код перехода — 308", () => {
    const pages = [
      page("/lucide/home", "", 308, { location: "/lucide/house" }),
    ];
    const o = {
      missing: [],
      redirects: { "/lucide/home": "/lucide/house" },
      redirect: 307,
    };
    expect(statusVerdict(pages, { ...o, codes: REDIRECT_CODES }).ok).toBe(true);
    expect(statusVerdict(pages, o).ok).toBe(false);
  });
});

describe("страницы иконок и отпечатки содержимого (шаг 4 фазы 4)", () => {
  const mockups = '<div class="mockup" data-mockup="m"></div>'.repeat(MOCKUPS);
  /** Серверный HTML страницы иконки: метки, заголовок, превью и мокапы. */
  const iconHtml = (name: string, content: string, extra = "") =>
    [
      `<meta name="iconavo-version" content="v1"/>`,
      `<meta name="${CONTENT_META}" content="${content}"/>`,
      `<h1>${name.slice(name.indexOf(":") + 1)}</h1>`,
      `<figure class="icon-preview preview-light"><svg viewBox="0 0 24 24"><path/></svg></figure>`,
      mockups,
      extra,
    ].join("");
  const setOf = (name: string) => name.slice(0, name.indexOf(":"));
  /** Страницы выборки обхода на двух языках; change может подменить HTML одной из них. */
  const sample = (change?: (path: string) => string | undefined) =>
    CRAWL_ICON_NAMES.flatMap((name) =>
      ["", "/ru"].map((lang) => {
        const path = `${lang}${iconPath(name)}`;
        const mark =
          name === HIDDEN_ICON ? (lang ? "Устарела" : "Deprecated") : "";
        return page(
          path,
          change?.(path) ?? iconHtml(name, `c-${setOf(name)}`, mark),
        );
      }),
    );

  it("заголовок, превью, метки, мокапы; у скрытой — «Устарела»", () => {
    expect(iconPagesProblems(sample())).toEqual([]);
  });

  it("нет мокапов, нет «Устарела» или страница не открыта — проблема", () => {
    const noMockups = sample((path) =>
      path === "/lucide/house"
        ? iconHtml("lucide:house", "c-lucide").replaceAll("data-mockup", "x")
        : undefined,
    );
    expect(iconPagesProblems(noMockups)).toEqual([
      `/lucide/house: нет ${MOCKUPS} мокапов`,
    ]);
    const hidden = `/ru${iconPath(HIDDEN_ICON)}`;
    const notHidden = sample((path) =>
      path === hidden ? iconHtml(HIDDEN_ICON, "c-lucide") : undefined,
    );
    expect(iconPagesProblems(notHidden)).toEqual([`${hidden}: нет «Устарела»`]);
    expect(iconPagesProblems(sample().slice(1))[0]).toBe(
      "/lucide/house: не открыта",
    );
  });

  it("отпечатки: страницы набора на двух языках и его иконки — как в каталоге", () => {
    const sets = Object.fromEntries(
      CRAWL_ICON_NAMES.map((name) => [
        setOf(name),
        { content: `c-${setOf(name)}` },
      ]),
    );
    const setPages = Object.keys(sets).flatMap((id) => [
      page(`/${id}`, iconHtml(`${id}:x`, `c-${id}`)),
      page(`/ru/${id}`, iconHtml(`${id}:x`, `c-${id}`)),
    ]);
    expect(contentVerdict([...sample(), ...setPages], sets).ok).toBe(true);
    const stale = [...sample(), ...setPages].map((p) =>
      p.path === "/ru/ph" ? page("/ru/ph", iconHtml("ph:x", "old")) : p,
    );
    const verdict = contentVerdict(stale, sets);
    expect(verdict.ok).toBe(false);
    expect(verdict.note).toContain("/ru/ph: old, а в каталоге c-ph");
  });
});

describe("robots.txt живого сайта (ADR-0039)", () => {
  // Так Next.js пишет правила apps/site/app/robots.ts до запуска (сокращённый список ботов).
  const beforeLaunch = [
    "User-Agent: GPTBot",
    "User-Agent: ClaudeBot",
    "User-Agent: CCBot",
    "Disallow: /",
    "",
    "User-Agent: *",
    "Allow: /",
    "",
  ].join("\n");
  const openToAll = "User-Agent: *\nAllow: /\n";

  it("до запуска: поисковикам открыт, ИИ-обходчикам закрыт", () => {
    expect(robotsBlocksAll(beforeLaunch, "Googlebot")).toBe(false);
    expect(robotsBlocksAll(beforeLaunch, "GPTBot")).toBe(true);
    expect(robotsBlocksAll(beforeLaunch, "gptbot")).toBe(true);
    expect(robotsTxtVerdict(beforeLaunch, false)).toEqual({
      ok: true,
      note: "поисковикам обход открыт — увидят noindex; ИИ-обходчикам закрыт до запуска",
    });
    // Фаза 7: AI_CRAWLERS_OPEN = true, а файл всё ещё закрыт — заметно.
    expect(robotsTxtVerdict(beforeLaunch, true).ok).toBe(false);
  });

  it("всем открыт: до запуска — проблема, после — норма", () => {
    expect(robotsTxtVerdict(openToAll, false)).toEqual({
      ok: false,
      note: "ИИ-обходчикам обход открыт до запуска: у GPTBot нет Disallow: / (ADR-0039)",
    });
    expect(robotsTxtVerdict(openToAll, true).ok).toBe(true);
  });

  it("закрыт всем — поисковик не увидит noindex", () => {
    const closed = "user-agent: * # все\ndisallow: /\n";
    expect(robotsBlocksAll(closed, "Googlebot")).toBe(true);
    expect(robotsTxtVerdict(closed, false)).toEqual({
      ok: false,
      note: "обход закрыт поисковикам — они не увидят noindex",
    });
  });
});
