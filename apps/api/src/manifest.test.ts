import { describe, expect, it } from "vitest";
import {
  fakeBucket,
  fakeCache,
  manifestText,
  VERSION,
} from "./fake.testing.js";
import { StorageError } from "./http.js";
import { manifestLoader, parseManifest } from "./manifest.js";

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

  it("одна загрузка на одновременные запросы и на минуту", async () => {
    const { bucket, load, advance } = setup();
    await Promise.all([load(), load(), load()]);
    expect(bucket.reads).toEqual(["manifest.json"]);
    advance(59_999);
    await load();
    expect(bucket.reads).toHaveLength(1);
    advance(1);
    await load();
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
