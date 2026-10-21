import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_MODELS } from "./client.testing.js";
import { noSpent } from "./cost.js";
import { unitVector } from "./parse.js";
import {
  bytesToFloat32,
  readIndex,
  readStore,
  storePaths,
  writeStore,
} from "./store.js";

const model = TEST_MODELS[0];
if (!model) throw new Error("нет тестовой модели");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-embed-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const rows = [
  { name: "heart", textHash: "0123456789abcdef" },
  { name: "star", textHash: "fedcba9876543210" },
];

function vectors(): Float32Array {
  const out = new Float32Array(rows.length * model.dims);
  out.set(unitVector([1, 0, 0, 0]) ?? [], 0);
  out.set(unitVector([1, 2, 3, 4]) ?? [], model.dims);
  return out;
}

const spent = {
  ...noSpent(),
  requests: 1,
  texts: 2,
  tokens: 9,
  chars: 20,
  rub: 0.3,
};

describe("хранилище векторов", () => {
  it("запись и чтение дают те же числа; файл — строки × длина × 4 байта, little-endian", async () => {
    const index = await writeStore(dir, model, "demo", rows, vectors(), spent);
    expect(index).toMatchObject({
      format: "f32le",
      model: "test/a",
      dims: 4,
      count: 2,
      bytes: 32,
      rows,
      spent,
    });
    const paths = storePaths(dir, model, "demo");
    const bytes = await readFile(paths.vectors);
    expect(bytes.byteLength).toBe(32);
    // 1.0 во float32 little-endian — 00 00 80 3F.
    expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x00, 0x80, 0x3f]);
    const read = await readStore(dir, model, "demo");
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(Array.from(read.store.vectors)).toEqual(Array.from(vectors()));
    const second = Array.from(read.store.vectors.subarray(4, 8));
    const norm = Math.sqrt(second.reduce((n, x) => n + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    // Временных файлов не осталось.
    expect((await readdir(join(dir, model.key))).sort()).toEqual([
      "demo.f32",
      "demo.json",
    ]);
  });

  it("нет файлов — missing; обрезанный .f32 или чужой хэш — broken, без падения", async () => {
    expect((await readStore(dir, model, "demo")).kind).toBe("missing");
    await writeStore(dir, model, "demo", rows, vectors(), spent);
    const paths = storePaths(dir, model, "demo");
    const bytes = await readFile(paths.vectors);
    await writeFile(paths.vectors, bytes.subarray(0, 28));
    expect(await readStore(dir, model, "demo")).toEqual({
      kind: "broken",
      reason: "файл векторов не сходится с оглавлением",
    });
    const flipped = Buffer.from(bytes);
    flipped[0] = 1;
    await writeFile(paths.vectors, flipped);
    expect((await readStore(dir, model, "demo")).kind).toBe("broken");
    await writeFile(paths.index, "{не json");
    expect(await readIndex(dir, model, "demo")).toEqual({
      kind: "broken",
      reason: "оглавление векторов не читается",
    });
  });

  it("векторы другой модели или длины не подходят", async () => {
    await writeStore(dir, model, "demo", rows, vectors(), spent);
    const other = { ...model, id: "test/other" };
    const longer = { ...model, dims: 8 };
    expect((await readIndex(dir, other, "demo")).kind).toBe("broken");
    expect((await readIndex(dir, longer, "demo")).kind).toBe("broken");
  });

  it("числа читаются и из невыровненного буфера", () => {
    const source = vectors();
    const raw = Buffer.concat([
      Buffer.alloc(1),
      Buffer.from(source.buffer, source.byteOffset, source.byteLength),
    ]).subarray(1);
    // Смещение 1 не кратно 4: Float32Array поверх такого буфера не построить, нужна копия.
    expect(raw.byteOffset % 4).not.toBe(0);
    expect(Array.from(bytesToFloat32(raw))).toEqual(Array.from(source));
    expect(() => bytesToFloat32(raw.subarray(0, 5))).toThrow(/не кратно 4/);
  });

  it("выровненный буфер читается без копии: векторы не занимают память дважды", () => {
    const source = vectors();
    const raw = new Uint8Array(source.buffer.slice(0));
    const read = bytesToFloat32(raw);
    expect(read.buffer).toBe(raw.buffer);
    expect(Array.from(read)).toEqual(Array.from(source));
  });

  it("число векторов не по строкам — ошибка записи", async () => {
    await expect(
      writeStore(dir, model, "demo", rows, new Float32Array(4), spent),
    ).rejects.toThrow(/строк 2/);
  });
});
