import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoConfig } from "../search/fixture.testing.js";
import {
  type FakePackage,
  type FakeVersion,
  fakeRegistry,
  loadDemoNpmSet,
  type NpmDemoSet,
  packageFiles,
  writeNpmDemoSet,
} from "./fixture.testing.js";
import {
  expectedFromPlan,
  npmVerifyFailed,
  readPlan,
  verifyPackages,
} from "./verify.js";

const NAME = "@iconavo-ui/icons-demo";
const DEMO: NpmDemoSet = {
  id: "demo",
  icons: { house: { body: '<path d="M1 1h2"/>' } },
  samples: ["house"],
};
const configs = [demoConfig("demo")];

let root: string;
let dataDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-npm-"));
  dataDir = join(root, "data");
  await writeNpmDemoSet(dataDir, DEMO);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Версия, которую выпустила бы эта сборка. */
async function version(
  v: string,
  extra: Partial<FakeVersion> = {},
): Promise<FakeVersion> {
  const set = await loadDemoNpmSet(dataDir, "demo");
  return { version: v, files: packageFiles(set, v), ...extra };
}

/** Чужая по содержимому версия: другой рисунок — другой отпечаток. */
async function otherVersion(v: string): Promise<FakeVersion> {
  const other = join(root, "other");
  await writeNpmDemoSet(other, {
    ...DEMO,
    icons: { house: { body: "<g/>" } },
  });
  const set = await loadDemoNpmSet(other, "demo");
  return { version: v, files: packageFiles(set, v) };
}

function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

const verify = (
  packages: Record<string, FakePackage | FakePackage[]>,
  waitMs = 0,
  expected?: Record<string, string>,
) => {
  const c = clock();
  return verifyPackages(configs, {
    dataDir,
    registry: fakeRegistry(packages).client,
    expected:
      expected === undefined ? undefined : new Map(Object.entries(expected)),
    waitMs,
    pollMs: 20_000,
    now: c.now,
    sleep: c.sleep,
  }).then((report) => ({ report, sleeps: c.sleeps }));
};

describe("verifyPackages", () => {
  it("пакета нет — ждёт первой публикации, это не ошибка", async () => {
    const { report } = await verify({});
    expect(report.packages[0]).toMatchObject({ status: "awaiting" });
    expect(npmVerifyFailed(report)).toBe(false);
  });

  it("всё на месте: отпечаток, файлы, provenance из main, доверенная публикация", async () => {
    const first = await version("1.0.0", { trusted: false });
    const second = await version("1.0.1");
    const { report } = await verify({
      [NAME]: {
        versions: [first, second],
        tags: { latest: "1.0.0", next: "1.0.1" },
      },
    });
    expect(report.packages[0]).toMatchObject({
      status: "ok",
      version: "1.0.1",
      latest: "1.0.0",
      publisher: "trusted",
      files: 8,
      problems: [],
      provenance: { ref: "refs/heads/main" },
    });
    expect(report.packages[0]?.notes).toEqual([
      expect.stringContaining("latest → 1.0.0"),
    ]);
  });

  it("реестр отстаёт: ждёт, пока под тегом появится наш отпечаток", async () => {
    const old = await otherVersion("1.0.0");
    const fresh = await version("1.0.1");
    const { report, sleeps } = await verify(
      {
        [NAME]: [
          { versions: [old], tags: { next: "1.0.0" } },
          { versions: [old, fresh], tags: { next: "1.0.1" } },
        ],
      },
      60_000,
    );
    expect(sleeps).toEqual([20_000]);
    expect(report.packages[0]).toMatchObject({
      status: "ok",
      version: "1.0.1",
    });
  });

  it("срок вышел, а отпечатка нет — не так", async () => {
    const old = await otherVersion("1.0.0");
    const { report, sleeps } = await verify(
      { [NAME]: { versions: [old], tags: { next: "1.0.0" } } },
      50_000,
    );
    expect(sleeps).toEqual([20_000, 20_000, 10_000]);
    expect(report.packages[0]?.status).toBe("failed");
    expect(report.packages[0]?.problems).toEqual([
      expect.stringContaining("версия 1.0.0 с другим отпечатком"),
    ]);
  });

  it("файл в архиве отличается — названо, какой", async () => {
    const v = await version("1.0.0", { trusted: false });
    v.files.set("README.md", new Uint8Array(Buffer.from("подмена")));
    const { report } = await verify({
      [NAME]: { versions: [v], tags: { next: "1.0.0" } },
    });
    expect(report.packages[0]?.problems).toEqual([
      "файлы в npm отличаются от сборки: README.md",
    ]);
  });

  it("лишний и недостающий файлы", async () => {
    const v = await version("1.0.0", { trusted: false });
    v.files.delete("LICENSE");
    v.files.set("extra.js", new Uint8Array());
    const { report } = await verify({
      [NAME]: { versions: [v], tags: { next: "1.0.0" } },
    });
    expect(report.packages[0]?.problems).toEqual([
      "в архиве npm нет файлов: LICENSE",
      "в архиве npm лишние файлы: extra.js",
    ]);
  });

  it("нет подписи provenance или она не из main — не так", async () => {
    const none = await version("1.0.0", { provenance: null, trusted: false });
    const branch = await version("1.0.0", {
      trusted: false,
      provenance: {
        repository: "https://github.com/iconavo/iconavo",
        workflow: ".github/workflows/publish.yml",
        ref: "refs/heads/feature",
        sha512: "00",
      },
    });
    const a = await verify({
      [NAME]: { versions: [none], tags: { next: "1.0.0" } },
    });
    expect(a.report.packages[0]?.problems).toEqual([
      "у версии 1.0.0 нет подписи provenance",
    ]);
    const b = await verify({
      [NAME]: { versions: [branch], tags: { next: "1.0.0" } },
    });
    expect(b.report.packages[0]?.problems).toEqual([
      "provenance: ветка refs/heads/feature, а не refs/heads/main",
      "provenance подписывает другой архив: SHA-512 не совпадает с реестром",
    ]);
  });

  it("токеном можно только первую версию", async () => {
    const first = await version("1.0.0", { trusted: false });
    const ok = await verify({
      [NAME]: { versions: [first], tags: { next: "1.0.0" } },
    });
    expect(ok.report.packages[0]).toMatchObject({
      status: "ok",
      publisher: "token",
    });
    expect(ok.report.packages[0]?.notes).toEqual([
      expect.stringContaining("первая версия выложена временным токеном"),
    ]);

    const old = await otherVersion("1.0.0");
    const second = await version("1.0.1", { trusted: false });
    const bad = await verify({
      [NAME]: { versions: [old, second], tags: { next: "1.0.1" } },
    });
    expect(bad.report.packages[0]?.problems).toEqual([
      expect.stringContaining("версия 1.0.1 выложена токеном"),
    ]);
  });
});

