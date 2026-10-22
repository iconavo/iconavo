import { describe, expect, it } from "vitest";
import type { FetchFn } from "../sources/npm.js";
import { type CheckReport, checkCdn, checkFailed } from "./check.js";
import {
  CACHE_IMMUTABLE,
  CACHE_MANIFEST,
  MANIFEST_FILE,
  SVG_CSP,
} from "./config.js";
import { type CdnFile, checksumsText, manifestText } from "./files.js";
import { sha256Hex } from "./sigv4.js";
import { contentTypeOf } from "./upload.js";

const HOST = "cdn.test";
const VERSION = "abcd1234";
const SUMS = `v/${VERSION}/demo.checksums.json`;
const JSON_PATH = `v/${VERSION}/demo/house.json`;
const SVG_PATH = `v/${VERSION}/demo/house.svg`;
const MISSING = `v/${VERSION}/demo/_missing.json`;

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const file = (path: string, text: string): CdnFile => {
  const data = bytes(text);
  return { path, data, sha256: sha256Hex(data) };
};
const ICON_FILES = [
  file(
    "demo/house.json",
    '{"icons":{"house":{"body":"<g/>"}},"prefix":"demo"}',
  ),
  file(
    "demo/house.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g/></svg>',
  ),
];

/** Содержимое «бакета»: путь от корня хоста → файл. */
function bucket(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set(
    MANIFEST_FILE,
    bytes(manifestText([{ id: "demo", version: VERSION, lastModified: 1 }])),
  );
  files.set(
    SUMS,
    bytes(checksumsText({ id: "demo", version: VERSION }, ICON_FILES)),
  );
  for (const f of ICON_FILES) files.set(`v/${VERSION}/${f.path}`, f.data);
  return files;
}

interface FakeRequest {
  path: string;
  headers: Record<string, string>;
  redirect?: RequestRedirect;
}
interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}
/** Подправить ответ: другой ответ или ошибка fetch; undefined — как у настроенной раздачи. */
type Tweak = (req: FakeRequest, reply: Reply) => Reply | Error | undefined;

const without = (headers: Record<string, string>, ...names: string[]) =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => !names.includes(name)),
  );

/** Ответ раздачи, настроенной по ADR-0023. */
function goodReply(files: Map<string, Uint8Array>, req: FakeRequest): Reply {
  const common: Record<string, string> = {
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "cross-origin",
  };
  if (req.path.endsWith(".svg")) common["content-security-policy"] = SVG_CSP;
  const body = files.get(req.path);
  if (body === undefined) {
    return {
      status: 404,
      headers: { ...common, "content-type": "text/html" },
      body: bytes("<!doctype html><title>Not Found</title>"),
    };
  }
  const manifest = req.path === MANIFEST_FILE;
  return {
    status: 200,
    headers: {
      ...common,
      "content-type": contentTypeOf(req.path),
      "cache-control": manifest ? CACHE_MANIFEST : CACHE_IMMUTABLE,
      "cf-cache-status": manifest ? "DYNAMIC" : "HIT",
      "content-encoding": req.headers["accept-encoding"]?.startsWith("br")
        ? "br"
        : "gzip",
    },
    body,
  };
}

/** Подменный fetch: отвечает по адресу как настроенная раздача, запросы запоминаются. */
function fakeCdn(tweak: Tweak | undefined, files: Map<string, Uint8Array>) {
  const requests: FakeRequest[] = [];
  const fn: FetchFn = async (input, init) => {
    const url = new URL(String(input));
    if (url.host !== HOST)
      throw new Error(`тест: неожиданный адрес ${url.href}`);
    const req: FakeRequest = {
      path: url.pathname.slice(1),
      headers: { ...(init?.headers as Record<string, string>) },
      redirect: init?.redirect,
    };
    requests.push(req);
    const good = goodReply(files, req);
    const reply = tweak?.(req, good) ?? good;
    if (!("body" in reply)) throw reply;
    return new Response(reply.body as BodyInit, {
      status: reply.status,
      headers: reply.headers,
    });
  };
  return { fetch: fn, requests };
}

async function check(tweak?: Tweak, files = bucket()) {
  const cdn = fakeCdn(tweak, files);
  const sleeps: number[] = [];
  const lines: string[] = [];
  const report = await checkCdn({
    host: HOST,
    set: "demo",
    icon: "house",
    fetch: cdn.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => 0,
    log: (line) => lines.push(line),
  });
  return { report, requests: cdn.requests, sleeps, lines };
}

