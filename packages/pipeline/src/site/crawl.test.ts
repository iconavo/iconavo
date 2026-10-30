import { describe, expect, it } from "vitest";
import {
  anchorsOf,
  type CrawledPage,
  counterpartOf,
  freshnessVerdict,
  headersVerdict,
  headingsOf,
  htmlLang,
  idsOf,
  langVerdict,
  linksVerdict,
  parseCsp,
  readmeSections,
  robotsMetaVerdict,
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
