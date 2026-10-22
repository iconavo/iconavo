import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoConfig } from "../search/fixture.testing.js";
import {
  CACHE_IMMUTABLE,
  CACHE_MANIFEST,
  CHECKSUMS_SUFFIX,
  MANIFEST_FILE,
} from "./config.js";
import { type CdnDemoSet, writeCdnDemoSet } from "./fixture.testing.js";
import { buildCdn } from "./run.js";
import { md5Hex, r2Error } from "./s3.js";
import { fakeR2Client } from "./s3.testing.js";
import {
  compareWithRemote,
  contentTypeOf,
  type LocalFile,
  uploadCdn,
  uploadStop,
} from "./upload.js";

const HOUSE = '<path d="M1 1h2"/>';
const DEMO: CdnDemoSet = {
  id: "demo",
  icons: { house: { body: HOUSE }, old: { body: "<g/>", hidden: true } },
  aliases: { home: { parent: "house" }, gone: { parent: "old" } },
  samples: ["house"],
};
const OTHER: CdnDemoSet = { id: "other", icons: { star: { body: "<g/>" } } };
const configs = [demoConfig("demo"), demoConfig("other")];

let root: string;
let dataDir: string;
let outDir: string;
let demoVersion: string;
let otherVersion: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-upload-"));
  dataDir = join(root, "data");
  outDir = join(root, "dist-cdn");
  demoVersion = (await writeCdnDemoSet(dataDir, DEMO)).version;
  otherVersion = (await writeCdnDemoSet(dataDir, OTHER)).version;
  await buildCdn(configs, { dataDir, outDir, concurrency: 2 });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const demoKey = (name: string) => `v/${demoVersion}/demo/${name}`;
const demoSums = () => `v/${demoVersion}/demo${CHECKSUMS_SUFFIX}`;
const otherKey = (name: string) => `v/${otherVersion}/other/${name}`;
const otherSums = () => `v/${otherVersion}/other${CHECKSUMS_SUFFIX}`;

const upload = (
  client: ReturnType<typeof fakeR2Client>["client"],
  dryRun = false,
) => uploadCdn({ outDir, client, dryRun, concurrency: 2, now: () => 0 });