const target = (r: CheckReport, path: string) =>
  r.targets.find((t) => t.path === path);
const issuesOf = (r: CheckReport, path: string) =>
  target(r, path)?.issues ?? [];
const groupsOf = (r: CheckReport, path: string) =>
  issuesOf(r, path).map((i) => i.group);

describe("checkCdn", () => {
  it("настроенная раздача: пять адресов «ок», девять запросов", async () => {
    const { report, requests, sleeps, lines } = await check();
    expect(checkFailed(report)).toBe(false);
    expect(report.version).toBe(VERSION);
    expect(report.stop).toEqual([]);
    expect(report.targets.map((t) => [t.kind, t.path, t.status])).toEqual([
      ["manifest", MANIFEST_FILE, 200],
      ["checksums", SUMS, 200],
      ["json", JSON_PATH, 200],
      ["svg", SVG_PATH, 200],
      ["missing", MISSING, 404],
    ]);
    expect(target(report, SVG_PATH)?.checked).toEqual([
      "status",
      "cors",
      "security",
      "type",
      "cache",
      "edge",
      "encoding",
      "body",
    ]);
    expect(target(report, MISSING)?.checked).toEqual([
      "status",
      "cors",
      "security",
    ]);
    expect(requests.map((r) => r.path)).toEqual([
      MANIFEST_FILE,
      MANIFEST_FILE,
      SUMS,
      SUMS,
      JSON_PATH,
      JSON_PATH,
      SVG_PATH,
      SVG_PATH,
      MISSING,
    ]);
    // Первый запрос — как у чужого сайта; второй — только gzip и без Origin.
    expect(requests[0]?.headers).toEqual({
      origin: "https://example.com",
      "accept-encoding": "br, gzip",
    });
    expect(requests[1]?.headers).toEqual({ "accept-encoding": "gzip" });
    expect(requests.every((r) => r.redirect === "manual")).toBe(true);
    expect(report.requests).toBe(9);
    expect(sleeps).toEqual([]);
    expect(lines).toEqual([
      `${MANIFEST_FILE} — ок`,
      `${SUMS} — ок`,
      `${JSON_PATH} — ок`,
      `${SVG_PATH} — ок`,
      `${MISSING} — ок`,
    ]);
  });

  it("до правил Cloudflare: нет CORS и защиты, JSON версии не кэшируется", async () => {
    const { report } = await check((req, reply) => {
      const headers = without(
        reply.headers,
        "access-control-allow-origin",
        "x-content-type-options",
        "cross-origin-resource-policy",
        "content-security-policy",
      );
      if (req.path === SUMS || req.path === JSON_PATH) {
        headers["cf-cache-status"] = "DYNAMIC";
      }
      return { ...reply, headers };
    });
    expect(checkFailed(report)).toBe(true);
    for (const t of report.targets) {
      expect(t.issues.filter((i) => i.group === "cors")).toEqual([
        {
          group: "cors",
          message: "Access-Control-Allow-Origin: нет вместо «*»",
        },
      ]);
    }
    expect(groupsOf(report, SUMS)).toContain("edge");
    expect(issuesOf(report, JSON_PATH)).toContainEqual({
      group: "edge",
      message:
        "файл не кэшируется на CDN: cf-cache-status «DYNAMIC» вместо HIT, MISS или похожего",
    });
    expect(groupsOf(report, SVG_PATH)).not.toContain("edge");
    expect(groupsOf(report, MANIFEST_FILE)).not.toContain("edge");
    expect(
      issuesOf(report, SVG_PATH)
        .filter((i) => i.group === "security")
        .map((i) => i.message),
    ).toEqual([
      "X-Content-Type-Options: нет вместо «nosniff»",
      "Cross-Origin-Resource-Policy: нет вместо «cross-origin»",
      `Content-Security-Policy: нет вместо «${SVG_CSP}»`,
    ]);
    // У JSON политика безопасности не нужна: её ставят только SVG.
    expect(
      issuesOf(report, JSON_PATH).filter((i) => i.group === "security"),
    ).toHaveLength(2);
    // Файлы на месте и совпадают с суммами.
    expect(groupsOf(report, SVG_PATH)).not.toContain("body");
  });

  it("CORS только на запрос с Origin — не так: копия в кэше CDN одна на всех", async () => {
    const { report } = await check((req, reply) =>
      req.path === SVG_PATH && req.headers.origin === undefined
        ? {
            ...reply,
            headers: without(reply.headers, "access-control-allow-origin"),
          }
        : undefined,
    );
    expect(issuesOf(report, SVG_PATH)).toEqual([
      {
        group: "cors",
        message:
          "Access-Control-Allow-Origin: нет вместо «*» на запрос без Origin",
      },
    ]);
  });

  it("манифест в кэше CDN — не так, MISS у файла версии — ок", async () => {
    const { report } = await check((req, reply) => {
      const edge =
        req.path === MANIFEST_FILE
          ? "HIT"
          : req.path === SVG_PATH
            ? "MISS"
            : "";
      return edge === ""
        ? undefined
        : { ...reply, headers: { ...reply.headers, "cf-cache-status": edge } };
    });
    expect(issuesOf(report, MANIFEST_FILE)).toEqual([
      {
        group: "edge",
        message:
          "манифест хранится в кэше CDN: cf-cache-status «HIT» вместо DYNAMIC или BYPASS",
      },
    ]);
    expect(issuesOf(report, SVG_PATH)).toEqual([]);
  });

  it("Cache-Control и Content-Type сравниваются точно", async () => {
    const { report } = await check((req, reply) => {
      if (req.path === MANIFEST_FILE) {
        return {
          ...reply,
          headers: {
            ...reply.headers,
            "cache-control": "public, max-age=14400",
          },
        };
      }
      if (req.path === SVG_PATH) {
        return {
          ...reply,
          headers: { ...reply.headers, "content-type": "image/svg+xml" },
        };
      }
      return undefined;
    });
    expect(issuesOf(report, MANIFEST_FILE)).toEqual([
      {
        group: "cache",
        message:
          "Cache-Control: «public, max-age=14400» вместо «public, max-age=300»",
      },
    ]);
    expect(issuesOf(report, SVG_PATH)).toEqual([
      {
        group: "type",
        message:
          "Content-Type: «image/svg+xml» вместо «image/svg+xml; charset=utf-8»",
      },
    ]);
  });

  it("сжатие: нет br и нет gzip", async () => {
    const { report } = await check((req, reply) =>
      req.path === JSON_PATH
        ? { ...reply, headers: without(reply.headers, "content-encoding") }
        : undefined,
    );
    expect(issuesOf(report, JSON_PATH)).toEqual([
      {
        group: "encoding",
        message: "Content-Encoding: нет вместо «br» на запрос «br, gzip»",
      },
      {
        group: "encoding",
        message: "Content-Encoding: нет вместо «gzip» на запрос «gzip»",
      },
    ]);
  });

  it("содержимое сверяется с файлом сумм, ответы br и gzip — одинаковые", async () => {
    const { report } = await check((req, reply) => {
      if (req.path === SVG_PATH) return { ...reply, body: bytes("<svg/>") };
      if (req.path === JSON_PATH && req.headers.origin === undefined) {
        return { ...reply, body: bytes("{}") };
      }
      return undefined;
    });
    expect(issuesOf(report, SVG_PATH)).toEqual([
      { group: "body", message: "содержимое не совпадает с файлом сумм" },
    ]);
    expect(issuesOf(report, JSON_PATH)).toEqual([
      {
        group: "encoding",
        message: "распакованные ответы на «br, gzip» и «gzip» разные",
      },
    ]);
  });

  it("файл сумм другого набора — иконки не сверяются", async () => {
    const files = bucket();
    files.set(
      SUMS,
      bytes(checksumsText({ id: "other", version: VERSION }, ICON_FILES)),
    );
    const { report } = await check(undefined, files);
    expect(issuesOf(report, SUMS)).toEqual([
      {
        group: "body",
        message: `файл сумм набора «other» версии «${VERSION}» вместо «demo» «${VERSION}»`,
      },
    ]);
    expect(target(report, JSON_PATH)?.checked).not.toContain("body");
    expect(issuesOf(report, JSON_PATH)).toEqual([]);
  });

  it("в файле сумм нет образца", async () => {
    const files = bucket();
    files.set(
      SUMS,
      bytes(
        checksumsText({ id: "demo", version: VERSION }, [
          ICON_FILES[1] as CdnFile,
        ]),
      ),
    );
    const { report } = await check(undefined, files);
    expect(issuesOf(report, JSON_PATH)).toEqual([
      { group: "body", message: "в файле сумм нет «demo/house.json»" },
    ]);
  });

  it("несуществующее имя: ответ 200 — не так; 404 без CORS — не так", async () => {
    const found = await check((req, reply) =>
      req.path === MISSING
        ? { ...reply, status: 200, body: bytes("{}") }
        : undefined,
    );
    expect(issuesOf(found.report, MISSING)).toEqual([
      { group: "status", message: "ответ 200 вместо 404" },
    ]);
    const noCors = await check((req, reply) =>
      req.path === MISSING
        ? {
            ...reply,
            headers: without(reply.headers, "access-control-allow-origin"),
          }
        : undefined,
    );
    expect(issuesOf(noCors.report, MISSING)).toEqual([
      {
        group: "cors",
        message: "Access-Control-Allow-Origin: нет вместо «*»",
      },
    ]);
  });

  it("перенаправление — неверный ответ, файл дальше не проверяется", async () => {
    const { report, requests } = await check((req, reply) =>
      req.path === JSON_PATH
        ? {
            status: 301,
            headers: { ...reply.headers, location: "https://example.com/" },
            body: bytes(""),
          }
        : undefined,
    );
    expect(issuesOf(report, JSON_PATH)).toEqual([
      { group: "status", message: "ответ 301 вместо 200" },
    ]);
    expect(target(report, JSON_PATH)?.checked).toEqual([
      "status",
      "cors",
      "security",
    ]);
    expect(requests.filter((r) => r.path === JSON_PATH)).toHaveLength(1);
  });

  it("в манифесте нет набора-образца — файлы версии не проверяются", async () => {
    const files = bucket();
    files.set(
      MANIFEST_FILE,
      bytes(manifestText([{ id: "other", version: VERSION, lastModified: 1 }])),
    );
    const { report, requests } = await check(undefined, files);
    expect(report.targets.map((t) => t.path)).toEqual([MANIFEST_FILE]);
    expect(issuesOf(report, MANIFEST_FILE)).toEqual([
      { group: "body", message: "в манифесте нет набора «demo»" },
    ]);
    expect(report.stop).toEqual([
      "версия набора «demo» неизвестна — файлы версии не проверялись",
    ]);
    expect(report.version).toBeUndefined();
    expect(requests).toHaveLength(2);
    expect(checkFailed(report)).toBe(true);
  });

  it("манифест не JSON", async () => {
    const files = bucket();
    files.set(MANIFEST_FILE, bytes("<html>"));
    const { report } = await check(undefined, files);
    expect(issuesOf(report, MANIFEST_FILE)).toEqual([
      { group: "body", message: "манифест не JSON" },
    ]);
    expect(report.stop).toHaveLength(1);
  });

  it("сбой сети повторяется с паузой", async () => {
    let failures = 0;
    const { report, sleeps, requests } = await check((req) =>
      req.path === MANIFEST_FILE && failures++ === 0
        ? new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })
        : undefined,
    );
    expect(checkFailed(report)).toBe(false);
    expect(sleeps).toEqual([1000]);
    expect(requests).toHaveLength(10);
    expect(report.requests).toBe(10);
  });

  it("временный отказ повторяется по Retry-After, после последней попытки остаётся ответом", async () => {
    const { report, sleeps } = await check((req, reply) =>
      req.path === SVG_PATH
        ? {
            ...reply,
            status: 503,
            headers: { ...reply.headers, "retry-after": "2" },
          }
        : undefined,
    );
    expect(sleeps).toEqual([2000, 2000]);
    expect(issuesOf(report, SVG_PATH)).toEqual([
      { group: "status", message: "ответ 503 вместо 200" },
    ]);
  });

  it("нет ответа ни на одну попытку — «нет ответа», остальные адреса проверяются", async () => {
    const { report, sleeps } = await check((req) =>
      req.path === MISSING
        ? new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          )
        : undefined,
    );
    expect(target(report, MISSING)).toEqual({
      kind: "missing",
      path: MISSING,
      checked: ["status"],
      issues: [
        {
          group: "status",
          message: "нет ответа за 30 с — не получилось за 3 попыток",
        },
      ],
    });
    expect(sleeps).toEqual([1000, 2000]);
    expect(issuesOf(report, SVG_PATH)).toEqual([]);
  });

  it("сбой второго запроса — проблема сжатия, первый ответ проверен", async () => {
    const { report } = await check((req) =>
      req.path === SUMS && req.headers.origin === undefined
        ? new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })
        : undefined,
    );
    expect(issuesOf(report, SUMS)).toEqual([
      {
        group: "encoding",
        message:
          "запрос «gzip»: сбой сети (ENOTFOUND): fetch failed — не получилось за 3 попыток",
      },
    ]);
    // Файл сумм прочитан из первого ответа — иконки сверены.
    expect(target(report, SVG_PATH)?.checked).toContain("body");
  });
});
