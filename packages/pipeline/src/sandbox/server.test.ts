import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { esc } from "../report/html.js";
import { MANY_STYLE, manyImportMap } from "./many-page.js";
import { cspHash, IMPORT_MAP, IMPORT_MAP_HASH, sandboxHosts } from "./page.js";
import { VARIANTS } from "./render-page.js";
import {
  apiHost,
  reply,
  type SandboxContext,
  scriptDelay,
  visibleNames,
} from "./server.js";
import { TAG_IMPORT_MAP, TAG_STYLE, UNDEFINED_RULE } from "./tag-page.js";

let root: string;
let ctx: SandboxContext;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-sandbox-"));
  const coreDir = join(root, "core");
  const iconDir = join(root, "icon");
  await mkdir(coreDir);
  await mkdir(iconDir);
  await writeFile(join(coreDir, "index.js"), "export const core = 1;");
  await writeFile(join(iconDir, "index.js"), "export const icon = 1;");
  await writeFile(join(iconDir, "iconavo-icon.js"), "export const script = 1;");
  await writeFile(join(root, "client.js"), "console.log(1);");
  await writeFile(join(root, "render-client.js"), "console.log(2);");
  await writeFile(join(root, "tag-client.js"), "console.log(3);");
  await writeFile(join(root, "many-client.js"), "console.log(4);");
  await writeFile(join(root, "secret.js"), "не отдавать");
  ctx = {
    port: 4282,
    coreDir,
    iconDir,
    clientFile: join(root, "client.js"),
    renderFile: join(root, "render-client.js"),
    tagFile: join(root, "tag-client.js"),
    manyFile: join(root, "many-client.js"),
    names: { lucide: ["heart", "house"], ph: ["x"] },
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const HOST = "127.0.0.1:4282";
const body = (r: { body: string | Uint8Array }) =>
  typeof r.body === "string" ? r.body : Buffer.from(r.body).toString("utf8");

describe("сервер песочницы", () => {
  it("только адрес этого сервера и только GET", async () => {
    expect((await reply(ctx, "GET", "/", "evil.example:4282")).status).toBe(
      403,
    );
    expect((await reply(ctx, "GET", "/", undefined)).status).toBe(403);
    expect((await reply(ctx, "POST", "/", HOST)).status).toBe(405);
    expect((await reply(ctx, "GET", "/", "localhost:4282")).status).toBe(200);
  });

  it("страница: CSP со своим хэшем import map и хостами ядра, имена — блоком JSON", async () => {
    const r = await reply(ctx, "GET", "/", HOST);
    expect(r.status).toBe(200);
    expect(r.type).toBe("text/html; charset=utf-8");
    const html = body(r);
    const hash = createHash("sha256").update(IMPORT_MAP).digest("base64");
    expect(IMPORT_MAP_HASH).toBe(`sha256-${hash}`);
    expect(html).toContain(
      `script-src &#39;self&#39; &#39;sha256-${hash}&#39;`,
    );
    expect(html).toContain(
      "connect-src https://api.iconavo.dev https://cdn.iconavo.dev https://cdn2.iconavo.dev https://iconavo.b-cdn.net;",
    );
    expect(html).toContain(`<script type="importmap">${IMPORT_MAP}</script>`);
    expect(html).toContain('"lucide":["heart","house"]');
    expect(html).toContain('<script type="module" src="/sandbox.js">');
  });

  it("условия сети: сценарии, хост за хостом в порядке ядра, иконки, которых нет", async () => {
    const html = body(await reply(ctx, "GET", "/", HOST));
    for (const preset of ["ok", "primary", "slow", "silent"]) {
      expect(html).toContain(`data-preset="${preset}"`);
    }
    const hosts = [...html.matchAll(/data-host="([^"]+)"/g)].map((m) => m[1]);
    expect(hosts).toEqual([
      "https://api.iconavo.dev",
      "https://cdn.iconavo.dev",
      "https://cdn2.iconavo.dev",
      "https://iconavo.b-cdn.net",
    ]);
    expect(html).toContain('<option value="slow">медленный (+2 с)</option>');
    expect(html).toContain(
      '"missing":["lucide:no-such-icon","nope:house","Lucide:House"]',
    );
    expect(html).toContain('id="missing"');
    expect(html).toContain(
      "API молчит 1,5 с — тот же запрос уходит и на статику; хост статики молчит 750 мс",
    );
    expect(html).toContain("повторяется через 1, 2 и 4 с");
  });

  it("хосты режима: живой — хосты ядра по умолчанию, превью — API и статика превью", () => {
    expect(sandboxHosts("https://api.iconavo.dev")).toEqual([
      { url: "https://api.iconavo.dev", kind: "api" },
      { url: "https://cdn.iconavo.dev", kind: "cdn" },
      { url: "https://cdn2.iconavo.dev", kind: "cdn" },
      { url: "https://iconavo.b-cdn.net", kind: "cdn" },
    ]);
    expect(sandboxHosts("http://127.0.0.1:4281")).toEqual([
      { url: "http://127.0.0.1:4281", kind: "api" },
      { url: "http://127.0.0.1:4281/_static", kind: "cdn" },
    ]);
  });

  it("хост API: живой или превью на 127.0.0.1, другое — 400", async () => {
    expect(apiHost(null)).toBe("https://api.iconavo.dev");
    expect(apiHost("")).toBe("https://api.iconavo.dev");
    expect(apiHost("http://127.0.0.1:4281")).toBe("http://127.0.0.1:4281");
    expect(apiHost("https://evil.example")).toBeNull();
    expect(apiHost("http://127.0.0.1:4281/x")).toBeNull();
    expect(apiHost("http://localhost:4281")).toBeNull();
    const local = await reply(
      ctx,
      "GET",
      `/?api=${encodeURIComponent("http://127.0.0.1:4281")}`,
      HOST,
    );
    expect(body(local)).toContain("connect-src http://127.0.0.1:4281;");
    expect(body(local)).toContain('data-host="http://127.0.0.1:4281/_static"');
    const bad = await reply(
      ctx,
      "GET",
      `/?api=${encodeURIComponent("https://evil.example")}`,
      HOST,
    );
    expect(bad.status).toBe(400);
  });

  it("страница рендера: та же CSP, свой скрипт, набор sandbox блоком JSON, все разделы", async () => {
    const r = await reply(ctx, "GET", "/render", HOST);
    expect(r.status).toBe(200);
    const html = body(r);
    expect(html).toContain(
      `script-src &#39;self&#39; &#39;${IMPORT_MAP_HASH}&#39;`,
    );
    expect(html).toContain(
      "connect-src https://api.iconavo.dev https://cdn.iconavo.dev https://cdn2.iconavo.dev https://iconavo.b-cdn.net;",
    );
    expect(html).toContain('<script type="module" src="/render.js">');
    expect(html).toContain('"prefix":"sandbox"');
    for (const section of VARIANTS) {
      expect(html).toContain(`<section id="${section.id}">`);
    }
    expect(html).toContain('data-icon="lucide:trash" data-label="Удалить"');
    expect(html).toContain("Win + Ctrl + Enter");
  });

  it("ссылки между страницами — с тем же хостом API", async () => {
    const main = body(await reply(ctx, "GET", "/", HOST));
    expect(main).toContain(
      '<b>Загрузка и сеть</b> · <a href="/render">Рендер</a>',
    );
    const preview = encodeURIComponent("http://127.0.0.1:4281");
    const render = body(
      await reply(ctx, "GET", `/render?api=${preview}`, HOST),
    );
    expect(render).toContain(
      `<a href="/?api=${preview}">Загрузка и сеть</a> · <b>Рендер</b>`,
    );
    expect(render).toContain("connect-src http://127.0.0.1:4281;");
    const bad = await reply(
      ctx,
      "GET",
      `/render?api=${encodeURIComponent("https://evil.example")}`,
      HOST,
    );
    expect(bad.status).toBe(400);
  });

  it("скрипт страницы и файлы ядра — как JS; за пределы папки ядра не выйти", async () => {
    const client = await reply(ctx, "GET", "/sandbox.js", HOST);
    expect(client.type).toBe("text/javascript; charset=utf-8");
    expect(body(client)).toBe("console.log(1);");
    expect(body(await reply(ctx, "GET", "/render.js", HOST))).toBe(
      "console.log(2);",
    );
    const core = await reply(ctx, "GET", "/core/index.js", HOST);
    expect(core.status).toBe(200);
    expect(body(core)).toBe("export const core = 1;");
    for (const path of [
      "/core/../secret.js",
      "/core/..%2Fsecret.js",
      "/core/missing.js",
      "/core/Index.js",
      "/secret.js",
    ]) {
      expect((await reply(ctx, "GET", path, HOST)).status, path).toBe(404);
    }
  });

  it("страницы тега и 5000 иконок: строгая CSP — хэши import map и стиля, Trusted Types, без атрибутов style", async () => {
    const tag = body(await reply(ctx, "GET", "/tag", HOST));
    const many = body(await reply(ctx, "GET", "/many", HOST));
    const pages: [string, string, string, string][] = [
      [tag, TAG_IMPORT_MAP, TAG_STYLE, "/tag.js"],
      [many, manyImportMap(false), MANY_STYLE, "/many.js"],
    ];
    for (const [html, importMap, style, script] of pages) {
      expect(html).toContain(
        esc(
          `default-src 'none'; script-src 'self' '${cspHash(importMap)}'; connect-src https://api.iconavo.dev https://cdn.iconavo.dev https://cdn2.iconavo.dev https://iconavo.b-cdn.net; img-src data:; style-src '${cspHash(style)}'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types iconavo`,
        ),
      );
      expect(html).toContain(`<style>${style}</style>`);
      expect(html).toContain(`<script type="importmap">${importMap}</script>`);
      expect(html).toContain(`<script type="module" src="${script}">`);
      expect(style).toContain(UNDEFINED_RULE);
      expect(html).not.toMatch(/\sstyle="/);
    }
    for (const id of [
      "copies",
      "placeholders",
      "missing",
      "label",
      "inline",
      "color",
      "attributes",
    ]) {
      expect(tag).toContain(`<section id="${id}">`);
    }
    expect(JSON.parse(TAG_IMPORT_MAP).imports["@iconavo-ui/icon"]).toBe(
      "/icon/index.js",
    );
    expect(many.match(/<iconavo-icon /g)).toHaveLength(3);
    expect(many).toContain(
      '<div class="c"><iconavo-icon icon="lucide:heart"></iconavo-icon><span>heart</span></div>',
    );
    expect(many).toContain('<a href="/many?slow-script=1">');
  });

  it("медленный скрипт и превью: адрес скрипта с задержкой, ссылки с тем же хостом API", async () => {
    const preview = encodeURIComponent("http://127.0.0.1:4281");
    const html = body(
      await reply(ctx, "GET", `/many?api=${preview}&slow-script=1`, HOST),
    );
    expect(html).toContain(
      `<script type="importmap">${manyImportMap(true)}</script>`,
    );
    expect(manyImportMap(true)).toContain("/icon/iconavo-icon.js?delay=2000");
    expect(html).toContain("connect-src http://127.0.0.1:4281;");
    expect(html).toContain(
      `<a href="/many?api=${preview}">скрипт без задержки</a>`,
    );
    expect(html).toContain(`<a href="/tag?api=${preview}">Тег</a>`);
  });

  it("файлы пакета тега — из его dist; скрипт по ?delay= приходит позже, не дольше 10 с", async () => {
    const script = await reply(ctx, "GET", "/icon/iconavo-icon.js", HOST);
    expect(script.type).toBe("text/javascript; charset=utf-8");
    expect(body(script)).toBe("export const script = 1;");
    expect(body(await reply(ctx, "GET", "/icon/index.js", HOST))).toBe(
      "export const icon = 1;",
    );
    expect(body(await reply(ctx, "GET", "/tag.js", HOST))).toBe(
      "console.log(3);",
    );
    expect(body(await reply(ctx, "GET", "/many.js", HOST))).toBe(
      "console.log(4);",
    );
    for (const path of [
      "/icon/../secret.js",
      "/icon/missing.js",
      "/icon/Index.js",
    ]) {
      expect((await reply(ctx, "GET", path, HOST)).status, path).toBe(404);
    }
    expect(scriptDelay("2000")).toBe(2000);
    expect(scriptDelay("99999")).toBe(10_000);
    expect(scriptDelay("x")).toBe(0);
    expect(scriptDelay(null)).toBe(0);
    const start = Date.now();
    await reply(ctx, "GET", "/icon/iconavo-icon.js?delay=60", HOST);
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });

  it("видимые имена набора: без скрытых, по кодам символов", async () => {
    const dataDir = join(root, "data");
    await mkdir(join(dataDir, "demo"), { recursive: true });
    await writeFile(
      join(dataDir, "demo", "icons.json"),
      JSON.stringify({
        prefix: "demo",
        icons: {
          house: { body: "<g/>" },
          "arrow-2": { body: "<g/>" },
          arrow: { body: "<g/>" },
          old: { body: "<g/>", hidden: true },
        },
        aliases: { home: { parent: "house" } },
      }),
    );
    expect(await visibleNames(dataDir, "demo")).toEqual([
      "arrow",
      "arrow-2",
      "house",
    ]);
  });
});
