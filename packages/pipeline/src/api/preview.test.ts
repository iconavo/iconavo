import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeCdnDemoSet } from "../cdn/fixture.testing.js";
import { buildCdn } from "../cdn/run.js";
import { demoConfig } from "../search/fixture.testing.js";
import { type ApiPreview, startApiPreview } from "./preview.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const HOUSE = '<path fill="currentColor" d="M1 1h2"/>';

let tmp: string;
let cdnDir: string;
let version: string;
let preview: ApiPreview;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "iconavo-api-preview-"));
  const dataDir = join(tmp, "data");
  cdnDir = join(tmp, "dist-cdn");
  version = (
    await writeCdnDemoSet(dataDir, {
      id: "demo",
      icons: { house: { body: HOUSE } },
      aliases: { home: { parent: "house" } },
    })
  ).version;
  await buildCdn([demoConfig("demo")], {
    dataDir,
    outDir: cdnDir,
    concurrency: 2,
  });
  preview = await startApiPreview({
    root: ROOT,
    outDir: join(tmp, "dist-api"),
    cdnDir,
    port: 0,
  });
});

afterAll(async () => {
  await preview?.close();
  await rm(tmp, { recursive: true, force: true });
});

const url = (path: string) => `http://127.0.0.1:${preview.port}${path}`;

/** Запрос с чужим заголовком Host: fetch его не позволяет. */
const statusWithHost = (host: string) =>
  new Promise<number>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: preview.port, path: "/", headers: { host } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });

describe("превью edge API", () => {
  it("функция из бандла отвечает пачкой по данным dist-cdn/", async () => {
    const res = await fetch(url("/demo.json?icons=home,missing"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-iconavo-version")).toBe(version);
    expect(res.headers.get("x-iconavo-build")).toBe(preview.build);
    const json = await res.json();
    expect(json.icons.house.body).toBe(HOUSE);
    expect(json.aliases.home).toEqual({ parent: "house" });
    expect(json.not_found).toEqual(["missing"]);
  });

  it("SVG без параметров — побайтно файл статики, и он же по /_static/", async () => {
    const file = await readFile(
      join(cdnDir, "v", version, "demo", "house.svg"),
      "utf8",
    );
    expect(await (await fetch(url("/demo/house.svg"))).text()).toBe(file);
    expect(
      await (await fetch(url(`/_static/v/${version}/demo/house.svg`))).text(),
    ).toBe(file);
  });

  it("HEAD — без тела; браузер ответы превью не хранит", async () => {
    const res = await fetch(url("/demo/house.svg"), { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("страница для глаз и 403 для чужого Host", async () => {
    const page = await fetch(url("/"));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<h1>Edge API — превью</h1>");
    expect(await statusWithHost("evil.example")).toBe(403);
    expect(await statusWithHost(`127.0.0.1:${preview.port}`)).toBe(200);
  });
});
