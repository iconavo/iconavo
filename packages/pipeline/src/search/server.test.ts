import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCatalog, setDocs } from "./catalog.js";
import { demoConfig, loadedSet } from "./fixture.testing.js";
import { allowedHost, reply, type SearchContext } from "./server.js";
import { buildTextIndex } from "./text.js";

const config = demoConfig("demo");
const catalog = buildCatalog([
  {
    config,
    docs: setDocs(
      config,
      loadedSet({
        id: "demo",
        icons: [
          { name: "trash", en: ["trash"], ru: ["корзина"] },
          { name: "house", en: ["home"], ru: ["дом"] },
        ],
      }),
    ),
  },
]);

let root: string;
let ctx: SearchContext;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-page-"));
  const reportsDir = join(root, "reports");
  await mkdir(join(reportsDir, "eval"), { recursive: true });
  await writeFile(join(reportsDir, "eval", "index.html"), "<p>замер</p>");
  await writeFile(join(root, "secret.txt"), "не отдавать");
  ctx = {
    port: 4280,
    catalog,
    text: buildTextIndex(catalog.docs.map((d) => d.words)),
    models: [],
    settings: {},
    queryDir: join(root, "queries"),
    reportsDir,
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const HOST = "127.0.0.1:4280";
const body = (r: { body: string | Uint8Array }) =>
  typeof r.body === "string" ? r.body : Buffer.from(r.body).toString("utf8");

describe("страница поиска", () => {
  it("только адрес этого сервера: чужой Host — отказ", async () => {
    expect(allowedHost("127.0.0.1:4280", 4280)).toBe(true);
    expect(allowedHost("localhost:4280", 4280)).toBe(true);
    expect(allowedHost("evil.example:4280", 4280)).toBe(false);
    expect(allowedHost(undefined, 4280)).toBe(false);
    const r = await reply(ctx, "GET", "/?q=trash", "evil.example");
    expect(r.status).toBe(403);
  });

  it("только GET", async () => {
    expect((await reply(ctx, "POST", "/", HOST)).status).toBe(405);
  });

  it("пустой запрос — форма с подсказкой", async () => {
    const r = await reply(ctx, "GET", "/", HOST);
    expect(r.status).toBe(200);
    expect(body(r)).toContain('<form method="get" action="/">');
    expect(body(r)).not.toContain("<ol>");
  });

  it("запрос экранируется, точное имя — первым, без ключа — пометка «только текст»", async () => {
    const r = await reply(
      ctx,
      "GET",
      `/?q=${encodeURIComponent("trash <script>alert(1)</script>")}`,
      HOST,
    );
    const html = body(r);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Нет ключа POLZA_API_KEY");
    const first = html.indexOf("<code>demo:trash</code>");
    expect(first).toBeGreaterThan(-1);
  });

  it("русский запрос находит иконку по синониму", async () => {
    const html = body(await reply(ctx, "GET", "/?q=корзина&mode=text", HOST));
    expect(html).toContain("<code>demo:trash</code>");
    expect(html).toContain("(синонимы)");
  });

  it("отчёты — из папки отчётов, наружу — нельзя", async () => {
    const ok = await reply(ctx, "GET", "/reports/eval/index.html", HOST);
    expect(ok.status).toBe(200);
    expect(body(ok)).toBe("<p>замер</p>");
    const out = await reply(ctx, "GET", "/reports/..%2Fsecret.txt", HOST);
    expect(out.status).toBe(404);
    expect(
      (await reply(ctx, "GET", "/reports/eval/nope.html", HOST)).status,
    ).toBe(404);
    expect((await reply(ctx, "GET", "/other", HOST)).status).toBe(404);
  });
});
