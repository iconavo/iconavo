import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFilesAtomic } from "./write.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-write-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("файлы набора одной группой (ревизия фазы 5, Д-12)", () => {
  it("все файлы подменяются; временных не остаётся", async () => {
    await writeFile(join(dir, "a.json"), "старый a");
    await writeFilesAtomic([
      { path: join(dir, "a.json"), data: "новый a" },
      { path: join(dir, "b.json"), data: "новый b" },
    ]);
    expect(await readFile(join(dir, "a.json"), "utf8")).toBe("новый a");
    expect(await readFile(join(dir, "b.json"), "utf8")).toBe("новый b");
    expect((await readdir(dir)).sort()).toEqual(["a.json", "b.json"]);
  });

  it("сбой на втором файле — первый остаётся прежним, временные удалены: смеси нет", async () => {
    await writeFile(join(dir, "a.json"), "старый a");
    // Файл на месте папки: второй файл не записать.
    await writeFile(join(dir, "blocker"), "");
    await expect(
      writeFilesAtomic([
        { path: join(dir, "a.json"), data: "новый a" },
        { path: join(dir, "blocker", "b.json"), data: "новый b" },
      ]),
    ).rejects.toThrow();
    expect(await readFile(join(dir, "a.json"), "utf8")).toBe("старый a");
    expect((await readdir(dir)).sort()).toEqual(["a.json", "blocker"]);
  });
});