describe("ожидание выпущенной версии (npm показывает её через минуты)", () => {
  it("по плану ждёт ровно выпущенную версию, даже с тем же отпечатком", async () => {
    const old = await version("1.0.0", { trusted: false });
    const fresh = await version("1.0.1");
    const { report, sleeps } = await verify(
      {
        [NAME]: [
          { versions: [old], tags: { next: "1.0.0" } },
          { versions: [old, fresh], tags: { next: "1.0.1" } },
        ],
      },
      60_000,
      { demo: "1.0.1" },
    );
    expect(sleeps).toEqual([20_000]);
    expect(report.packages[0]).toMatchObject({
      status: "ok",
      version: "1.0.1",
      publisher: "trusted",
    });
  });

  it("версия видна, а подпись ещё нет — ждёт и её", async () => {
    const v = await version("1.0.0", { trusted: false, provenanceLag: 1 });
    const { report, sleeps } = await verify(
      { [NAME]: { versions: [v], tags: { next: "1.0.0" } } },
      60_000,
    );
    expect(sleeps).toEqual([20_000]);
    expect(report.packages[0]?.status).toBe("ok");
  });

  it("срок вышел, а выпущенной версии нет — не так, с объяснением", async () => {
    const old = await version("1.0.0", { trusted: false });
    const { report, sleeps } = await verify(
      { [NAME]: { versions: [old], tags: { next: "1.0.0" } } },
      40_000,
      { demo: "1.0.1" },
    );
    expect(sleeps).toEqual([20_000, 20_000]);
    expect(report.packages[0]?.problems).toEqual([
      expect.stringContaining(
        "под тегом next — 1.0.0, а запуск выпускал 1.0.1",
      ),
    ]);
  });

  it("пакета нет, а запуск его выпускал — ждёт и сообщает", async () => {
    const { report, sleeps } = await verify({}, 20_000, { demo: "1.0.0" });
    expect(sleeps).toEqual([20_000]);
    expect(report.packages[0]?.problems).toEqual([
      expect.stringContaining("пакета нет в npm, а запуск выпускал 1.0.0"),
    ]);
  });

  it("пакета нет и запуск его не выпускал — ждать нечего", async () => {
    const { report, sleeps } = await verify({}, 60_000);
    expect(sleeps).toEqual([]);
    expect(report.packages[0]?.status).toBe("awaiting");
  });
});

describe("план подготовки", () => {
  it("берутся только пакеты к публикации", () => {
    expect(
      expectedFromPlan({
        tag: "next",
        packages: [
          { id: "lucide", version: "1.0.1", publish: true, files: [] },
          { id: "tabler", version: "1.0.0", publish: false },
        ],
      }),
    ).toEqual(new Map([["lucide", "1.0.1"]]));
    expect(() => expectedFromPlan({ packages: [{ id: "x" }] })).toThrow();
  });

  it("плана нет на диске — ошибка с подсказкой", async () => {
    await expect(readPlan(join(root, "none.json"))).rejects.toThrow(
      "не читается — его пишет pnpm packages prepare",
    );
  });
});
