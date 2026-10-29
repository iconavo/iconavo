import { describe, expect, it } from "vitest";
import {
  anchorsOf,
  type CrawledPage,
  headersVerdict,
  headingsOf,
  idsOf,
  linksVerdict,
  parseCsp,
  readmeSections,
  robotsMetaVerdict,
  sectionsVerdict,
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

  it("каждый раздел — ровно на одной странице документации", () => {
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
