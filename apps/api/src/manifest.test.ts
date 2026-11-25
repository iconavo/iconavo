import { describe, expect, it } from "vitest";
import {
  fakeBucket,
  fakeCache,
  manifestText,
  VERSION,
} from "./fake.testing.js";
import { StorageError } from "./http.js";
import { manifestLoader, parseManifest } from "./manifest.js";

/** Обещание, которое обязано выполниться быстро: зависло — ошибка теста, а не вечное ожидание. */
const within = <T>(promise: Promise<T>, ms = 300): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`не дождались за ${ms} мс`)), ms),
    ),
  ]);

describe("parseManifest", () => {
  it("наборы в Map: имена из прототипа объекта ничего не находят", () => {
    const manifest = parseManifest(manifestText({ lucide: VERSION }));
    expect(manifest.get("lucide")?.version).toBe(VERSION);
    expect(manifest.get("constructor")).toBeUndefined();
    expect(manifest.get("toString")).toBeUndefined();
  });

  it("не тот формат — ошибка хранилища", () => {
    for (const text of [
      "не json",
      "{}",
      '{"sets":[]}',
      '{"sets":{"lucide":{"version":"XYZ","lastModified":1}}}',
      '{"sets":{"lucide":{"version":"0123abcd","lastModified":-1}}}',
      '{"sets":{"Lucide":{"version":"0123abcd","lastModified":1}}}',
      '{"catalog":"abc","sets":{}}',
      '{"catalog":123,"sets":{}}',
    ]) {
      expect(() => parseManifest(text), text).toThrow(StorageError);
    }
  });

  it("catalog — отпечаток оглавления каталога; у манифеста до шага 2 фазы 4 его нет", () => {
    expect(
      parseManifest(manifestText({ lucide: VERSION }, "0123456789ab")).catalog,
    ).toBe("0123456789ab");
    expect(parseManifest(manifestText({ lucide: VERSION })).catalog).toBe(
      undefined,
    );
  });
});

describe("manifestLoader", () => {
  const setup = () => {
    const bucket = fakeBucket({
      "manifest.json": manifestText({ lucide: VERSION }),
    });
    let time = 0;
    const logs: string[] = [];
    const load = manifestLoader(
      bucket,
      () => time,
      (m) => logs.push(m),
    );
    return {
      bucket,
      load,
      logs,
      advance: (ms: number) => {
        time += ms;
      },
    };
  };

  it("прочитанный манифест — на минуту; одновременные запросы читают каждый сам", async () => {
    const { bucket, load, advance } = setup();
    await Promise.all([load(), load(), load()]);
    expect(bucket.reads).toHaveLength(3);
    advance(59_999);
    await load();
    expect(bucket.reads).toHaveLength(3);
    advance(1);
    await load();
    expect(bucket.reads).toHaveLength(4);
  });

  // 18 ноября 2026: живой API отвечал 500 «This promise was created by a request that has since ended».
  // Запрос, начавший загрузку, оборвался, а другой ждал его загрузку — в workerd так нельзя.
  it("загрузка оборванного запроса не держит другие: и холодная копия, и обновление через минуту", async () => {
    const { bucket, load, advance } = setup();
    bucket.stuck.add("manifest.json");
    void load();
    expect((await within(load())).get("lucide")?.version).toBe(VERSION);
    advance(60_000);
    bucket.stuck.add("manifest.json");
    void load();
    expect((await within(load())).get("lucide")?.version).toBe(VERSION);
  });

  it("запись в кэше дата-центра нашлась, но не дочиталась — как промах: манифест из R2", async () => {
    const bucket = fakeBucket({
      "manifest.json": manifestText({ lucide: VERSION }),
    });
    const cache = fakeCache();
    await manifestLoader(
      bucket,
      () => 0,
      () => {},
      cache,
    )();
    cache.broken = /manifest/;
    const cold = manifestLoader(
      bucket,
      () => 0,
      () => {},
      cache,
    );
    expect((await cold()).get("lucide")?.version).toBe(VERSION);
    expect(bucket.reads).toHaveLength(2);
  });

  it("R2 не ответил — прежняя копия; без неё — ошибка", async () => {
    const { bucket, load, advance, logs } = setup();
    await load();
    bucket.failing.add("*");
    advance(60_000);
    expect((await load()).get("lucide")?.version).toBe(VERSION);
    expect(logs).toHaveLength(1);
    const fresh = setup();
    fresh.bucket.failing.add("*");
    await expect(fresh.load()).rejects.toThrow(StorageError);
  });

  it("обновление не удалось — 10 секунд служит прежняя копия без чтения R2, затем снова R2 (ревизия фазы 5, А-15)", async () => {
    const { bucket, load, advance } = setup();
    await load();
    bucket.failing.add("*");
    advance(60_000);
    await load();
    const after = bucket.reads.length;
    advance(9_999);
    expect((await load()).get("lucide")?.version).toBe(VERSION);
    expect(bucket.reads).toHaveLength(after);
    bucket.failing.clear();
    advance(1);
    await load();
    expect(bucket.reads.length).toBeGreaterThan(after);
  });

  it("манифеста нет — ошибка хранилища", async () => {
    const load = manifestLoader(
      fakeBucket({}),
      () => 0,
      () => {},
    );
    await expect(load()).rejects.toThrow(/манифеста нет/);
  });

  it("холодная копия функции берёт манифест из кэша дата-центра; через 30 секунд — снова R2", async () => {
    const bucket = fakeBucket({
      "manifest.json": manifestText({ lucide: VERSION }),
    });
    let time = 0;
    const cache = fakeCache(() => time);
    const copy = () =>
      manifestLoader(
        bucket,
        () => time,
        () => {},
        cache,
      );
    await copy()();
    expect((await copy()()).get("lucide")?.version).toBe(VERSION);
    expect(bucket.reads).toEqual(["manifest.json"]);
    time += 30_000;
    await copy()();
    expect(bucket.reads).toHaveLength(2);
  });
});
