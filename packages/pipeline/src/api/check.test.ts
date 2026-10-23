// Проверка живого API на настоящем обработчике функции (apps/api) с поддельными R2 и сетью: статика
// отдаёт те же файлы, что лежат в «бакете», а «Cloudflare» добавляет Server и сжатие.

import { describe, expect, it } from "vitest";
import {
  fakeBucket,
  fakeCache,
  manifestText,
  nameFileText,
  waiter,
} from "../../../../apps/api/src/fake.testing.js";
import { createHandler } from "../../../../apps/api/src/handler.js";
import type { FetchFn } from "../sources/npm.js";
import { apiCheckFailed, checkApi } from "./check.js";
import { formatApiCheckSummary } from "./check-report.js";
import { API_HOST, STATIC_HOST } from "./config.js";

const V = "0123abcd";
const OLD = "00000000";
const HEART = '<path fill="none" stroke="currentColor" d="M1 1"/>';
const HOUSE = '<path fill="currentColor" d="M2 2"/>';
const HEART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">${HEART}</svg>`;

function world(
  o: { apiVersion?: string; compress?: boolean; staticSvg?: string } = {},
) {
  const files: Record<string, string> = {
    "manifest.json": manifestText({ lucide: V }),
    [`v/${V}/lucide/heart.json`]: nameFileText("lucide", {
      heart: { body: HEART },
    }),
    [`v/${V}/lucide/home.json`]: nameFileText(
      "lucide",
      { house: { body: HOUSE } },
      { home: { parent: "house" } },
    ),
    [`v/${V}/lucide/heart.svg`]: o.staticSvg ?? HEART_SVG,
  };
  for (const [key, text] of Object.entries(files)) {
    if (key.startsWith(`v/${V}/`)) files[key.replace(V, OLD)] = text;
  }
  const bucket = fakeBucket({
    ...files,
    "manifest.json": manifestText({ lucide: o.apiVersion ?? V }),
  });
  let time = 0;
  const handler = createHandler({
    bucket,
    cache: fakeCache(),
    build: "b1",
    now: () => time,
  });
  const w = waiter();
  const fetchFn: FetchFn = async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol === "http:") {
      return new Response(null, {
        status: 301,
        headers: {
          location: `https://${url.host}${url.pathname}${url.search}`,
        },
      });
    }
    if (url.host === STATIC_HOST) {
      const text = files[url.pathname.slice(1)];
      return new Response(text ?? "", {
        status: text === undefined ? 404 : 200,
      });
    }
    if (url.host !== API_HOST) throw new TypeError("fetch failed");
    const res = await handler(new Request(url), w.waitUntil);
    await w.flush();
    const headers = new Headers(res.headers);
    headers.set("server", "cloudflare");
    const accepts = new Headers(init?.headers).get("accept-encoding") ?? "";
    if (res.status === 200 && o.compress !== false && accepts !== "") {
      headers.set("content-encoding", accepts.includes("br") ? "br" : "gzip");
    }
    return new Response(res.body, { status: res.status, headers });
  };
  return {
    bucket,
    fetchFn,
    clock: {
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
    },
  };
}

describe("checkApi", () => {
  it("всё сходится со статикой — ок, повтор из кэша", async () => {
    const w = world();
    const report = await checkApi({ fetch: w.fetchFn, ...w.clock });
    const issues = report.targets.flatMap((t) =>
      t.issues.map((i) => `${t.path}: ${i.message}`),
    );
    expect(issues).toEqual([]);
    expect(report.stop).toEqual([]);
    expect(apiCheckFailed(report)).toBe(false);
    expect(report.version).toBe(V);
    expect(report.build).toBe("b1");
    expect(report.targets.map((t) => t.kind)).toEqual([
      "batch",
      "batch-order",
      "svg",
      "svg-params",
      "svg-transform",
      "css",
      "missing-set",
      "missing-icon",
      "redirect",
    ]);
    expect(formatApiCheckSummary(report).at(-1)).toMatch(/^Итог: ок/);
  });

  it("ждёт, пока функция перечитает манифест и отдаст новую версию", async () => {
    const w = world({ apiVersion: OLD });
    // Функция уже держит в памяти прежний манифест…
    await w.fetchFn(`https://${API_HOST}/lucide/heart.svg`);
    // …а выкладка дописала новый: функция увидит его через минуту.
    w.bucket.files.set("manifest.json", manifestText({ lucide: V }));
    const report = await checkApi({ fetch: w.fetchFn, ...w.clock });
    expect(apiCheckFailed(report)).toBe(false);
    expect(report.waitedMs).toBeGreaterThanOrEqual(60_000);
  });

  it("не та сборка за отведённое время — СТОП", async () => {
    const w = world();
    const report = await checkApi({
      fetch: w.fetchFn,
      ...w.clock,
      expectBuild: "b2b2b2b2",
      waitMs: 30_000,
      waitStepMs: 10_000,
    });
    expect(report.stop[0]).toMatch(/сборкой b2b2b2b2 за 30 с/);
    expect(report.targets.map((t) => t.kind)).toEqual(["redirect"]);
    expect(apiCheckFailed(report)).toBe(true);
  });

  it("SVG не равен статике и нет сжатия — не так, с подсказкой", async () => {
    const w = world({ staticSvg: "<svg/>", compress: false });
    const report = await checkApi({ fetch: w.fetchFn, ...w.clock });
    const svg = report.targets.find((t) => t.kind === "svg");
    expect(svg?.issues.map((i) => i.group)).toEqual(
      expect.arrayContaining(["body", "encoding"]),
    );
    const summary = formatApiCheckSummary(report).join("\n");
    expect(summary).toContain("Где поправить:");
    expect(summary).toContain("Compression Rules");
    expect(summary).toMatch(/Итог: не так/);
  });

  it("API не отвечает — СТОП после ожидания", async () => {
    const w = world();
    const down: FetchFn = (input, init) =>
      new URL(String(input)).host === API_HOST
        ? Promise.reject(new TypeError("fetch failed"))
        : w.fetchFn(input, init);
    const report = await checkApi({
      fetch: down,
      ...w.clock,
      waitMs: 1_000,
    });
    expect(report.stop[0]).toMatch(/сбой сети/);
    expect(apiCheckFailed(report)).toBe(true);
  });

  it("манифест не прочитан — СТОП без запросов к пачкам", async () => {
    const w = world();
    const report = await checkApi({
      fetch: w.fetchFn,
      ...w.clock,
      manifest: "{}",
    });
    expect(report.stop[0]).toMatch(/нет набора «lucide»/);
    expect(report.targets.map((t) => t.kind)).toEqual(["redirect"]);
  });
});
