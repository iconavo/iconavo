import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diskBucket } from "./local.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-local-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("привязка R2 из папки раздачи (ревизия фазы 5, А-34)", () => {
  it("arrayBuffer — ровно байты файла, и у пустого тоже", async () => {
    await writeFile(join(dir, "empty.json"), "");
    await writeFile(join(dir, "a.json"), '{"a":1}');
    const bucket = diskBucket(dir);
    const empty = await (await bucket.get("empty.json"))?.arrayBuffer();
    expect(empty?.byteLength).toBe(0);
    const a = await (await bucket.get("a.json"))?.arrayBuffer();
    expect(a?.byteLength).toBe(7);
    expect(Buffer.from(a ?? new ArrayBuffer(0)).toString("utf8")).toBe(
      '{"a":1}',
    );
    expect(await bucket.get("../outside.json")).toBeNull();
  });
});
