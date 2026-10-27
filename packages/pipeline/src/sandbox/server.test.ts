import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IMPORT_MAP, IMPORT_MAP_HASH } from "./page.js";
import { apiHost, reply, type SandboxContext, visibleNames } from "./server.js";

let root: string;
let ctx: SandboxContext;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-sandbox-"));
  const coreDir = join(root, "core");
  await mkdir(coreDir);
  await writeFile(join(coreDir, "index.js"), "export const core = 1;");
  await writeFile(join(root, "client.js"), "console.log(1);");
  await writeFile(join(root, "secret.js"), "не отдавать");
  ctx = {
    port: 4282,
    coreDir,
    clientFile: join(root, "client.js"),
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

  it("страница: CSP со своим хэшем import map и хостом API, имена — блоком JSON", async () => {
    const r = await reply(ctx, "GET", "/", HOST);
    expect(r.status).toBe(200);
    expect(r.type).toBe("text/html; charset=utf-8");
    const html = body(r);
    const hash = createHash("sha256").update(IMPORT_MAP).digest("base64");
    expect(IMPORT_MAP_HASH).toBe(`sha256-${hash}`);
    expect(html).toContain(
      `script-src &#39;self&#39; &#39;sha256-${hash}&#39;`,
    );
    expect(html).toContain("connect-src https://api.iconavo.dev;");
    expect(html).toContain(`<script type="importmap">${IMPORT_MAP}</script>`);
    expect(html).toContain('"lucide":["heart","house"]');
    expect(html).toContain('<script type="module" src="/sandbox.js">');
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
    const bad = await reply(
      ctx,
      "GET",
      `/?api=${encodeURIComponent("https://evil.example")}`,
      HOST,
    );
    expect(bad.status).toBe(400);
  });

  it("скрипт страницы и файлы ядра — как JS; за пределы папки ядра не выйти", async () => {
    const client = await reply(ctx, "GET", "/sandbox.js", HOST);
    expect(client.type).toBe("text/javascript; charset=utf-8");
    expect(body(client)).toBe("console.log(1);");
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
