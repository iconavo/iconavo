import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  reply,
  startVisualServer,
  type VisualServerContext,
} from "./server.js";

let root: string;
let ctx: VisualServerContext;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-visual-"));
  ctx = {
    clientFile: join(root, "client.js"),
    iconScript: join(root, "iconavo-icon.js"),
  };
  await writeFile(ctx.clientFile, "console.log(1);");
  await writeFile(ctx.iconScript, "export const icon = 1;");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const text = (r: { body: string | Uint8Array }) =>
  typeof r.body === "string" ? r.body : Buffer.from(r.body).toString("utf8");

describe("сервер визуального сравнения", () => {
  it("только адрес этого сервера и только GET; страницы — из прогона, скрипты — два файла", async () => {
    const pages = new Map([["/page/0", "<p>кусок</p>"]]);
    const get = (url: string, host = "127.0.0.1:5000", method = "GET") =>
      reply(ctx, pages, 5000, method, url, host);
    expect((await get("/page/0", "evil.example:5000")).status).toBe(403);
    expect(
      (await reply(ctx, pages, 5000, "GET", "/page/0", undefined)).status,
    ).toBe(403);
    expect((await get("/page/0", "127.0.0.1:5000", "POST")).status).toBe(405);
    expect(text(await get("/page/0"))).toBe("<p>кусок</p>");
    expect((await get("/page/1")).status).toBe(404);
    expect(text(await get("/visual.js"))).toBe("console.log(1);");
    const script = await get("/icon/iconavo-icon.js");
    expect(script.type).toBe("text/javascript; charset=utf-8");
    expect(text(script)).toBe("export const icon = 1;");
    for (const path of ["/icon/../secret.js", "/page/x", "/client.js", "/"]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("страница живёт от put до drop", async () => {
    const server = await startVisualServer(ctx);
    try {
      const path = server.put("<p>раз</p>");
      const first = await fetch(`${server.base}${path}`);
      expect(await first.text()).toBe("<p>раз</p>");
      expect(first.headers.get("cache-control")).toBe("no-store");
      server.drop(path);
      expect((await fetch(`${server.base}${path}`)).status).toBe(404);
      expect(server.put("<p>два</p>")).not.toBe(path);
    } finally {
      await server.close();
    }
  });
});
