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
import { md5Hex } from "./s3.js";
import { sha256Hex } from "./sigv4.js";
import { type StorageClient, storageError } from "./storage.js";
import { BUNNY_LIKE, fakeStorage } from "./storage.testing.js";
import {
  compareWithRemote,
  contentTypeOf,
  type HostUploadReport,
  type LocalFile,
  type UploadReport,
  uploadCdn,
  uploadStop,
  verifyFailed,
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

/** Выгрузка на один хост — как до второго хоста. */
const upload = (client: StorageClient, dryRun = false) =>
  uploadCdn({
    outDir,
    hosts: [{ host: "cdn.test", storage: "бакет", client }],
    dryRun,
    concurrency: 2,
    now: () => 0,
  });

/** Выгрузка на два хоста: основной и второй. */
const uploadBoth = (
  first: StorageClient,
  second: StorageClient,
  dryRun = false,
) =>
  uploadCdn({
    outDir,
    hosts: [
      { host: "cdn.test", storage: "бакет", client: first },
      { host: "cdn2.test", storage: "хранилище", client: second },
    ],
    dryRun,
    concurrency: 2,
    now: () => 0,
  });

const host = (r: UploadReport, i = 0) => r.hosts[i] as HostUploadReport;

describe("uploadCdn", () => {
  it("первая выгрузка: все файлы, файл сумм последним в наборе, манифест в конце", async () => {
    const fake = fakeStorage();
    const report = await upload(fake.client);
    expect(uploadStop(report)).toBe(false);
    const h = host(report);
    expect(h.sets.map((s) => s.status)).toEqual(["uploaded", "uploaded"]);
    expect(h.manifestStatus).toBe("written");
    expect(h.remoteManifest).toBeUndefined();
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
    expect(h.sets[0]).toMatchObject({
      id: "demo",
      version: demoVersion,
      files: 9,
      present: 0,
      missing: 9,
      uploaded: 9,
      samples: ["demo/gone.json", "demo/gone.svg"],
    });
    expect(h.sets[0]?.uploadedBytes).toBe(h.sets[0]?.bytes);
    expect(h.sets[1]).toMatchObject({
      id: "other",
      files: 3,
      uploaded: 3,
    });
  });

  it("повтор без изменений ничего не пишет", async () => {
    const fake = fakeStorage();
    await upload(fake.client);
    const before = fake.puts().length;
    const report = await upload(fake.client);
    const h = host(report);
    expect(h.sets.map((s) => s.status)).toEqual(["unchanged", "unchanged"]);
    expect(h.manifestStatus).toBe("unchanged");
    expect(h.remoteManifest).toBe(report.manifest);
    expect(fake.puts()).toHaveLength(before);
    expect(h.sets[0]).toMatchObject({
      present: 9,
      missing: 0,
      uploaded: 0,
    });
    expect(verifyFailed(report)).toBe(false);
  });

  it("показ: ничего не пишет и говорит, что выгрузит", async () => {
    const fake = fakeStorage();
    const report = await upload(fake.client, true);
    expect(report.dryRun).toBe(true);
    expect(uploadStop(report)).toBe(false);
    expect(verifyFailed(report)).toBe(true);
    const h = host(report);
    expect(h.sets.map((s) => s.status)).toEqual(["planned", "planned"]);
    expect(h.sets[0]).toMatchObject({ missing: 9, uploaded: 0 });
    expect(h.manifestStatus).toBe("planned");
    expect(fake.puts()).toEqual([]);
    expect(fake.store.size).toBe(0);
  });

  it("недокачанная версия докачивается: только недостающие файлы и суммы", async () => {
    const fake = fakeStorage();
    await upload(fake.client);
    fake.store.delete(demoKey("house.svg"));
    fake.store.delete(demoSums());
    const before = fake.puts().length;
    const report = await upload(fake.client);
    const h = host(report);
    expect(h.sets[0]).toMatchObject({
      status: "uploaded",
      present: 7,
      missing: 2,
      uploaded: 2,
    });
    expect(h.sets[1]?.status).toBe("unchanged");
    expect(fake.puts().slice(before)).toEqual([
      demoKey("house.svg"),
      demoSums(),
    ]);
    expect(h.manifestStatus).toBe("unchanged");
  });

  it("в хранилище другой файл этой версии — СТОП набора, манифест не записан", async () => {
    const fake = fakeStorage();
    fake.seed(demoKey("house.svg"), "<svg>другое</svg>");
    const report = await upload(fake.client);
    expect(uploadStop(report)).toBe(true);
    const h = host(report);
    expect(h.sets[0]?.status).toBe("stopped");
    expect(h.sets[0]?.stop[0]).toContain("другие файлы этой версии (1)");
    expect(h.sets[0]?.stop[0]).toContain(demoKey("house.svg"));
    expect(h.sets[1]?.status).toBe("uploaded");
    expect(h.manifestStatus).toBe("skipped");
    expect(h.manifestNote).toBe("остановлено наборов: 1");
    expect(fake.puts().some((k) => k.startsWith(demoKey("")))).toBe(false);
    expect(fake.store.has(MANIFEST_FILE)).toBe(false);
  });

  it("сбой записи — СТОП набора, файл сумм не записан, остальное идёт", async () => {
    const fake = fakeStorage({
      fail: (op, key) =>
        op === "put" && key === demoKey("house.svg")
          ? new Error("тест: R2 упал")
          : undefined,
    });
    const report = await upload(fake.client);
    const h = host(report);
    expect(h.sets[0]).toMatchObject({
      status: "stopped",
      stop: ["тест: R2 упал"],
    });
    expect(fake.store.has(demoSums())).toBe(false);
    expect(h.sets[1]?.status).toBe("uploaded");
    expect(h.manifestStatus).toBe("skipped");
    expect(h.stop).toEqual([]);
    expect(report.stop).toEqual([]);
  });

  it("битый файл на диске — СТОП, в хранилище ничего не уходит", async () => {
    await writeFile(
      join(outDir, "v", demoVersion, "demo", "house.svg"),
      "<svg/>",
    );
    const fake = fakeStorage();
    const report = await upload(fake.client);
    const h = host(report);
    expect(h.sets[0]?.status).toBe("stopped");
    expect(h.sets[0]?.stop[0]).toContain(
      "demo/house.svg — не совпадает с контрольной суммой",
    );
    expect(h.sets[0]?.stop[0]).toContain("pnpm cdn build");
    expect(fake.calls.filter((c) => c.key.startsWith(demoKey("")))).toEqual([]);
    expect(h.manifestStatus).toBe("skipped");
  });

  it("лишний файл в папке версии — СТОП", async () => {
    await writeFile(join(outDir, "v", demoVersion, "demo", "extra.json"), "{}");
    const report = await upload(fakeStorage().client);
    expect(host(report).sets[0]?.stop[0]).toContain(
      "лишние файлы (1): extra.json",
    );
  });

  it("нет манифеста — СТОП с подсказкой", async () => {
    await rm(join(outDir, MANIFEST_FILE));
    const fake = fakeStorage();
    const report = await upload(fake.client);
    expect(report.stop).toEqual([
      "manifest.json не читается или не по схеме — запустите pnpm cdn build",
    ]);
    expect(report.hosts).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("ETag не MD5 — сверка после выгрузки не сходится", async () => {
    const fake = fakeStorage({ etagOf: () => "nope" });
    const report = await upload(fake.client);
    const h = host(report);
    expect(h.sets[0]?.status).toBe("stopped");
    expect(h.sets[0]?.stop[0]).toContain("сверка после выгрузки не сошлась");
    expect(h.sets[0]?.stop[0]).toContain("отличаются: 9");
    expect(h.manifestStatus).toBe("skipped");
  });

  it("ключ не подошёл — остановка хоста, остальные наборы не проверяются", async () => {
    const fake = fakeStorage({
      fail: (op) =>
        op === "list"
          ? storageError("GET b/: ключ R2 не подошёл", "run")
          : undefined,
    });
    const report = await upload(fake.client);
    const h = host(report);
    expect(h.stop).toEqual(["GET b/: ключ R2 не подошёл"]);
    expect(h.sets.map((s) => s.status)).toEqual(["stopped", "stopped"]);
    expect(h.sets[1]).toMatchObject({
      id: "other",
      version: otherVersion,
      stop: ["не проверялся: работа с хостом остановлена"],
    });
    expect(fake.puts()).toEqual([]);
    expect(h.manifestStatus).toBe("skipped");
    expect(h.manifestNote).toBe("работа с хостом остановлена");
  });

  it("манифест пишется только при отличии от того, что в хранилище", async () => {
    const fake = fakeStorage();
    await upload(fake.client);
    fake.seed(MANIFEST_FILE, '{"sets":{}}');
    const before = fake.puts().length;
    const report = await upload(fake.client);
    const h = host(report);
    expect(h.remoteManifest).toBe('{"sets":{}}');
    expect(h.manifestStatus).toBe("written");
    expect(fake.puts().slice(before)).toEqual([MANIFEST_FILE]);
    expect(
      Buffer.from(fake.store.get(MANIFEST_FILE)?.body ?? []).toString(),
    ).toBe(report.manifest);
  });
});

describe("uploadCdn на два хоста", () => {
  /** Основной — как R2 (ETag = MD5), второй — как Bunny (SHA-256 в списке), журнал общий. */
  const pair = (
    first: Parameters<typeof fakeStorage>[0] = {},
    second: Parameters<typeof fakeStorage>[0] = {},
  ) => {
    const journal: string[] = [];
    return {
      journal,
      r2: fakeStorage({ name: "R2", journal, ...first }),
      bunny: fakeStorage({ name: "Bunny", journal, ...BUNNY_LIKE, ...second }),
    };
  };
  const writes = (journal: readonly string[]) =>
    journal.filter((line) => line.includes(" put "));

  it("файлы — на оба хоста, затем манифесты; второй хост — последним", async () => {
    const { journal, r2, bunny } = pair();
    const report = await uploadBoth(r2.client, bunny.client);
    expect(uploadStop(report)).toBe(false);
    expect(report.hosts.map((h) => [h.host, h.manifestStatus])).toEqual([
      ["cdn.test", "written"],
      ["cdn2.test", "written"],
    ]);
    const lines = writes(journal);
    expect(lines).toHaveLength(26);
    // Все файлы основного, затем все файлы второго, затем манифест основного и второго.
    expect(lines.slice(0, 12).every((l) => l.startsWith("R2 put v/"))).toBe(
      true,
    );
    expect(lines.slice(12, 24).every((l) => l.startsWith("Bunny put v/"))).toBe(
      true,
    );
    expect(lines.slice(24)).toEqual([
      `R2 put ${MANIFEST_FILE}`,
      `Bunny put ${MANIFEST_FILE}`,
    ]);
    // Второй хост сверен по SHA-256 из списка.
    expect(bunny.store.get(demoSums())?.etag).toBeUndefined();
    expect(host(report, 1).sets.map((s) => s.status)).toEqual([
      "uploaded",
      "uploaded",
    ]);
    const again = await uploadBoth(r2.client, bunny.client);
    expect(verifyFailed(again)).toBe(false);
    expect(again.hosts.map((h) => h.manifestStatus)).toEqual([
      "unchanged",
      "unchanged",
    ]);
  });

  it("на основном хосте СТОП — второй не выгружается, манифесты не пишутся", async () => {
    const { r2, bunny } = pair();
    r2.seed(demoKey("house.svg"), "<svg>другое</svg>");
    const report = await uploadBoth(r2.client, bunny.client);
    expect(uploadStop(report)).toBe(true);
    expect(bunny.calls).toEqual([]);
    expect(host(report, 1).stop).toEqual([
      "не выгружался: «СТОП» на cdn.test — иначе хосты разойдутся",
    ]);
    expect(host(report, 1).manifestStatus).toBe("skipped");
    expect(host(report, 0).manifestStatus).toBe("skipped");
    expect(r2.store.has(MANIFEST_FILE)).toBe(false);
  });

  it("показ сравнивает оба хоста, даже если на основном СТОП", async () => {
    const { r2, bunny } = pair();
    r2.seed(demoKey("house.svg"), "<svg>другое</svg>");
    const report = await uploadBoth(r2.client, bunny.client, true);
    expect(host(report, 1).sets.map((s) => s.status)).toEqual([
      "planned",
      "planned",
    ]);
    expect(host(report, 1).manifestStatus).toBe("planned");
    expect(host(report, 0).manifestNote).toBe("остановлено наборов: 1");
    expect(r2.puts()).toEqual([]);
    expect(bunny.puts()).toEqual([]);
    expect(verifyFailed(report)).toBe(true);
  });

  it("второй хост не сошёлся — манифест основного тоже не записан", async () => {
    const { r2, bunny } = pair(
      {},
      {
        fail: (op, key) =>
          op === "put" && key === otherKey("star.svg")
            ? new Error("тест: Bunny упал")
            : undefined,
      },
    );
    const report = await uploadBoth(r2.client, bunny.client);
    expect(uploadStop(report)).toBe(true);
    expect(host(report, 0).sets.map((s) => s.status)).toEqual([
      "uploaded",
      "uploaded",
    ]);
    expect(host(report, 0).manifestStatus).toBe("skipped");
    expect(host(report, 0).manifestNote).toBe(
      "«СТОП» на cdn2.test: манифесты пишутся, только когда новая версия есть на всех хостах",
    );
    expect(r2.store.has(MANIFEST_FILE)).toBe(false);
    expect(bunny.store.has(MANIFEST_FILE)).toBe(false);
  });

  it("во втором хранилище нет контрольных сумм — СТОП «сверить нечем»", async () => {
    const { r2, bunny } = pair({}, { sha256Of: undefined });
    const report = await uploadBoth(r2.client, bunny.client);
    expect(host(report, 1).sets[0]?.status).toBe("stopped");
    expect(host(report, 1).sets[0]?.stop[0]).toContain("сверить нечем");
    expect(report.hosts.map((h) => h.manifestStatus)).toEqual([
      "skipped",
      "skipped",
    ]);
  });

  it("отличается только манифест второго хоста — пишется только он", async () => {
    const { r2, bunny } = pair();
    await uploadBoth(r2.client, bunny.client);
    bunny.seed(MANIFEST_FILE, '{"sets":{}}');
    const before = { r2: r2.puts().length, bunny: bunny.puts().length };
    const report = await uploadBoth(r2.client, bunny.client);
    expect(report.hosts.map((h) => h.manifestStatus)).toEqual([
      "unchanged",
      "written",
    ]);
    expect(r2.puts()).toHaveLength(before.r2);
    expect(bunny.puts().slice(before.bunny)).toEqual([MANIFEST_FILE]);
  });

  it("манифест основного не записался — манифест второго не пишется", async () => {
    const { r2, bunny } = pair({
      fail: (op, key) =>
        op === "put" && key === MANIFEST_FILE
          ? new Error("тест: R2 упал на манифесте")
          : undefined,
    });
    const report = await uploadBoth(r2.client, bunny.client);
    expect(host(report, 0).stop).toEqual([
      `${MANIFEST_FILE}: тест: R2 упал на манифесте`,
    ]);
    expect(host(report, 1).manifestStatus).toBe("skipped");
    expect(host(report, 1).manifestNote).toContain("«СТОП» на cdn.test");
    expect(bunny.store.has(MANIFEST_FILE)).toBe(false);
  });
});

describe("compareWithRemote и contentTypeOf", () => {
  const file = (key: string, text: string): LocalFile => {
    const data = new Uint8Array(Buffer.from(text, "utf8"));
    return {
      key,
      data,
      md5: md5Hex(data),
      sha256: sha256Hex(data),
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
      `v/x/demo/b.svg: в хранилище 6 Б, ETag ${"0".repeat(32)}; локально 6 Б, MD5 ${b.md5}`,
    ]);
  });
  it("SHA-256 из списка — главнее ETag; без контрольной суммы сверить нечем", () => {
    const a = file("v/x/demo/a.json", "{}");
    const b = file("v/x/demo/b.svg", "<svg/>");
    const c = file("v/x/demo/c.json", "[]");
    const d = file("v/x/demo/d.json", "{}");
    const result = compareWithRemote(
      [a, b, c, d],
      [
        { key: a.key, size: 2, sha256: a.sha256, etag: "любой" },
        { key: b.key, size: 6, sha256: "0".repeat(64) },
        { key: c.key, size: 2 },
        { key: d.key, size: 3, sha256: d.sha256 },
      ],
    );
    expect(result.present).toEqual([a]);
    expect(result.conflicts).toEqual([
      `v/x/demo/b.svg: в хранилище 6 Б, SHA-256 ${"0".repeat(64)}; локально 6 Б, SHA-256 ${b.sha256}`,
      "v/x/demo/c.json: в хранилище 2 Б, а контрольной суммы в списке нет — сверить нечем",
      `v/x/demo/d.json: в хранилище 3 Б, SHA-256 ${d.sha256}; локально 2 Б, SHA-256 ${d.sha256}`,
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