describe("uploadCdn", () => {
  it("первая выгрузка: все файлы, файл сумм последним в наборе, манифест в конце", async () => {
    const fake = fakeR2Client();
    const report = await upload(fake.client);
    expect(uploadStop(report)).toBe(false);
    expect(report.sets.map((s) => s.status)).toEqual(["uploaded", "uploaded"]);
    expect(report.manifestStatus).toBe("written");
    expect(report.remoteManifest).toBeUndefined();
    const puts = fake.puts();
    // 8 файлов demo + суммы, 2 файла other + суммы, манифест.
    expect(puts).toHaveLength(13);
    expect(puts.at(-1)).toBe(MANIFEST_FILE);
    const demoFiles = puts.filter((k) => k.startsWith(demoKey("")));
    expect(demoFiles).toHaveLength(8);
    expect(puts.indexOf(demoSums())).toBeGreaterThan(
      Math.max(...demoFiles.map((k) => puts.indexOf(k))),
    );
    expect(puts.indexOf(otherSums())).toBeGreaterThan(
      puts.indexOf(otherKey("star.svg")),
    );
    const svg = fake.store.get(demoKey("house.svg"));
    expect(svg?.contentType).toBe("image/svg+xml; charset=utf-8");
    expect(svg?.cacheControl).toBe(CACHE_IMMUTABLE);
    expect(Buffer.from(svg?.body ?? []).toString()).toContain(HOUSE);
    expect(fake.store.get(demoKey("home.json"))?.contentType).toBe(
      "application/json; charset=utf-8",
    );
    expect(fake.store.get(demoSums())?.cacheControl).toBe(CACHE_IMMUTABLE);
    const manifest = fake.store.get(MANIFEST_FILE);
    expect(manifest?.cacheControl).toBe(CACHE_MANIFEST);
    expect(manifest?.contentType).toBe("application/json; charset=utf-8");
    expect(Buffer.from(manifest?.body ?? []).toString()).toBe(report.manifest);
    expect(report.sets[0]).toMatchObject({
      id: "demo",
      version: demoVersion,
      files: 9,
      present: 0,
      missing: 9,
      uploaded: 9,
      samples: ["demo/gone.json", "demo/gone.svg"],
    });
    expect(report.sets[0]?.uploadedBytes).toBe(report.sets[0]?.bytes);
    expect(report.sets[1]).toMatchObject({
      id: "other",
      files: 3,
      uploaded: 3,
    });
  });

  it("повтор без изменений ничего не пишет", async () => {
    const fake = fakeR2Client();
    await upload(fake.client);
    const before = fake.puts().length;
    const report = await upload(fake.client);
    expect(report.sets.map((s) => s.status)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    expect(report.manifestStatus).toBe("unchanged");
    expect(report.remoteManifest).toBe(report.manifest);
    expect(fake.puts()).toHaveLength(before);
    expect(report.sets[0]).toMatchObject({
      present: 9,
      missing: 0,
      uploaded: 0,
    });
  });

  it("показ: ничего не пишет и говорит, что выгрузит", async () => {
    const fake = fakeR2Client();
    const report = await upload(fake.client, true);
    expect(report.dryRun).toBe(true);
    expect(uploadStop(report)).toBe(false);
    expect(report.sets.map((s) => s.status)).toEqual(["planned", "planned"]);
    expect(report.sets[0]).toMatchObject({ missing: 9, uploaded: 0 });
    expect(report.manifestStatus).toBe("planned");
    expect(fake.puts()).toEqual([]);
    expect(fake.store.size).toBe(0);
  });

  it("недокачанная версия докачивается: только недостающие файлы и суммы", async () => {
    const fake = fakeR2Client();
    await upload(fake.client);
    fake.store.delete(demoKey("house.svg"));
    fake.store.delete(demoSums());
    const before = fake.puts().length;
    const report = await upload(fake.client);
    expect(report.sets[0]).toMatchObject({
      status: "uploaded",
      present: 7,
      missing: 2,
      uploaded: 2,
    });
    expect(report.sets[1]?.status).toBe("unchanged");
    expect(fake.puts().slice(before)).toEqual([
      demoKey("house.svg"),
      demoSums(),
    ]);
    expect(report.manifestStatus).toBe("unchanged");
  });

  it("в бакете другой файл этой версии — СТОП набора, манифест не записан", async () => {
    const fake = fakeR2Client();
    fake.seed(demoKey("house.svg"), "<svg>другое</svg>");
    const report = await upload(fake.client);
    expect(uploadStop(report)).toBe(true);
    expect(report.sets[0]?.status).toBe("stopped");
    expect(report.sets[0]?.stop[0]).toContain("другие файлы этой версии (1)");
    expect(report.sets[0]?.stop[0]).toContain(demoKey("house.svg"));
    expect(report.sets[1]?.status).toBe("uploaded");
    expect(report.manifestStatus).toBe("skipped");
    expect(fake.puts().some((k) => k.startsWith(demoKey("")))).toBe(false);
    expect(fake.store.has(MANIFEST_FILE)).toBe(false);
  });

  it("сбой записи — СТОП набора, файл сумм не записан, остальное идёт", async () => {
    const fake = fakeR2Client({
      fail: (op, key) =>
        op === "put" && key === demoKey("house.svg")
          ? new Error("тест: R2 упал")
          : undefined,
    });
    const report = await upload(fake.client);
    expect(report.sets[0]).toMatchObject({
      status: "stopped",
      stop: ["тест: R2 упал"],
    });
    expect(fake.store.has(demoSums())).toBe(false);
    expect(report.sets[1]?.status).toBe("uploaded");
    expect(report.manifestStatus).toBe("skipped");
    expect(report.stop).toEqual([]);
  });

  it("битый файл на диске — СТОП, в бакет ничего не уходит", async () => {
    await writeFile(
      join(outDir, "v", demoVersion, "demo", "house.svg"),
      "<svg/>",
    );
    const fake = fakeR2Client();
    const report = await upload(fake.client);
    expect(report.sets[0]?.status).toBe("stopped");
    expect(report.sets[0]?.stop[0]).toContain(
      "demo/house.svg — не совпадает с контрольной суммой",
    );
    expect(report.sets[0]?.stop[0]).toContain("pnpm cdn build");
    expect(fake.calls.filter((c) => c.key.startsWith(demoKey("")))).toEqual([]);
    expect(report.manifestStatus).toBe("skipped");
  });

  it("лишний файл в папке версии — СТОП", async () => {
    await writeFile(join(outDir, "v", demoVersion, "demo", "extra.json"), "{}");
    const report = await upload(fakeR2Client().client);
    expect(report.sets[0]?.stop[0]).toContain("лишние файлы (1): extra.json");
  });

  it("нет манифеста — СТОП с подсказкой", async () => {
    await rm(join(outDir, MANIFEST_FILE));
    const fake = fakeR2Client();
    const report = await upload(fake.client);
    expect(report.stop).toEqual([
      "manifest.json не читается или не по схеме — запустите pnpm cdn build",
    ]);
    expect(report.sets).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("ETag не MD5 — сверка после выгрузки не сходится", async () => {
    const fake = fakeR2Client({ etagOf: () => "nope" });
    const report = await upload(fake.client);
    expect(report.sets[0]?.status).toBe("stopped");
    expect(report.sets[0]?.stop[0]).toContain(
      "сверка после выгрузки не сошлась",
    );
    expect(report.sets[0]?.stop[0]).toContain("отличаются: 9");
    expect(report.manifestStatus).toBe("skipped");
  });

  it("ключ не подошёл — остановка всего прогона, остальные наборы не проверяются", async () => {
    const fake = fakeR2Client({
      fail: (op) =>
        op === "list"
          ? r2Error("GET b/: ключ R2 не подошёл", "run")
          : undefined,
    });
    const report = await upload(fake.client);
    expect(report.stop).toEqual(["GET b/: ключ R2 не подошёл"]);
    expect(report.sets.map((s) => s.status)).toEqual(["stopped", "stopped"]);
    expect(report.sets[1]).toMatchObject({
      id: "other",
      version: otherVersion,
      stop: ["не проверялся: прогон остановлен"],
    });
    expect(fake.puts()).toEqual([]);
    expect(report.manifestStatus).toBe("skipped");
  });

  it("манифест пишется только при отличии от того, что в бакете", async () => {
    const fake = fakeR2Client();
    await upload(fake.client);
    fake.seed(MANIFEST_FILE, '{"sets":{}}');
    const before = fake.puts().length;
    const report = await upload(fake.client);
    expect(report.remoteManifest).toBe('{"sets":{}}');
    expect(report.manifestStatus).toBe("written");
    expect(fake.puts().slice(before)).toEqual([MANIFEST_FILE]);
    expect(
      Buffer.from(fake.store.get(MANIFEST_FILE)?.body ?? []).toString(),
    ).toBe(report.manifest);
  });
});

describe("compareWithRemote и contentTypeOf", () => {
  const file = (key: string, text: string): LocalFile => {
    const data = new Uint8Array(Buffer.from(text, "utf8"));
    return {
      key,
      data,
      md5: md5Hex(data),
      contentType: contentTypeOf(key),
    };
  };
  it("совпадение — размер и ETag; иначе конфликт; нет ключа — недостаёт", () => {
    const a = file("v/x/demo/a.json", "{}");
    const b = file("v/x/demo/b.svg", "<svg/>");
    const c = file("v/x/demo/c.json", "[]");
    const result = compareWithRemote(
      [a, b, c],
      [
        { key: a.key, size: 2, etag: a.md5 },
        { key: b.key, size: 6, etag: "0".repeat(32) },
      ],
    );
    expect(result.present).toEqual([a]);
    expect(result.missing).toEqual([c]);
    expect(result.conflicts).toEqual([
      `v/x/demo/b.svg: в бакете 6 Б, ETag ${"0".repeat(32)}; локально 6 Б, MD5 ${b.md5}`,
    ]);
  });
  it("типы по расширению, другое — ошибка", () => {
    expect(contentTypeOf("a/b.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeOf("a/b.svg")).toBe("image/svg+xml; charset=utf-8");
    expect(contentTypeOf("demo.checksums.json")).toBe(
      "application/json; charset=utf-8",
    );
    expect(() => contentTypeOf("a/b.png")).toThrow("неизвестный тип файла");
  });
});
